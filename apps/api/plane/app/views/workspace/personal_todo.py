# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination

from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers.personal_todo import PersonalTodoSerializer
from plane.app.views.base import BaseViewSet
from plane.db.models import PersonalTodo, Workspace


class PersonalTodoPagination(PageNumberPagination):
    page_size = 50


class WorkspacePersonalTodoViewSet(BaseViewSet):
    model = PersonalTodo
    serializer_class = PersonalTodoSerializer
    pagination_class = PersonalTodoPagination
    filter_backends = ()

    def get_queryset(self):
        return PersonalTodo.objects.filter(workspace__slug=self.workspace_slug, owner=self.request.user)

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
            }
            if view not in date_filters:
                raise ValidationError({"view": "Choose today, upcoming, unscheduled, or completed."})
            queryset = queryset.filter(is_completed=False, **date_filters[view]).order_by(
                "due_date", "-created_at", "id"
            )

        page = self.paginate_queryset(queryset)
        response = self.get_paginated_response(self.get_serializer(page, many=True).data)
        response.data["today"] = today.isoformat()
        return response

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def create(self, request, slug):
        return super().create(request, slug)

    def perform_create(self, serializer):
        workspace = Workspace.objects.get(slug=self.workspace_slug)
        serializer.save(workspace=workspace, owner=self.request.user)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def partial_update(self, request, *args, **kwargs):
        return super().partial_update(request, *args, **kwargs)
