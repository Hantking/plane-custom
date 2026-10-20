import json

from django.db import transaction
from django.db.models import Count, Exists, F, OuterRef, Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from plane.app.permissions import ROLE, allow_permission
from plane.authentication.session import BaseSessionAuthentication
from plane.db.models import Issue, Project, ProjectMember, WorkspaceMember

from .models import Change, Field, SavedView, Value
from .serializers import FieldSerializer, SavedViewSerializer
from .services import field_annotation, filter_items, move_selection, save_values, validate_values, values_for
from .conversions import rewrite_views

READ = [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST]
WRITE = [ROLE.ADMIN, ROLE.MEMBER]


class ProjectEndpoint(APIView):
    authentication_classes = [BaseSessionAuthentication]

    def project(self):
        return get_object_or_404(Project, pk=self.kwargs["project_id"], workspace__slug=self.kwargs["slug"])

    def can_manage(self):
        project = self.project()
        return (
            ProjectMember.objects.filter(project=project, member=self.request.user, role=20, is_active=True).exists()
            or WorkspaceMember.objects.filter(
                workspace=project.workspace, member=self.request.user, role=20, is_active=True
            ).exists()
        )

    def items(self, include_archived=False):
        project = self.project()
        manager = Issue.objects if include_archived else Issue.issue_objects
        query = manager.filter(project=project)
        member = ProjectMember.objects.get(project=project, member=self.request.user, is_active=True)
        if member.role == 5 and not project.guest_view_all_features:
            query = query.filter(created_by=self.request.user)
        return query


class FieldsEndpoint(ProjectEndpoint):
    @allow_permission(READ)
    def get(self, request, slug, project_id):
        project = self.project()
        return Response(
            {
                "fields": FieldSerializer(Field.objects.filter(project=project), many=True).data,
                "can_manage": self.can_manage(),
                "can_edit": ProjectMember.objects.filter(
                    project=project, member=request.user, is_active=True, role__gte=15
                ).exists()
                or self.can_manage(),
            }
        )

    @allow_permission([ROLE.ADMIN])
    def post(self, request, slug, project_id):
        project = self.project()
        if Field.objects.filter(project=project).count() >= 100:
            raise ValidationError("Limite de 100 campos por projeto.")
        serializer = FieldSerializer(data=request.data, context={"project_id": project.id})
        serializer.is_valid(raise_exception=True)
        serializer.save(project=project)
        return Response(serializer.data, status=201)


class FieldEndpoint(ProjectEndpoint):
    @allow_permission([ROLE.ADMIN])
    def patch(self, request, slug, project_id, field_id):
        # Lock prevents deleting options while a value is being written.
        with transaction.atomic():
            field = get_object_or_404(Field.objects.select_for_update(), pk=field_id, project=self.project())
            serializer = FieldSerializer(field, data=request.data, partial=True, context={"project_id": project_id})
            serializer.is_valid(raise_exception=True)
            serializer.save()
        return Response(serializer.data)

    @allow_permission([ROLE.ADMIN])
    def delete(self, request, slug, project_id, field_id):
        with transaction.atomic():
            field = get_object_or_404(Field.objects.select_for_update(), pk=field_id, project=self.project())
            rewrite_views(field, deleting=True)
            field.delete()
        return Response(status=204)


class ValuesEndpoint(ProjectEndpoint):
    @allow_permission(READ)
    def get(self, request, slug, project_id, issue_id):
        issue = get_object_or_404(self.items(include_archived=True), pk=issue_id)
        changes = Change.objects.filter(issue=issue, field__project_id=project_id).select_related("actor", "field")[:50]
        return Response(
            {
                "values": values_for([issue])[str(issue.id)],
                "history": [
                    {
                        "id": c.id,
                        "field": str(c.field_id),
                        "name": c.field.name,
                        "old": c.old_value,
                        "new": c.new_value,
                        "actor": c.actor.display_name if c.actor else None,
                        "created_at": c.created_at,
                    }
                    for c in changes
                ],
            }
        )

    @allow_permission(WRITE)
    def patch(self, request, slug, project_id, issue_id):
        if not isinstance(request.data, dict):
            raise ValidationError("Informe um objeto de valores.")
        with transaction.atomic():
            issue = get_object_or_404(self.items(include_archived=True).select_for_update(), pk=issue_id)
            if issue.archived_at or issue.project.archived_at:
                raise ValidationError("Não é possível editar uma tarefa arquivada.")
            if "selection_move" in request.data:
                if "values" in request.data:
                    raise ValidationError("Informe valores ou movimento, não ambos.")
                move_selection(issue, request.data["selection_move"], request.user.id)
            else:
                prepared = validate_values(project_id, request.data.get("values"))
                save_values(issue, prepared, request.user.id)
        return Response({"values": values_for([issue])[str(issue.id)]})


