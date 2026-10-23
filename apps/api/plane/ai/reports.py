"""Chat reports computed over authorized rows, independent of the retrieval sample."""

from datetime import datetime, time, timedelta
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db.models import Q, Count
from django.utils import timezone
from rest_framework import serializers
from plane.db.models import IssueActivity, IssueRelation, ProjectPage

KINDS = ["overview", "overdue", "blocked", "changed", "completed", "created", "upcoming", "workload"]


def prompt_report(prompt, context):
    text = prompt.lower()
    now = datetime.fromisoformat(context["as_of"])
    today = now.date()
    kind = context["report"]
    if any(word in text for word in ["carga", "workload", "distribuição", "distribuicao"]):
        kind = "workload"
    elif any(word in text for word in ["concluídas", "concluidas", "concluídos", "concluidos", "completed"]):
        kind = "completed"
    group = "assignee" if kind == "workload" or "responsável" in text or "responsavel" in text else "project"
    result = {"kind": kind, "group_by": group}
    if "semana passada" in text or "last week" in text:
        end = today - timedelta(days=today.weekday() + 1)
        result.update(start=str(end - timedelta(days=6)), end=str(end))
    elif "mês passado" in text or "mes passado" in text or "last month" in text:
        end = today.replace(day=1) - timedelta(days=1)
        result.update(start=str(end.replace(day=1)), end=str(end))
    elif "ontem" in text or "yesterday" in text:
        result.update(start=str(today - timedelta(days=1)), end=str(today - timedelta(days=1)))
    elif "hoje" in text or "today" in text:
        result.update(start=str(today), end=str(today))
    else:
        match = re.search(r"(?:últimos|ultimos|last)\s+(\d{1,3})\s+(?:dias|days)", text)
        if match:
            result.update(start=str(today - timedelta(days=min(max(int(match[1]), 1), 366) - 1)), end=str(today))
    return result


class ReportRequest(serializers.Serializer):
    kind = serializers.ChoiceField(choices=KINDS, default="overview")
    group_by = serializers.ChoiceField(choices=["project", "assignee", "state", "priority"], default="project")
    start = serializers.DateField(required=False)
    end = serializers.DateField(required=False)


