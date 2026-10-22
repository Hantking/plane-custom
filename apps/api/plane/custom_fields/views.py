import json

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError, PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from plane.app.permissions import ROLE, allow_permission
from plane.authentication.session import BaseSessionAuthentication
from plane.db.models import Issue, Project, ProjectMember, WorkspaceMember

from .models import Change, Field, SavedView, NativeLayoutPreference
from .serializers import FieldSerializer, SavedViewSerializer
from .services import field_annotation, move_selection, save_values, validate_values, values_for
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
            rewrite_views(field, deleting=True, native_delete=True)
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
                from .list_api import check_expected

                check_expected(issue, prepared, request.data.get("expected"))
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
    from .query import normalize_query

    result = normalize_query(project_id, config)
    if result.get("manual") or result.get("manual_order"):
        raise ValidationError("Ordem manual é uma preferência pessoal da Lista, não configuração compartilhada.")
    return result


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
        from .query import apply_query, group_query

        query = apply_query(self.items(), project_id, config)
        group = config.get("group_by")
        size = 25
        if group:
            from .query import group_options, compatible_group

            field, _ = field_annotation(project_id, group)
            options = group_options(field)
            requested = request.query_params.get("group_value")
            groups = []
            if requested is not None and requested not in {key for key, _ in options}:
                raise ValidationError("Grupo inválido.")
            for key, label in options:
                if not compatible_group(config["filter_tree"], field, key):
                    continue
                if requested is not None and requested != key:
                    continue
                selected = group_query(query, project_id, config, field, key)
                count = selected.count()
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
                    "count": query.count(),
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
        if serializer.validated_data.get("locked") and not self.can_manage():
            raise PermissionDenied("Somente administradores podem bloquear Views.")
        config = view_config(project.id, serializer.validated_data.get("config", {}))
        serializer.save(project=project, owner=request.user, config=config, schema_version=2)
        return Response(serializer.data, status=201)


class ViewEndpoint(ProjectEndpoint):
    @allow_permission(WRITE)
    def patch(self, request, slug, project_id, view_id):
        from .list_api import Conflict

        with transaction.atomic():
            view = get_object_or_404(SavedView.objects.select_for_update(), project=self.project(), pk=view_id)
            if view.owner_id != request.user.id and not self.can_manage():
                return Response({"detail": "Somente o autor ou administrador pode atualizar a View."}, status=403)
            if request.data.get("revision") != view.revision:
                raise Conflict("A View mudou. Recarregue antes de salvar.")
            if view.locked and not self.can_manage():
                raise PermissionDenied("View bloqueada pelo administrador.")
            if "locked" in request.data and not self.can_manage():
                raise PermissionDenied("Somente administradores podem bloquear/desbloquear Views.")
            data = {key: value for key, value in request.data.items() if key != "revision"}
            serializer = SavedViewSerializer(view, data=data, partial=True)
            serializer.is_valid(raise_exception=True)
            config = view_config(project_id, serializer.validated_data.get("config", view.config))
            serializer.save(config=config, revision=view.revision + 1, schema_version=2)
        return Response(serializer.data)

    @allow_permission(WRITE)
    def delete(self, request, slug, project_id, view_id):
        view = get_object_or_404(SavedView, project=self.project(), pk=view_id)
        if view.locked and not self.can_manage():
            raise PermissionDenied("View bloqueada pelo administrador.")
        if view.owner_id != request.user.id and not self.can_manage():
            return Response({"detail": "Somente o autor ou administrador pode excluir esta visualização."}, status=403)
        with transaction.atomic():
            for preference in NativeLayoutPreference.objects.select_for_update().filter(
                workspace=self.project().workspace, query_config__view_id=str(view.id)
            ):
                config = dict(preference.query_config)
                config.pop("view_id", None)
                preference.query_config = config
                preference.save(update_fields=["query_config", "updated_at"])
            view.delete()
        return Response(status=204)