def serialize_items(query):
    issues = list(query.select_related("state", "project"))
    values = values_for(issues)
    return [
        {
            "id": str(i.id),
            "name": i.name,
            "identifier": f"{i.project.identifier}-{i.sequence_id}",
            "project_id": str(i.project_id),
            "state": i.state.name if i.state else "",
            "state_id": str(i.state_id) if i.state_id else None,
            "priority": i.priority,
            "custom_fields": values[str(i.id)],
        }
        for i in issues
    ]


def view_config(project_id, config):
    if not isinstance(config, dict) or len(json.dumps(config)) > 20000:
        raise ValidationError("Configuração de visualização inválida.")
    allowed = {"filters", "match", "group_by", "order_by", "layout", "columns", "search", "priority"}
    if set(config) - allowed or config.get("layout", "table") not in ("table", "list", "kanban"):
        raise ValidationError("Configuração não suportada.")
    # Reuse filter validation without evaluating the query.
    filter_items(Issue.issue_objects.none(), project_id, config.get("filters", []), config.get("match", "all"))
    all_fields = {str(f.id): f for f in Field.objects.filter(project_id=project_id)}
    fields = {key: field for key, field in all_fields.items() if field.active}
    if (
        not isinstance(config.get("columns", []), list)
        or len(config.get("columns", [])) > 100
        or any(not isinstance(c, str) or c not in all_fields for c in config.get("columns", []))
    ):
        raise ValidationError("Colunas inválidas.")
    config = {**config, "columns": [key for key in dict.fromkeys(config.get("columns", [])) if key in fields]}
    group = config.get("group_by")
    if group and (
        not isinstance(group, str)
        or group not in fields
        or fields[group].kind not in ("select", "multiselect", "boolean")
    ):
        raise ValidationError("Agrupamento disponível para seleção única/múltipla e sim/não.")
    order = config.get("order_by", "-created_at")
    if not isinstance(order, str) or order.lstrip("-") not in {"created_at", "name", *fields}:
        raise ValidationError("Ordenação inválida.")
    if order.lstrip("-") in fields and fields[order.lstrip("-")].kind == "multiselect":
        raise ValidationError("Seleção múltipla pode ser filtrada e agrupada; escolha outro campo para ordenar.")
    if not isinstance(config.get("search", ""), str) or len(config.get("search", "")) > 255:
        raise ValidationError("Busca inválida.")
    if config.get("priority", "") not in ("", "none", "low", "medium", "high", "urgent"):
        raise ValidationError("Prioridade inválida.")
    return config


