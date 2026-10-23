"""Finite typed operations using Plane serializers and domain models, never free-form code."""

import json
import re
import os
from html import escape
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from plane.app.serializers import IssueCreateSerializer, IssueCommentSerializer, IssueSerializer
from django.core.serializers.json import DjangoJSONEncoder
from plane.bgtasks.issue_activities_task import issue_activity
from plane.app.serializers.page import PageSerializer, PageDetailSerializer
from plane.db.models import (
    ProjectMember,
    State,
    Label,
    Cycle,
    Module,
    CycleIssue,
    ModuleIssue,
    IssueRelation,
    IssueActivity,
    ProjectPage,
)
from .context import issue_url, page_url
from .models import Action
from .security import fingerprint

OPERATIONS = {
    "create_issue",
    "update_issue",
    "add_comment",
    "add_labels",
    "set_cycle",
    "add_module",
    "create_page",
    "update_page",
    "relate_issues",
}


class Arguments(serializers.Serializer):
    project_id = serializers.UUIDField()
    custom_fields = serializers.JSONField(required=False)
    issue_id = serializers.UUIDField(required=False)
    page_id = serializers.UUIDField(required=False)
    related_issue_id = serializers.UUIDField(required=False)
    parent_id = serializers.UUIDField(required=False, allow_null=True)
    name = serializers.CharField(required=False, max_length=255)
    text = serializers.CharField(required=False, max_length=20000, allow_blank=True)
    priority = serializers.ChoiceField(choices=["none", "low", "medium", "high", "urgent"], required=False)
    state_id = serializers.UUIDField(required=False)
    assignee_ids = serializers.ListField(child=serializers.UUIDField(), max_length=20, required=False)
    label_ids = serializers.ListField(child=serializers.UUIDField(), max_length=20, required=False)
    target_date = serializers.DateField(required=False, allow_null=True)
    start_date = serializers.DateField(required=False, allow_null=True)
    cycle_id = serializers.UUIDField(required=False)
    module_id = serializers.UUIDField(required=False)
    relation_type = serializers.ChoiceField(
        choices=["blocked_by", "relates_to", "duplicate", "start_before", "finish_before", "implemented_by"],
        required=False,
    )


FIELDS = {
    "create_issue": {
        "custom_fields",
        "name",
        "text",
        "priority",
        "state_id",
        "parent_id",
        "assignee_ids",
        "label_ids",
        "target_date",
        "start_date",
    },
    "update_issue": {
        "custom_fields",
        "issue_id",
        "name",
        "text",
        "priority",
        "state_id",
        "parent_id",
        "assignee_ids",
        "label_ids",
        "target_date",
        "start_date",
    },
    "add_comment": {"issue_id", "text"},
    "add_labels": {"issue_id", "label_ids"},
    "set_cycle": {"issue_id", "cycle_id"},
    "add_module": {"issue_id", "module_id"},
    "create_page": {"name", "text"},
    "update_page": {"page_id", "name", "text"},
    "relate_issues": {"issue_id", "related_issue_id", "relation_type"},
}
REQUIRED = {
    "create_issue": {"name"},
    "update_issue": {"issue_id"},
    "add_comment": {"issue_id", "text"},
    "add_labels": {"issue_id", "label_ids"},
    "set_cycle": {"issue_id", "cycle_id"},
    "add_module": {"issue_id", "module_id"},
    "create_page": {"name", "text"},
    "update_page": {"page_id"},
    "relate_issues": {"issue_id", "related_issue_id", "relation_type"},
}


