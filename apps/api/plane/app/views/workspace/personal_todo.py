# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db.models import Prefetch, Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers.personal_todo import PersonalTodoSerializer, PersonalTodoWorkItemSerializer
from plane.app.views.base import BaseViewSet
from plane.db.models import Issue, PersonalTodo, Workspace
from plane.utils.issue_search import search_issues


class PersonalTodoPagination(PageNumberPagination):
    page_size = 50


class WorkspacePersonalTodoViewSet(BaseViewSet):
    model = PersonalTodo
    serializer_class = PersonalTodoSerializer
    pagination_class = PersonalTodoPagination
    filter_backends = ()

    def get_queryset(self):
        return PersonalTodo.objects.filter(workspace__slug=self.workspace_slug, owner=self.request.user)

    def get_linkable_issues(self):
        user = self.request.user
        return (
            Issue.issue_objects.filter(
                Q(project__project_projectmember__role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value])
                | Q(project__guest_view_all_features=True)
                | Q(created_by=user),
                workspace__slug=self.workspace_slug,
                project__deleted_at__isnull=True,
                project__project_projectmember__member=user,
                project__project_projectmember__is_active=True,
                project__project_projectmember__deleted_at__isnull=True,
                project__project_projectmember__role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value, ROLE.GUEST.value],
            )
            .select_related("project")
            .only("id", "name", "project", "project__identifier", "sequence_id")
            .order_by("project__identifier", "sequence_id", "id")
        )

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "linkable_issues": self.get_linkable_issues()}

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        today = timezone.localdate()
        view = request.query_params.get("view", "today")
        queryset = self.get_queryset()

        if view == "completed":
            queryset = queryset.filter(is_completed=True).order_by("-updated_at", "id")
        else:
            date_filters = {
                "today": {"due_date__lte": today},
                "upcoming": {"due_date__gt": today},
                "unscheduled": {"due_date__isnull": True},
                "all": {},
            }
            if view not in date_filters:
                raise ValidationError({"view": "Choose today, upcoming, unscheduled, all, or completed."})
            queryset = queryset.filter(is_completed=False, **date_filters[view]).order_by(
                "due_date", "-created_at", "id"
            )

        queryset = queryset.prefetch_related(
            Prefetch("linked_issues", queryset=self.get_linkable_issues(), to_attr="visible_linked_issues")
        )
        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page, many=True)
        response = self.get_paginated_response(serializer.data)
        response.data["today"] = today.isoformat()
        return response

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def search_work_items(self, request, slug):
        query = request.query_params.get("search", "").strip()[:120]
        if not query:
            return Response([])

        linkable = self.get_linkable_issues()
        project_identifier, _, sequence = query.rpartition("-")
        if project_identifier and sequence.isascii() and sequence.isdecimal():
            exact = linkable.filter(project__identifier__iexact=project_identifier, sequence_id=int(sequence)).first()
            if exact:
                return Response(PersonalTodoWorkItemSerializer([exact], many=True).data)

        issues = search_issues(query, linkable).order_by("-updated_at", "id")[:20]
        return Response(PersonalTodoWorkItemSerializer(issues, many=True).data)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def create(self, request, slug):
        return super().create(request, slug)

    def perform_create(self, serializer):
        workspace = Workspace.objects.get(slug=self.workspace_slug)
        serializer.save(workspace=workspace, owner=self.request.user)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def partial_update(self, request, *args, **kwargs):
        return super().partial_update(request, *args, **kwargs)