def build_report(access, scope, arguments, focus=None):
    if set(arguments) - {"kind", "group_by", "start", "end"}:
        raise serializers.ValidationError("Parâmetros de relatório inválidos.")
    serializer = ReportRequest(data=arguments)
    serializer.is_valid(raise_exception=True)
    spec = serializer.validated_data
    scope = access.scope(scope)
    try:
        zone = ZoneInfo(access.user.user_timezone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo("UTC")
    now = timezone.now().astimezone(zone)
    today = now.date()
    start = spec.get("start", today if spec["kind"] == "upcoming" else today - timedelta(days=today.weekday()))
    end = spec.get("end", start + timedelta(days=7) if spec["kind"] == "upcoming" else today)
    if end < start or (end - start).days > 366:
        raise serializers.ValidationError("Escolha um período válido de até 366 dias.")
    lower = datetime.combine(start, time.min, zone)
    upper = datetime.combine(end + timedelta(days=1), time.min, zone)
    issues = access.issues()
    projects = access.projects()
    if scope["kind"] == "project":
        projects = projects.filter(pk=scope["id"])
        issues = issues.filter(project_id=scope["id"])
    elif scope["kind"] == "issue":
        issue = access.issue(scope["id"])
        projects = projects.filter(pk=issue.project_id)
        issues = issues.filter(Q(pk=issue.id) | Q(parent_id=issue.id))
    elif scope["kind"] == "page":
        page = access.page(scope["id"])
        projects = projects.filter(
            pk__in=ProjectPage.objects.filter(page=page, deleted_at__isnull=True).values("project_id")
        )
        issues = issues.none()
    if focus:
        issues = issues.filter(pk__in=focus["issue_ids"])
        projects = projects.filter(pk__in=focus["project_ids"])
    kind = spec["kind"]
    completed = Q(state__group="completed")
    open_state = ~Q(state__group__in=["completed", "cancelled"])
    overdue = open_state & Q(target_date__lt=today)
    if kind == "overdue":
        issues = issues.filter(overdue)
    elif kind == "blocked":
        issues = issues.filter(
            open_state,
            pk__in=IssueRelation.objects.filter(
                issue_id__in=issues.values("id"),
                relation_type="blocked_by",
                related_issue_id__in=access.issues().filter(open_state).values("id"),
            ).values("issue_id"),
        )
    elif kind == "changed":
        activities = IssueActivity.objects.filter(
            issue_id__in=issues.values("id"), created_at__gte=lower, created_at__lt=upper
        )
        issues = issues.filter(Q(updated_at__gte=lower, updated_at__lt=upper) | Q(pk__in=activities.values("issue_id")))
    elif kind == "created":
        issues = issues.filter(created_at__gte=lower, created_at__lt=upper)
    elif kind == "completed":
        issues = issues.filter(completed, completed_at__gte=lower, completed_at__lt=upper)
    elif kind == "upcoming":
        issues = issues.filter(
            open_state,
            target_date__gte=start,
            target_date__lte=end,
        )
    issues = issues.distinct()
    metrics = issues.aggregate(
        total=Count("id", distinct=True),
        completed=Count("id", distinct=True, filter=completed),
        overdue=Count("id", distinct=True, filter=overdue),
        in_progress=Count("id", distinct=True, filter=Q(state__group="started")),
    )
    metrics["completion_percent"] = round(100 * metrics["completed"] / metrics["total"], 1) if metrics["total"] else 0
    fields = {
        "project": ("project_id", "project__name", "Projeto"),
        "assignee": ("assignees__id", "assignees__display_name", "Responsável"),
        "state": ("state_id", "state__name", "Estado"),
        "priority": ("priority", "priority", "Prioridade"),
    }
    group = "assignee" if kind == "workload" and "group_by" not in arguments else spec["group_by"]
    key, label, title = fields[group]
    grouped = (
        issues.values(*dict.fromkeys([key, label]))
        .annotate(
            total=Count("id", distinct=True),
            completed=Count("id", distinct=True, filter=completed),
            overdue=Count("id", distinct=True, filter=overdue),
        )
        .order_by(label)
    )
    count = grouped.count()
    selected_groups = list(grouped[:100])
    rows = [
        [
            (
                {"none": "Sem prioridade", "low": "Baixa", "medium": "Média", "high": "Alta", "urgent": "Urgente"}.get(
                    row[label], row[label]
                )
                if group == "priority"
                else row[label]
                or (
                    ("Usuário " + str(row[key])[:8])
                    if group == "assignee" and row[key]
                    else "Sem responsável"
                    if group == "assignee"
                    else "Sem valor"
                )
            ),
            row["total"],
            row["completed"],
            row["overdue"],
        ]
        for row in selected_groups
    ]
    sources = [
        {
            "kind": "project",
            "id": str(project.id),
            "title": project.name,
            "url": f"/{access.workspace.slug}/projects/{project.id}/issues/",
        }
        for project in projects.filter(pk__in=issues.values("project_id")).order_by("name")
    ]
    names = {
        "overview": "Visão geral",
        "overdue": "Tarefas atrasadas",
        "blocked": "Bloqueios",
        "changed": "Atualizações no período",
        "completed": "Conclusões no período",
        "created": "Tarefas criadas no período",
        "upcoming": "Próximos prazos",
        "workload": "Carga por responsável",
    }
    temporal = kind in {"changed", "completed", "created", "upcoming"}
    return {
        "id": f"{kind}:{group}:{start if temporal else 'snapshot'}:{end if temporal else 'snapshot'}",
        "title": names[kind],
        "kind": kind,
        "group_by": group,
        "metrics": metrics,
        "period": {"from": str(start), "to": str(end)} if temporal else None,
        "as_of": now.isoformat(),
        "timezone": str(zone),
        "columns": [title, "Tarefas", "Concluídas", "Atrasadas"],
        "rows": rows,
        "row_ids": [str(row[key] or "__empty__") for row in selected_groups],
        "truncated": count > 100,
        "definition": (
            "Contagens únicas sobre todos os itens autorizados. Tarefas com vários responsáveis aparecem "
            "em cada responsável; não some essas linhas para obter o total."
        )
        if group == "assignee"
        else "Contagens únicas calculadas no banco sobre todos os itens autorizados, antes do limite de linhas.",
    }, sources