def schema():
    properties = {}
    for key in Arguments().fields:
        if key == "custom_fields":
            properties[key] = {
                "type": "object",
                "description": "Hentis field UUIDs to typed values from context; never invent required values.",
                "additionalProperties": {
                    "type": ["string", "number", "boolean", "null", "array"],
                    "items": {"type": "string"},
                },
            }
        elif key.endswith("_ids"):
            properties[key] = {"type": "array", "items": {"type": "string"}, "maxItems": 20}
        else:
            properties[key] = {"type": "string"}
    return [
        {
            "type": "function",
            "function": {
                "name": "report_workspace",
                "description": (
                    "Compute a full authorized report with exact totals and a table, not sampled task counts. "
                    "Use for progress, workload, deadlines and period comparisons. "
                    "Dates are YYYY-MM-DD in the user's timezone. Overview is a current snapshot; "
                    "use changed/completed/created for date periods."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "kind": {
                            "type": "string",
                            "enum": [
                                "overview",
                                "overdue",
                                "blocked",
                                "changed",
                                "completed",
                                "created",
                                "upcoming",
                                "workload",
                            ],
                        },
                        "group_by": {"type": "string", "enum": ["project", "assignee", "state", "priority"]},
                        "start": {"type": "string", "description": "Inclusive ISO date; omit for the current week."},
                        "end": {"type": "string", "description": "Inclusive ISO date; omit for today."},
                    },
                    "required": ["kind", "group_by"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "search_workspace",
                "description": "Read authorized work with backend-calculated metrics. Use real IDs and cite sources.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "report": {
                            "type": "string",
                            "enum": ["search", "overdue", "blocked", "changed", "cycle", "priorities"],
                        },
                    },
                    "required": ["query", "report"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "plane_action",
                "description": (
                    "Perform one explicitly requested Plane operation using exact IDs from context. "
                    "Ask clarification for ambiguous references. Plain text only, not HTML. Never delete."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "operation": {"type": "string", "enum": sorted(OPERATIONS)},
                        "arguments": {
                            "type": "object",
                            "properties": properties,
                            "required": ["project_id"],
                            "additionalProperties": False,
                        },
                    },
                    "required": ["operation", "arguments"],
                    "additionalProperties": False,
                },
            },
        },
    ]


def html(text):
    return "<p>" + escape(text).replace("\n", "<br>") + "</p>"


def action_sources(access, data):
    project = access.project(data["project_id"])
    refs = [
        {
            "kind": "project",
            "id": str(project.id),
            "title": project.name,
            "url": f"/{access.workspace.slug}/projects/{project.id}/issues/",
        }
    ]
    for key in ["issue_id", "related_issue_id", "parent_id"]:
        if data.get(key):
            issue = access.issue(data[key])
            refs.append(
                {
                    "kind": "issue",
                    "id": str(issue.id),
                    "title": issue.name,
                    "url": issue_url(access.workspace.slug, issue),
                }
            )
    if data.get("page_id"):
        page = access.page(data["page_id"])
        refs.append(
            {
                "kind": "page",
                "id": str(page.id),
                "title": page.name,
                "url": page_url(access.workspace.slug, page, project.id),
            }
        )
    return refs


