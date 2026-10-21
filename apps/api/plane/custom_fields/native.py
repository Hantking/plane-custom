"""Personal display preferences and permission-scoped batches for stock Plane layouts."""

from uuid import UUID

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from plane.authentication.session import BaseSessionAuthentication
from plane.db.models import Cycle, Issue, IssueView, Module, Project, ProjectMember, Workspace, WorkspaceMember
from .models import Field, NativeLayoutPreference
from .serializers import FieldSerializer
from .services import values_for

LAYOUTS = {"list", "kanban", "spreadsheet", "calendar", "gantt_chart"}
BUILTIN_VIEWS = {
    "00000000-0000-0000-0000-000000000001": "Todos os itens",
    "00000000-0000-0000-0000-000000000002": "Atribuídos a mim",
    "00000000-0000-0000-0000-000000000003": "Criados por mim",
    "00000000-0000-0000-0000-000000000004": "Inscrições",
}
STANDARD_PROPERTIES = [
    "state",
    "priority",
    "assignee",
    "labels",
    "modules",
    "cycle",
    "start_date",
    "due_date",
    "estimate",
    "created_on",
    "updated_on",
    "link",
    "attachment_count",
    "sub_issue_count",
    "issue_type",
]
CARD_PROPERTY_ORDER = [
    "state",
    "priority",
    "start_date",
    "due_date",
    "assignee",
    "modules",
    "cycle",
    "estimate",
    "sub_issue_count",
    "attachment_count",
    "link",
    "labels",
    "created_on",
    "updated_on",
    "issue_type",
]


class NativeContext:
    def __init__(self, user, slug, payload):
        if not isinstance(payload, dict):
            raise ValidationError("Contexto inválido.")
        self.user = user
        self.workspace = get_object_or_404(Workspace, slug=slug)
        self.workspace_member = WorkspaceMember.objects.filter(
            workspace=self.workspace, member=user, is_active=True, role__in=[5, 15, 20]
        ).first()
        if self.workspace_member is None:
            raise PermissionDenied()
        self.scope = payload.get("scope")
        self.layout = payload.get("layout")
        if (
            not isinstance(self.scope, str)
            or not isinstance(self.layout, str)
            or self.scope
            not in ("project", "module", "cycle", "project_view", "workspace_view", "workspace_builtin", "archive")
            or self.layout not in LAYOUTS
        ):
            raise ValidationError("Contexto/layout não suportado.")
        try:
            self.target = UUID(str(payload.get("target")))
        except (ValueError, TypeError):
            raise ValidationError("Identificador de contexto inválido.")
        self.memberships = ProjectMember.objects.filter(
            workspace=self.workspace,
            member=user,
            is_active=True,
            role__in=[5, 15, 20],
            project__deleted_at__isnull=True,
        ).select_related("project")
        self.project = None
        if self.scope == "workspace_builtin":
            if str(self.target) not in BUILTIN_VIEWS:
                raise ValidationError("Visualização padrão inválida.")
            self.label = BUILTIN_VIEWS[str(self.target)]
        elif self.scope in ("project", "archive"):
            self.project = get_object_or_404(Project, pk=self.target, workspace=self.workspace)
            self.label = self.project.name
        elif self.scope in ("module", "cycle"):
            model = Module if self.scope == "module" else Cycle
            entity = get_object_or_404(
                model.objects.select_related("project"), pk=self.target, workspace=self.workspace
            )
            self.project = entity.project
            self.label = entity.name
        else:
            view = get_object_or_404(IssueView, pk=self.target, workspace=self.workspace)
            if (self.scope == "workspace_view") != (view.project_id is None):
                raise ValidationError("A visualização não corresponde ao contexto.")
            if view.access == 0 and view.owned_by_id != user.id:
                raise PermissionDenied()
            if self.scope == "workspace_view" and self.workspace_member.role == 5 and view.owned_by_id != user.id:
                raise PermissionDenied()
            self.project = view.project
            self.label = view.name
        if payload.get("project_id") and str(getattr(self.project, "id", "")) != str(payload["project_id"]):
            raise PermissionDenied("O projeto não corresponde ao contexto.")
        if self.project:
            self.memberships = self.memberships.filter(project=self.project)
            if not self.memberships.exists():
                raise PermissionDenied()
        self.memberships = list(self.memberships)
        self.project_ids = [membership.project_id for membership in self.memberships]

    def key(self):
        return {
            "owner": self.user,
            "workspace": self.workspace,
            "context_type": self.scope,
            "target": self.target,
            "layout": self.layout,
        }

    def fields(self):
        return list(
            Field.objects.filter(project_id__in=self.project_ids, active=True)
            .select_related("project")
            .order_by("project__identifier", "position", "created_at")
        )

    def metadata(self):
        fields = self.fields()
        ids = [str(field.id) for field in fields]
        allowed = {"standard:" + key for key in STANDARD_PROPERTIES} | {"custom:" + key for key in ids}
        preference = NativeLayoutPreference.objects.filter(**self.key()).first()
        standard_order = CARD_PROPERTY_ORDER if self.layout in ("list", "kanban") else STANDARD_PROPERTIES
        default = ["standard:" + key for key in standard_order] + ["custom:" + key for key in ids]
        order = list(
            dict.fromkeys(
                [key for key in (preference.property_order if preference else default) if key in allowed] + default
            )
        )
        visible = [key for key in (preference.visible if preference else ids) if key in ids]
        editable = [
            str(membership.project_id)
            for membership in self.memberships
            if membership.role >= 15 or self.workspace_member.role == 20
        ]
        return {
            "fields": [
                {
                    **FieldSerializer(field).data,
                    "project_id": str(field.project_id),
                    "project_name": field.project.name,
                    "project_identifier": field.project.identifier,
                }
                for field in fields
            ],
            "preference": {"order": order, "visible": visible},
            "editable_project_ids": editable,
            "context_label": self.label,
        }

    def issues(self, ids):
        complete = [
            membership.project_id
            for membership in self.memberships
            if membership.role > 5 or membership.project.guest_view_all_features
        ]
        return Issue.objects.filter(workspace=self.workspace, project_id__in=self.project_ids, pk__in=ids).filter(
            Q(project_id__in=complete) | Q(created_by=self.user)
        )


