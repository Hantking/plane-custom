# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import date

import pytest
from django.urls import reverse
from freezegun import freeze_time
from rest_framework import status

from plane.db.models import Issue, PersonalTodo, Project, ProjectMember, User, Workspace, WorkspaceMember


@pytest.fixture
def work_item(workspace, create_user):
    project = Project.objects.create(name="Operations", identifier="OPS", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=15)
    return Issue.objects.create(project=project, name="Prepare the closing report")


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
        PersonalTodo.objects.create(workspace=workspace, owner=create_user, title="Completed", is_completed=True)

        url = reverse("workspace-personal-todos", kwargs={"slug": workspace.slug})
        for view, expected in [
            ("today", ["Overdue", "Today"]),
            ("upcoming", ["Upcoming"]),
            ("unscheduled", ["No date"]),
            ("all", ["Overdue", "Today", "Upcoming", "No date"]),
            ("completed", ["Completed"]),
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
        response = session_client.get(url, {"view": "all"})
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

    @pytest.mark.parametrize("view", ["unscheduled", "all"])
    def test_pagination_returns_disjoint_pages(self, session_client, create_user, workspace, view):
        PersonalTodo.objects.bulk_create(
            [PersonalTodo(workspace=workspace, owner=create_user, title=f"Task {index}") for index in range(51)]
        )
        url = reverse("workspace-personal-todos", kwargs={"slug": workspace.slug})
        first = session_client.get(url, {"view": view, "page": 1}).data
        last = session_client.get(url, {"view": view, "page": 2}).data

        assert len(first["results"]) == 50
        assert first["next"]
        assert len(last["results"]) == 1
        assert not last["next"]
        assert last["results"][0]["id"] not in {task["id"] for task in first["results"]}

    def test_create_change_and_remove_work_item_link(self, session_client, create_user, workspace, work_item):
        url = reverse("workspace-personal-todos", kwargs={"slug": workspace.slug})
        created = session_client.post(url, {"title": "Follow up", "linked_issue_id": str(work_item.id)}, format="json")
        assert created.status_code == status.HTTP_201_CREATED
        assert created.data["linked_issue"] == {
            "id": str(work_item.id),
            "name": work_item.name,
            "project_id": str(work_item.project_id),
            "project_identifier": "OPS",
            "sequence_id": work_item.sequence_id,
        }
        todo = PersonalTodo.objects.get(pk=created.data["id"])
        assert list(todo.linked_issues.values_list("pk", flat=True)) == [work_item.id]
        assert session_client.get(url, {"view": "unscheduled"}).data["results"][0]["linked_issue"]["id"] == str(
            work_item.id
        )

        detail = reverse("workspace-personal-todo", kwargs={"slug": workspace.slug, "pk": todo.id})
        replacement = Issue.objects.create(project=work_item.project, name="Review the next report")
        updated = session_client.patch(detail, {"linked_issue_id": str(replacement.id)}, format="json")
        assert updated.status_code == status.HTTP_200_OK
        assert updated.data["linked_issue"]["id"] == str(replacement.id)

        previous_update = replacement.updated_at
        completed = session_client.patch(detail, {"is_completed": True}, format="json")
        assert completed.status_code == status.HTTP_200_OK
        replacement.refresh_from_db()
        assert replacement.updated_at == previous_update

        unlinked = session_client.patch(detail, {"linked_issue_id": None}, format="json")
        assert unlinked.status_code == status.HTTP_200_OK
        assert unlinked.data["linked_issue"] is None
        todo.refresh_from_db()
        assert not todo.linked_issues.exists()
        assert Issue.objects.filter(pk__in=[work_item.id, replacement.id]).count() == 2

    def test_saves_multiple_links_and_applies_changes_independently(self, session_client, workspace, work_item):
        second = Issue.objects.create(project=work_item.project, name="Review totals")
        third = Issue.objects.create(project=work_item.project, name="Send the report")
        first_id, second_id, third_id = map(str, (work_item.id, second.id, third.id))
        list_url = reverse("workspace-personal-todos", kwargs={"slug": workspace.slug})
        created = session_client.post(
            list_url,
            {"title": "Follow up", "link_changes": {"add": [first_id, second_id, first_id]}},
            format="json",
        )
        assert created.status_code == status.HTTP_201_CREATED
        assert [item["id"] for item in created.data["linked_issues"]] == [first_id, second_id]
        todo = PersonalTodo.objects.get(pk=created.data["id"])
        detail = reverse("workspace-personal-todo", kwargs={"slug": workspace.slug, "pk": todo.id})

        # Independent edits from a form opened earlier must not overwrite the other links.
        assert session_client.patch(detail, {"link_changes": {"add": [third_id]}}, format="json").status_code == 200
        for _ in range(2):
            edited = session_client.patch(detail, {"link_changes": {"remove": [first_id]}}, format="json")
            assert edited.status_code == status.HTTP_200_OK
            assert [item["id"] for item in edited.data["linked_issues"]] == [second_id, third_id]
        assert Issue.objects.filter(pk=work_item.id).exists()

        listed = session_client.get(list_url, {"view": "all"}).data["results"][0]
        assert [item["id"] for item in listed["linked_issues"]] == [second_id, third_id]
        second.delete(soft=False)
        listed = session_client.get(list_url, {"view": "all"}).data["results"][0]
        assert [item["id"] for item in listed["linked_issues"]] == [third_id]

    def test_rejects_mixed_access_and_preserves_hidden_links(self, session_client, create_user, workspace, work_item):
        other_project = Project.objects.create(name="Planning", identifier="PLAN", workspace=workspace)
        ProjectMember.objects.create(project=other_project, member=create_user, role=15)
        visible_issue = Issue.objects.create(project=other_project, name="Prepare schedule")
        todo = PersonalTodo.objects.create(title="Private reminder", workspace=workspace, owner=create_user)
        todo.linked_issues.add(work_item)
        ProjectMember.objects.filter(project=work_item.project, member=create_user).update(is_active=False)
        detail = reverse("workspace-personal-todo", kwargs={"slug": workspace.slug, "pk": todo.id})
        hidden_id, visible_id = str(work_item.id), str(visible_issue.id)
        denied = session_client.patch(detail, {"link_changes": {"add": [visible_id, hidden_id]}}, format="json")
        assert denied.status_code == status.HTTP_400_BAD_REQUEST
        assert set(todo.linked_issues.values_list("pk", flat=True)) == {work_item.id}

        updated = session_client.patch(
            detail,
            {"link_changes": {"add": [visible_id], "remove": [hidden_id]}},
            format="json",
        )
        assert updated.status_code == status.HTTP_200_OK
        assert [item["id"] for item in updated.data["linked_issues"]] == [visible_id]
        assert set(todo.linked_issues.values_list("pk", flat=True)) == {work_item.id, visible_issue.id}

    def test_search_limits_links_to_accessible_work_items(self, session_client, create_user, workspace, work_item):
        other_workspace = Workspace.objects.create(name="Other", slug="another-workspace", owner=create_user)
        WorkspaceMember.objects.create(workspace=other_workspace, member=create_user, role=20)
        other_project = Project.objects.create(name="Other", identifier="OUT", workspace=other_workspace)
        ProjectMember.objects.create(project=other_project, member=create_user, role=15)
        outside = Issue.objects.create(project=other_project, name=work_item.name)
        restricted = Project.objects.create(name="Private", identifier="LOCK", workspace=workspace, network=0)
        hidden = Issue.objects.create(project=restricted, name=work_item.name)
        search_url = reverse("workspace-personal-todo-work-items", kwargs={"slug": workspace.slug})
        listed = session_client.get(search_url, {"search": "closing report"})
        assert listed.status_code == status.HTTP_200_OK
        assert [item["id"] for item in listed.data] == [str(work_item.id)]
        by_code = session_client.get(search_url, {"search": f"ops-{work_item.sequence_id}"})
        assert [item["id"] for item in by_code.data] == [str(work_item.id)]

        list_url = reverse("workspace-personal-todos", kwargs={"slug": workspace.slug})
        todo = PersonalTodo.objects.create(title="Personal", workspace=workspace, owner=create_user)
        detail = reverse("workspace-personal-todo", kwargs={"slug": workspace.slug, "pk": todo.id})
        for issue in [outside, hidden]:
            assert (
                session_client.post(
                    list_url, {"title": "Follow up", "linked_issue_id": str(issue.id)}, format="json"
                ).status_code
                == status.HTTP_400_BAD_REQUEST
            )
            denied = session_client.patch(detail, {"linked_issue_id": str(issue.id)}, format="json")
            assert denied.status_code == status.HTTP_400_BAD_REQUEST
            assert "linked_issue_id" in denied.data
        todo.refresh_from_db()
        assert not todo.linked_issues.exists()

    def test_hides_link_if_project_access_is_lost(self, session_client, create_user, workspace, work_item):
        todo = PersonalTodo.objects.create(title="Private reminder", workspace=workspace, owner=create_user)
        todo.linked_issues.add(work_item)
        ProjectMember.objects.filter(project=work_item.project, member=create_user).update(is_active=False)
        list_url = reverse("workspace-personal-todos", kwargs={"slug": workspace.slug})
        payload = session_client.get(list_url, {"view": "unscheduled"}).data["results"][0]
        assert payload["id"] == str(todo.id)
        assert payload["linked_issue"] is None
        assert "linked_issue_id" not in payload

        detail = reverse("workspace-personal-todo", kwargs={"slug": workspace.slug, "pk": todo.id})
        updated = session_client.patch(detail, {"is_completed": True}, format="json")
        assert updated.status_code == status.HTTP_200_OK
        assert updated.data["linked_issue"] is None

        ProjectMember.objects.filter(project=work_item.project, member=create_user).update(is_active=True, role=5)
        Project.objects.filter(pk=work_item.project_id).update(guest_view_all_features=False)
        assert session_client.get(list_url, {"view": "completed"}).data["results"][0]["linked_issue"] is None

        Issue.objects.filter(pk=work_item.id).update(created_by=create_user)
        assert session_client.get(list_url, {"view": "completed"}).data["results"][0]["linked_issue"]["id"] == str(
            work_item.id
        )