def validate(access, scope, operation, arguments, prompt=None):
    if not isinstance(operation, str) or operation not in OPERATIONS or not isinstance(arguments, dict):
        raise ValidationError("Operação desconhecida.")
    if set(arguments) - (FIELDS[operation] | {"project_id"}) or REQUIRED[operation] - set(arguments):
        raise ValidationError("Argumentos ausentes ou não permitidos para a operação.")
    parsed = Arguments(data=arguments)
    parsed.is_valid(raise_exception=True)
    data = parsed.validated_data
    for key in ["assignee_ids", "label_ids"]:
        if key in data and len(data[key]) != len(set(data[key])):
            raise ValidationError("Identificadores duplicados não são permitidos.")
    if operation in {"update_issue", "update_page"} and not set(data) - {"project_id", "issue_id", "page_id"}:
        raise ValidationError("Informe ao menos um campo para alterar.")
    project = access.project(data["project_id"], write=True)

    def explicit(identifier):
        return bool(re.search(r"(?<!\w)" + re.escape(str(identifier)) + r"(?!\w)", prompt or "", re.IGNORECASE))

    if (
        prompt is not None
        and scope["kind"] == "workspace"
        and access.projects().filter(name__iexact=project.name).count() > 1
        and not (explicit(project.id) or explicit(project.identifier))
    ):
        raise ValidationError("Há projetos com o mesmo nome. Informe o identificador ou selecione o escopo do projeto.")
    if "custom_fields" in data or operation == "create_issue":
        from plane.custom_fields.services import validate_values

        validate_values(project.id, data.get("custom_fields", {}), creating=operation == "create_issue")
    if scope["kind"] == "project" and str(project.id) != scope["id"]:
        raise PermissionDenied("Operação fora do escopo aprovado.")
    if scope["kind"] == "issue":
        current = access.issue(scope["id"])
        if (
            project.id != current.project_id
            or (operation == "create_issue" and str(data.get("parent_id")) != scope["id"])
            or (operation != "create_issue" and str(data.get("issue_id")) != scope["id"])
        ):
            raise PermissionDenied("No escopo de item, só é permitido editar o item ou criar suas subtarefas.")
    if scope["kind"] == "page" and (operation != "update_page" or str(data.get("page_id")) != scope["id"]):
        raise PermissionDenied("Operação fora da página atual.")
    issue = None
    if "issue_id" in data:
        issue = access.issue(data["issue_id"], write=True)
        if issue.project_id != project.id:
            raise ValidationError("Tarefa não pertence ao projeto indicado.")
        if (
            prompt is not None
            and scope["kind"] != "issue"
            and access.issues().filter(project=project, name__iexact=issue.name).count() > 1
            and not (explicit(issue.id) or explicit(f"{project.identifier}-{issue.sequence_id}"))
        ):
            raise ValidationError("Há tarefas com o mesmo título. Qual identificador de tarefa deve ser alterado?")
    if "parent_id" in data and data["parent_id"]:
        parent = access.issue(data["parent_id"])
        if parent.project_id != project.id or (issue and parent.id == issue.id):
            raise ValidationError("Pai inválido.")
        ancestor, visited = parent, set()
        while ancestor.parent_id:
            if ancestor.id in visited or (issue and ancestor.parent_id == issue.id):
                raise ValidationError("Uma subtarefa não pode gerar um ciclo de parentesco.")
            visited.add(ancestor.id)
            ancestor = access.issue(ancestor.parent_id)
    for key, model in [("state_id", State), ("cycle_id", Cycle), ("module_id", Module)]:
        if key in data:
            entity = get_object_or_404(model, pk=data[key], project=project, workspace=access.workspace)
            if key == "cycle_id" and entity.end_date and entity.end_date < timezone.now():
                raise ValidationError("Não é possível associar a um ciclo concluído.")
    if "assignee_ids" in data:
        allowed = ProjectMember.objects.filter(
            project=project, is_active=True, role__gte=15, member_id__in=data["assignee_ids"]
        ).count()
        if allowed != len(set(data["assignee_ids"])):
            raise ValidationError("Responsável não é membro autorizado do projeto.")
        if prompt is not None:
            members = ProjectMember.objects.filter(project=project, is_active=True, role__gte=15)
            for member in members.filter(member_id__in=data["assignee_ids"]).select_related("member"):
                if members.filter(member__display_name__iexact=member.member.display_name).count() > 1 and not explicit(
                    member.member_id
                ):
                    raise ValidationError(
                        "Há pessoas com o mesmo nome. Informe o UUID da pessoa para atribuir a tarefa."
                    )
    if "label_ids" in data and Label.objects.filter(project=project, pk__in=data["label_ids"]).count() != len(
        set(data["label_ids"])
    ):
        raise ValidationError("Etiqueta fora do projeto.")
    if "page_id" in data:
        page = access.page(data["page_id"], write=True)
        if not ProjectPage.objects.filter(page=page, project=project, deleted_at__isnull=True).exists():
            raise ValidationError("Página fora do projeto.")
    if "related_issue_id" in data:
        related = access.issue(data["related_issue_id"])
        if issue and related.id == issue.id:
            raise ValidationError("Relação com o próprio item não é permitida.")
    start = data.get("start_date", getattr(issue, "start_date", None))
    end = data.get("target_date", getattr(issue, "target_date", None))
    if start and end and start > end:
        raise ValidationError("Data inicial posterior ao prazo.")
    return data, project, issue


