from uuid import UUID

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.db.models import Module, State, WorkspaceMember, ProjectMember
from .models import ModuleStateVisibility
from .views import ProjectEndpoint, READ


class ModuleStatesEndpoint(ProjectEndpoint):
    def checked_project(self):
        project = self.project()
        if not WorkspaceMember.objects.filter(
            workspace=project.workspace, member=self.request.user, is_active=True, role__in=[5, 15, 20]
        ).exists():
            raise PermissionDenied()
        if not ProjectMember.objects.filter(
            project=project, workspace=project.workspace, member=self.request.user, is_active=True, role__in=[5, 15, 20]
        ).exists():
            raise PermissionDenied()
        return project

    def states(self, project):
        return State.objects.filter(project=project, is_triage=False).order_by("sequence", "id")

    @allow_permission(READ)
    def get(self, request, slug, project_id, module_id=None):
        project = self.checked_project()
        modules = Module.objects.filter(project=project, workspace=project.workspace, archived_at__isnull=True)
        states = list(self.states(project).values("id", "name", "color", "group"))
        known = {str(state["id"]) for state in states}
        configs = {
            str(row.module_id): [key for key in row.state_ids if key in known] or None
            for row in ModuleStateVisibility.objects.filter(module__in=modules)
        }
        if module_id is not None:
            module = get_object_or_404(modules, pk=module_id)
            # Include occupied states even outside the selection: no tasks disappear,
            # including those on later pages. items() applies the guest's task ACL.
            occupied = (
                self.items()
                .filter(issue_module__module=module, issue_module__deleted_at__isnull=True)
                .order_by()
                .values_list("state_id", flat=True)
                .distinct()
            )
            return Response(
                {"state_ids": configs.get(str(module.id)), "occupied_state_ids": [str(key) for key in occupied if key]}
            )
        return Response(
            {
                "states": states,
                "modules": [
                    {"id": str(module.id), "name": module.name, "state_ids": configs.get(str(module.id))}
                    for module in modules.order_by("name", "id")
                ],
                "can_manage": self.can_manage(),
            }
        )

    @allow_permission([ROLE.ADMIN])
    def patch(self, request, slug, project_id, module_id):
        project = self.checked_project()
        if project.archived_at:
            raise ValidationError("O projeto está arquivado.")
        if not isinstance(request.data, dict) or set(request.data) != {"state_ids"}:
            raise ValidationError("Informe somente state_ids.")
        raw = request.data["state_ids"]
        known = {str(key) for key in self.states(project).values_list("id", flat=True)}
        if raw is not None:
            if not isinstance(raw, list) or not raw or len(raw) > 1000:
                raise ValidationError("Escolha pelo menos um estado ou use todos os estados do projeto.")
            try:
                raw = list(dict.fromkeys(str(UUID(key)) for key in raw))
            except (ValueError, TypeError, AttributeError):
                raise ValidationError("Identificador de estado inválido.")
            if set(raw) - known:
                raise ValidationError("Estado inexistente, de outro projeto ou de triagem.")
        with transaction.atomic():
            module = get_object_or_404(
                Module.objects.select_for_update(),
                pk=module_id,
                project=project,
                workspace=project.workspace,
                archived_at__isnull=True,
            )
            if raw is None:
                ModuleStateVisibility.objects.filter(module=module).delete()
            else:
                ModuleStateVisibility.objects.update_or_create(module=module, defaults={"state_ids": raw})
        return Response({"state_ids": raw})