class NativeDisplayEndpoint(APIView):
    authentication_classes = [BaseSessionAuthentication]

    def get(self, request, slug):
        context = NativeContext(request.user, slug, request.query_params.dict())
        return Response(context.metadata())

    def patch(self, request, slug):
        context = NativeContext(request.user, slug, request.data)
        fields = context.fields()
        known = {str(field.id) for field in fields}
        allowed = {"standard:" + key for key in STANDARD_PROPERTIES} | {"custom:" + key for key in known}
        order, visible = request.data.get("order"), request.data.get("visible")
        if (
            not isinstance(order, list)
            or len(order) > len(allowed)
            or any(not isinstance(key, str) or key not in allowed for key in order)
        ):
            raise ValidationError("Ordem contém propriedades inexistentes ou sem acesso.")
        if (
            not isinstance(visible, list)
            or len(visible) > len(known)
            or any(not isinstance(key, str) or key not in known for key in visible)
        ):
            raise ValidationError("Campos visíveis inexistentes ou sem acesso.")
        if len(order) != len(set(order)) or len(visible) != len(set(visible)):
            raise ValidationError("Propriedades duplicadas.")
        with transaction.atomic():
            NativeLayoutPreference.objects.update_or_create(
                **context.key(), defaults={"project": context.project, "property_order": order, "visible": visible}
            )
        return Response(context.metadata())


class NativeValuesEndpoint(APIView):
    authentication_classes = [BaseSessionAuthentication]

    def post(self, request, slug):
        context = NativeContext(request.user, slug, request.data)
        raw = request.data.get("ids")
        if not isinstance(raw, list) or len(raw) > 100:
            raise ValidationError("Informe no máximo 100 tarefas.")
        try:
            ids = [UUID(str(key)) for key in raw]
        except (ValueError, TypeError):
            raise ValidationError("Identificador de tarefa inválido.")
        issues = list(context.issues(ids))
        return Response(
            {"values": values_for(issues), "projects": {str(issue.id): str(issue.project_id) for issue in issues}}
        )