def execute(access, action):
    with transaction.atomic():
        action = Action.objects.select_for_update().select_related("run__conversation").get(pk=action.pk)
        run = action.run
        if run.conversation.owner_id != access.user.id or run.workspace_id != access.workspace.id:
            raise PermissionDenied()
        from .orchestrator import get_access

        access = get_access(run)
        if action.status == "done":
            return action.result
        if action.status == "rejected":
            raise ValidationError("Ação descartada.")
        if not run.allow_actions:
            raise PermissionDenied("Execução não foi autorizada para esta mensagem.")
        if run.cancelled:
            raise ValidationError("Execução cancelada.")
        access.scope(run.conversation.scope)
        operation = action.operation
        data, project, issue = validate(access, run.conversation.scope, operation, action.arguments, run.prompt)
        if run.automation_policy:
            policy = run.automation_policy
            if (
                operation not in policy["operations"]
                or run.actions.exclude(pk=action.pk).filter(status="done").count() >= policy["max_actions"]
            ):
                raise PermissionDenied("Operação excede a política automática.")
            if operation == "update_issue" and set(data) - {"project_id", "issue_id", *policy["fields"]}:
                raise PermissionDenied("Campo fora da política automática.")
        previous = Action.objects.filter(run=run, status="done", operation=operation).exclude(pk=action.pk)
        duplicate = next(
            (item for item in previous if fingerprint(item.arguments) == fingerprint(action.arguments)), None
        )
        if duplicate:
            action.result, action.status = duplicate.result, "done"
            action.save()
            return action.result
        common = {
            "workspace": access.workspace,
            "project": project,
            "created_by": access.user,
            "updated_by": access.user,
        }
        result = None
        native_activity = None
        before = json.dumps(IssueSerializer(issue).data, cls=DjangoJSONEncoder) if issue else None
        if operation in {"create_issue", "update_issue", "add_labels"}:
            payload = {key: value for key, value in data.items() if key not in {"project_id", "issue_id", "text"}}
            if "text" in data:
                payload["description_html"] = html(data["text"])
                payload["description_binary"] = None
                payload["description_json"] = {
                    "type": "doc",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [{"type": "text", "text": data["text"]}] if data["text"] else [],
                        }
                    ],
                }
            if operation == "add_labels":
                payload["label_ids"] = list(set(data["label_ids"]) | set(issue.labels.values_list("id", flat=True)))
            serializer = IssueCreateSerializer(
                issue,
                data=payload,
                partial=issue is not None,
                context={
                    "project_id": project.id,
                    "workspace_id": access.workspace.id,
                    "default_assignee_id": project.default_assignee_id,
                    "actor": access.user,
                },
            )
            serializer.is_valid(raise_exception=True)
            issue = serializer.save(updated_by=access.user, **({"created_by": access.user} if issue is None else {}))
            native_activity = (
                "issue.activity.created" if operation == "create_issue" else "issue.activity.updated",
                payload,
            )
        elif operation == "add_comment":
            serializer = IssueCommentSerializer(data={"comment_html": html(data["text"])})
            serializer.is_valid(raise_exception=True)
            serializer.save(issue=issue, actor=access.user, **common)
            native_activity = ("comment.activity.created", serializer.data)
        elif operation == "set_cycle":
            CycleIssue.objects.filter(issue=issue).exclude(cycle_id=data["cycle_id"]).delete()
            CycleIssue.objects.get_or_create(issue=issue, cycle_id=data["cycle_id"], defaults=common)
        elif operation == "add_module":
            ModuleIssue.objects.get_or_create(issue=issue, module_id=data["module_id"], defaults=common)
        elif operation == "relate_issues":
            relation, created = IssueRelation.objects.get_or_create(
                issue=issue,
                related_issue_id=data["related_issue_id"],
                defaults={**common, "relation_type": data["relation_type"]},
            )
            if not created and relation.relation_type != data["relation_type"]:
                raise ValidationError("Já existe outra relação entre estes itens; revise antes de substituir.")
        elif operation in {"create_page", "update_page"}:
            payload = {"name": data["name"]} if "name" in data else {}
            if operation == "create_page":
                from .report_documents import safe_markdown

                serializer = PageSerializer(
                    data=payload,
                    context={
                        "project_id": project.id,
                        "owned_by_id": access.user.id,
                        "description_json": {},
                        "description_binary": None,
                        "description_html": safe_markdown(data.get("text", "")),
                    },
                )
            else:
                page = access.page(data["page_id"], write=True)
                if "text" in data:
                    # Collaborative binary pages cannot be safely rewritten with an HTML-only patch.
                    if page.description_binary:
                        raise ValidationError("Página colaborativa: use a prévia do editor para alterar o conteúdo.")
                    payload["description_html"] = html(data["text"])
                serializer = PageDetailSerializer(page, data=payload, partial=True)
            serializer.is_valid(raise_exception=True)
            page = serializer.save(
                updated_by=access.user, **({"created_by": access.user} if operation == "create_page" else {})
            )
            result = {
                "kind": "page",
                "id": str(page.id),
                "title": page.name,
                "url": page_url(access.workspace.slug, page, project.id),
            }
        if issue:
            if native_activity:
                event, payload = native_activity
                event_data = {
                    "type": event,
                    "requested_data": json.dumps(payload, cls=DjangoJSONEncoder),
                    "current_instance": before if event == "issue.activity.updated" else None,
                    "issue_id": str(issue.id),
                    "actor_id": str(access.user.id),
                    "project_id": str(project.id),
                    "epoch": int(timezone.now().timestamp()),
                    "notification": True,
                    "origin": os.environ.get("WEB_URL"),
                }
                # Use Plane's normal history/notification pipeline, once, after the write commits.
                # Action remains the synchronous audit if the queue is unavailable.
                transaction.on_commit(lambda: issue_activity.delay(**event_data), robust=True)
            else:
                IssueActivity.objects.create(
                    issue=issue,
                    actor=access.user,
                    field="plane_ai",
                    verb="updated",
                    comment="Plane AI: " + operation,
                    new_value=json.dumps(action.arguments),
                    **common,
                )
            result = {
                "kind": "issue",
                "id": str(issue.id),
                "title": issue.name,
                "url": issue_url(access.workspace.slug, issue),
            }
        action.result, action.status = result, "done"
        action.save(update_fields=["result", "status", "updated_at"])
        return result