class ItemsEndpoint(ProjectEndpoint):
    @allow_permission(READ)
    def get(self, request, slug, project_id):
        try:
            config = json.loads(request.query_params.get("config", "{}"))
            page = int(request.query_params.get("page", 1))
        except (ValueError, TypeError):
            raise ValidationError("Página/configuração inválida.")
        if page < 1 or page > 100000:
            raise ValidationError("Página inválida.")
        config = view_config(project_id, config)
        query = filter_items(self.items(), project_id, config.get("filters", []), config.get("match", "all"))
        if config.get("search"):
            query = query.filter(name__icontains=config["search"])
        if config.get("priority"):
            query = query.filter(priority=config["priority"])
        order = config.get("order_by", "-created_at")
        if order.lstrip("-") in ("name", "created_at"):
            query = query.order_by(order, "id")
        else:
            _, annotation = field_annotation(project_id, order.lstrip("-"))
            direction = (
                F("_hentis_sort").desc(nulls_last=True)
                if order.startswith("-")
                else F("_hentis_sort").asc(nulls_last=True)
            )
            query = query.annotate(_hentis_sort=annotation).order_by(direction, "id")
        group = config.get("group_by")
        size = 25
        if group:
            field, annotation = field_annotation(project_id, group)
            if field.kind != "multiselect":
                query = query.annotate(_hentis_group=annotation)
            options = (
                [(str(o["id"]), o["label"]) for o in field.options]
                if field.kind in ("select", "multiselect")
                else [("true", "Sim"), ("false", "Não")]
            )
            options.append(("__empty__", "Sem valor"))

            def key_of(value):
                return "__empty__" if value is None else str(value).lower()

            counts = (
                {}
                if field.kind == "multiselect"
                else {
                    key_of(row["_hentis_group"]): row["total"]
                    for row in query.order_by().values("_hentis_group").annotate(total=Count("id"))
                }
            )
            requested = request.query_params.get("group_value")
            groups = []
            if requested is not None and requested not in {key for key, _ in options}:
                raise ValidationError("Grupo inválido.")
            for key, label in options:
                if requested is not None and requested != key:
                    continue
                if field.kind == "multiselect":
                    values = Value.objects.filter(field=field, issue_id=OuterRef("pk"))
                    matching = (
                        values.exclude(option_values=[])
                        if key == "__empty__"
                        else values.filter(option_values__contains=[key])
                    )
                    selected = query.filter(~Exists(matching)) if key == "__empty__" else query.filter(Exists(matching))
                    count = selected.count()
                else:
                    raw = None if key == "__empty__" else (key == "true" if field.kind == "boolean" else key)
                    selected = (
                        query.filter(_hentis_group__isnull=True) if raw is None else query.filter(_hentis_group=raw)
                    )
                    count = counts.get(key, 0)
                groups.append(
                    {
                        "key": key,
                        "label": label,
                        "count": count,
                        "results": serialize_items(selected[(page - 1) * size : page * size]),
                        "has_more": count > page * size,
                    }
                )
            return Response(
                {
                    "groups": groups,
                    "count": query.count() if field.kind == "multiselect" else sum(counts.values()),
                    "page": page,
                }
            )
        count = query.count()
        return Response(
            {
                "results": serialize_items(query[(page - 1) * size : page * size]),
                "count": count,
                "page": page,
                "has_more": count > page * size,
            }
        )


class BatchValuesEndpoint(ProjectEndpoint):
    @allow_permission(READ)
    def get(self, request, slug, project_id):
        from uuid import UUID

        try:
            ids = [UUID(key) for key in request.query_params.get("ids", "").split(",") if key]
        except ValueError:
            raise ValidationError("Identificador de tarefa inválido.")
        if len(ids) > 100:
            raise ValidationError("Máximo de 100 tarefas por consulta.")
        return Response(values_for(list(self.items(include_archived=True).filter(pk__in=ids))))


class ViewsEndpoint(ProjectEndpoint):
    @allow_permission(READ)
    def get(self, request, slug, project_id):
        views = SavedView.objects.filter(project=self.project()).filter(Q(shared=True) | Q(owner=request.user))
        return Response(SavedViewSerializer(views, many=True).data)

    @allow_permission(WRITE)
    def post(self, request, slug, project_id):
        project = self.project()
        serializer = SavedViewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        view_config(project.id, serializer.validated_data.get("config", {}))
        serializer.save(project=project, owner=request.user)
        return Response(serializer.data, status=201)


class ViewEndpoint(ProjectEndpoint):
    @allow_permission(WRITE)
    def delete(self, request, slug, project_id, view_id):
        view = get_object_or_404(SavedView, project=self.project(), pk=view_id)
        if view.owner_id != request.user.id and not self.can_manage():
            return Response({"detail": "Somente o autor ou administrador pode excluir esta visualização."}, status=403)
        view.delete()
        return Response(status=204)
