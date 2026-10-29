from uuid import UUID

from django.db.models import Q, OuterRef, Subquery
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from plane.authentication.session import BaseSessionAuthentication
from plane.db.models import Page, Project, ProjectPage, ProjectMember, Workspace, WorkspaceMember


class PersonalPagesEndpoint(APIView):
    authentication_classes = [BaseSessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug)
        if not WorkspaceMember.objects.filter(
            workspace=workspace, member=request.user, is_active=True, role__in=[5, 15, 20]
        ).exists():
            raise PermissionDenied()
        members = ProjectMember.objects.filter(
            workspace=workspace, member=request.user, is_active=True, role__in=[5, 15, 20]
        )
        creatable_projects = (
            Project.objects.filter(
                workspace=workspace,
                archived_at__isnull=True,
                page_view=True,
                id__in=members.filter(role__in=[15, 20]).values("project_id"),
            )
            .order_by("name", "id")
            .values("id", "name", "identifier")
        )
        # All conditions apply to one active project link. Ownership never bypasses
        # project membership, and restricted guests only see their own pages.
        links = ProjectPage.objects.filter(
            page_id=OuterRef("pk"),
            workspace=workspace,
            project__workspace=workspace,
            project__deleted_at__isnull=True,
            project__archived_at__isnull=True,
            project_id__in=members.values("project_id"),
        ).filter(
            Q(project_id__in=members.filter(role__in=[15, 20]).values("project_id"))
            | Q(project__guest_view_all_features=True)
            | Q(page__owned_by=request.user)
        )
        project = request.query_params.get("project", "")
        if project:
            try:
                project = UUID(project)
            except ValueError:
                raise ValidationError("Projeto inválido.")
            if not members.filter(project_id=project).exists():
                raise PermissionDenied()
            links = links.filter(project_id=project)
        links = links.order_by("project__name", "project_id")
        pages = (
            Page.objects.filter(workspace=workspace, parent__isnull=True)
            .filter(Q(owned_by=request.user) | Q(access=Page.PUBLIC_ACCESS))
            .annotate(
                visible_project_id=Subquery(links.values("project_id")[:1]),
                project_name=Subquery(links.values("project__name")[:1]),
                project_identifier=Subquery(links.values("project__identifier")[:1]),
            )
            .filter(visible_project_id__isnull=False)
        )
        scope = request.query_params.get("scope", "all")
        if scope not in {"all", "mine", "shared"}:
            raise ValidationError("Filtro de páginas inválido.")
        if scope == "mine":
            pages = pages.filter(Q(owned_by=request.user) | Q(created_by=request.user))
        elif scope == "shared":
            pages = pages.exclude(owned_by=request.user).exclude(created_by=request.user)
        if request.query_params.get("archived", "0") != "1":
            pages = pages.filter(archived_at__isnull=True)
        term = request.query_params.get("search", "").strip()
        if len(term) > 200:
            raise ValidationError("Busca limitada a 200 caracteres.")
        if term:
            pages = pages.filter(name__icontains=term)
        try:
            number = int(request.query_params.get("page", "1"))
            if number < 1 or number > 100000:
                raise ValueError()
        except (ValueError, TypeError):
            raise ValidationError("Página inválida.")
        count = pages.count()
        rows = pages.order_by("-updated_at", "-id").values(
            "id",
            "name",
            "owned_by_id",
            "created_by_id",
            "updated_at",
            "access",
            "archived_at",
            "visible_project_id",
            "project_name",
            "project_identifier",
        )[(number - 1) * 30 : number * 30]
        response = Response(
            {
                "count": count,
                "page": number,
                "page_size": 30,
                "creatable_projects": list(creatable_projects),
                "results": [
                    {
                        "id": row["id"],
                        "name": row["name"],
                        "project_id": row["visible_project_id"],
                        "project_name": row["project_name"],
                        "project_identifier": row["project_identifier"],
                        "updated_at": row["updated_at"],
                        "archived": row["archived_at"] is not None,
                        "mine": row["owned_by_id"] == request.user.id or row["created_by_id"] == request.user.id,
                        "url": f"/{slug}/projects/{row['visible_project_id']}/pages/{row['id']}/",
                    }
                    for row in rows
                ],
            }
        )
        response["Cache-Control"] = "no-store"
        return response
