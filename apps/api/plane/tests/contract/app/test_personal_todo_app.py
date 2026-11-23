# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import date

import pytest
from django.urls import reverse
from freezegun import freeze_time
from rest_framework import status

from plane.db.models import PersonalTodo, User, Workspace, WorkspaceMember


@pytest.mark.contract
@pytest.mark.django_db
class TestPersonalTodo:
    def test_create_edit_complete_and_reopen(self, session_client, create_user, workspace):
        list_url = reverse("workspace-personal-todos", kwargs={"slug": workspace.slug})
        response = session_client.post(list_url, {"title": "  Pick up package  "}, format="json")

        assert response.status_code == status.HTTP_201_CREATED
        todo = PersonalTodo.objects.get(pk=response.data["id"])
        assert todo.owner == create_user
        assert todo.workspace == workspace
        assert todo.title == "Pick up package"
        assert todo.due_date is None
        assert todo.priority == "none"
        assert not todo.is_completed

        detail_url = reverse("workspace-personal-todo", kwargs={"slug": workspace.slug, "pk": todo.pk})
        response = session_client.patch(detail_url, {"title": "Updated title", "priority": "high"}, format="json")
        assert response.status_code == status.HTTP_200_OK
        assert response.data["title"] == "Updated title"
        assert response.data["priority"] == "high"

        response = session_client.patch(detail_url, {"is_completed": True}, format="json")
        assert response.status_code == status.HTTP_200_OK
        assert session_client.get(list_url, {"view": "unscheduled"}).data["results"] == []
        assert session_client.get(list_url, {"view": "completed"}).data["results"][0]["id"] == str(todo.id)

        response = session_client.patch(detail_url, {"is_completed": False}, format="json")
        assert response.status_code == status.HTTP_200_OK
        assert session_client.get(list_url, {"view": "completed"}).data["results"] == []
        assert session_client.get(list_url, {"view": "unscheduled"}).data["results"][0]["id"] == str(todo.id)

    @freeze_time("2026-11-23 02:00:00")
    def test_views_use_the_users_local_day(self, session_client, create_user, workspace):
        create_user.user_timezone = "America/Sao_Paulo"
        create_user.save(update_fields=["user_timezone"])
        for title, due_date in [
            ("Overdue", date(2026, 11, 21)),
            ("Today", date(2026, 11, 22)),
            ("Upcoming", date(2026, 11, 23)),
            ("No date", None),
        ]:
            PersonalTodo.objects.create(workspace=workspace, owner=create_user, title=title, due_date=due_date)

        url = reverse("workspace-personal-todos", kwargs={"slug": workspace.slug})
        for view, expected in [
            ("today", ["Overdue", "Today"]),
            ("upcoming", ["Upcoming"]),
            ("unscheduled", ["No date"]),
        ]:
            response = session_client.get(url, {"view": view})
            assert response.status_code == status.HTTP_200_OK
            assert response.data["today"] == "2026-11-22"
            assert [todo["title"] for todo in response.data["results"]] == expected

        assert session_client.get(url, {"view": "other"}).status_code == status.HTTP_400_BAD_REQUEST

    def test_list_and_update_are_scoped_to_owner_and_workspace(self, session_client, create_user, workspace):
        other_user = User.objects.create(email="other@plane.so", username="other")
        WorkspaceMember.objects.create(workspace=workspace, member=other_user, role=15)
        other_workspace = Workspace.objects.create(name="Other", slug="other-workspace", owner=create_user)
        WorkspaceMember.objects.create(workspace=other_workspace, member=create_user, role=20)
        own = PersonalTodo.objects.create(workspace=workspace, owner=create_user, title="Mine")
        hidden = [
            PersonalTodo.objects.create(workspace=workspace, owner=other_user, title="Someone else's task"),
            PersonalTodo.objects.create(workspace=other_workspace, owner=create_user, title="Another workspace"),
        ]

        url = reverse("workspace-personal-todos", kwargs={"slug": workspace.slug})
        response = session_client.get(url, {"view": "unscheduled"})
        assert response.status_code == status.HTTP_200_OK
        assert [item["id"] for item in response.data["results"]] == [str(own.id)]
        for task in hidden:
            detail = reverse("workspace-personal-todo", kwargs={"slug": workspace.slug, "pk": task.pk})
            response = session_client.patch(detail, {"is_completed": True}, format="json")
            assert response.status_code == status.HTTP_404_NOT_FOUND
            task.refresh_from_db()
            assert not task.is_completed

        WorkspaceMember.objects.filter(workspace=workspace, member=create_user).update(is_active=False)
        assert session_client.get(url).status_code == status.HTTP_403_FORBIDDEN
        assert (
            session_client.post(url, {"title": "No longer a member"}, format="json").status_code
            == status.HTTP_403_FORBIDDEN
        )

    def test_pagination_returns_disjoint_pages(self, session_client, create_user, workspace):
        PersonalTodo.objects.bulk_create(
            [PersonalTodo(workspace=workspace, owner=create_user, title=f"Task {index}") for index in range(51)]
        )
        url = reverse("workspace-personal-todos", kwargs={"slug": workspace.slug})
        first = session_client.get(url, {"view": "unscheduled", "page": 1}).data
        last = session_client.get(url, {"view": "unscheduled", "page": 2}).data

        assert len(first["results"]) == 50
        assert first["next"]
        assert len(last["results"]) == 1
        assert not last["next"]
        assert last["results"][0]["id"] not in {task["id"] for task in first["results"]}
