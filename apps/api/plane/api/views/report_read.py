# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Read-only report endpoints. API keys retain their owner's normal access."""

from urllib.parse import quote
from uuid import UUID

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from plane.api.views.base import BaseAPIView
from plane.app.permissions import ProjectEntityPermission, ProjectPagePermission, ROLE
from plane.custom_fields.models import Field
from plane.custom_fields.serializers import FieldSerializer
from plane.custom_fields.services import values_for
from plane.db.models import Issue, Page, Project, ProjectMember, WorkspaceMember


class ReportReadEndpoint(BaseAPIView):
    # Explicitly disallow writes even if a future superclass adds handlers.
    http_method_names = ["get", "head", "options"]
    permission_classes = [IsAuthenticated, ProjectEntityPermission]

    def authorized_project(self):
        project = get_object_or_404(
            Project.objects,
            pk=self.kwargs["project_id"],
            workspace__slug=self.kwargs["slug"],
            workspace__deleted_at__isnull=True,
            archived_at__isnull=True,
        )
        # No workspace-admin or page-owner bypass of active membership.
        if not WorkspaceMember.objects.filter(
            workspace=project.workspace, member=self.request.user,
            is_active=True, role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value, ROLE.GUEST.value],
        ).exists():
            raise PermissionDenied("You do not have access to this workspace.")
        member = get_object_or_404(
            ProjectMember.objects,
            project=project, workspace=project.workspace,
            member=self.request.user, is_active=True,
            role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value, ROLE.GUEST.value],
        )
        return project, member


class ReportPagesBase(ReportReadEndpoint):
    # Reuse the native page ACL, including exact project linkage and private owner.
    permission_classes = [IsAuthenticated, ProjectPagePermission]

    def pages_for(self, project, member, user):
        query = Page.objects.filter(
            workspace=project.workspace,
            project_pages__project=project,
            project_pages__workspace=project.workspace,
            project_pages__deleted_at__isnull=True,
            # The native CE PageViewSet detail queryset serves root pages only.
            parent__isnull=True,
        ).filter(Q(owned_by=user) | Q(access=Page.PUBLIC_ACCESS))
        if member.role == ROLE.GUEST.value and not project.guest_view_all_features:
            query = query.filter(owned_by=user)
        return query.distinct()

    def page_metadata(self, page, request, slug, project_id):
        return {
            "id": str(page.id),
            "name": page.name,
            "url": request.build_absolute_uri(
                f"/{quote(slug, safe='')}/projects/{project_id}/pages/{page.id}/"
            ),
            "created_at": page.created_at,
            "updated_at": page.updated_at,
            "owned_by": str(page.owned_by_id),
            "access": page.access,
        }


class ReportPagesEndpoint(ReportPagesBase):
    def get(self, request, slug, project_id):
        project, member = self.authorized_project()
        if self.get_per_page(request, 100, 100) < 1:
            raise ValidationError("per_page must be between 1 and 100.")
        pages = self.pages_for(project, member, request.user).only(
            "id", "name", "created_at", "updated_at", "owned_by_id", "access"
        ).order_by("-created_at", "-id")
        return self.paginate(
            request=request,
            queryset=pages,
            default_per_page=100,
            max_per_page=100,
            on_results=lambda items: [
                self.page_metadata(page, request, slug, project_id) for page in items
            ],
        )


class ReportPageEndpoint(ReportPagesBase):
    def get(self, request, slug, project_id, page_id):
        project, member = self.authorized_project()
        page = get_object_or_404(self.pages_for(project, member, request.user), pk=page_id)
        # Fixed payload: no binary editor state, unrelated projects, writes or visits.
        return Response({
            **self.page_metadata(page, request, slug, project_id),
            "description_html": page.description_html,
        })


class ReportFieldsEndpoint(ReportReadEndpoint):
    def get(self, request, slug, project_id):
        project, _ = self.authorized_project()
        fields = Field.objects.filter(project=project)
        return Response({"fields": FieldSerializer(fields, many=True).data})


class ReportFieldValuesEndpoint(ReportReadEndpoint):
    def get(self, request, slug, project_id):
        project, member = self.authorized_project()
        try:
            ids = [UUID(item) for item in request.query_params.get("ids", "").split(",") if item]
        except (ValueError, TypeError, AttributeError):
            raise ValidationError("Invalid work item identifier.")
        if len(ids) > 100:
            raise ValidationError("At most 100 work items per request.")
        # Matches native BatchValuesEndpoint: include archived work items, never
        # another project's values, and restrict guests to their own work items.
        items = Issue.objects.filter(project=project, workspace=project.workspace, pk__in=ids)
        if member.role == ROLE.GUEST.value and not project.guest_view_all_features:
            items = items.filter(created_by=request.user)
        return Response(values_for(list(items)))
