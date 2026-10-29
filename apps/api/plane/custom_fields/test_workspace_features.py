from uuid import uuid4
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import (
    User,
    Workspace,
    WorkspaceMember,
    Project,
    ProjectMember,
    Module,
    ModuleIssue,
    State,
    Issue,
    Page,
    ProjectPage,
)
from .models import ModuleStateVisibility


class WorkspaceFeaturesTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create(email="features-admin@test.local", username="features-admin")
        cls.member = User.objects.create(email="features-member@test.local", username="features-member")
        cls.guest = User.objects.create(email="features-guest@test.local", username="features-guest")
        cls.outsider = User.objects.create(email="features-outsider@test.local", username="features-outsider")
        cls.workspace = Workspace.objects.create(name="Features", slug="features", owner=cls.admin)
        cls.other_workspace = Workspace.objects.create(
            name="Other workspace", slug="features-other", owner=cls.outsider
        )
        for user, role in [(cls.admin, 20), (cls.member, 15), (cls.guest, 5)]:
            WorkspaceMember.objects.create(workspace=cls.workspace, member=user, role=role)
        cls.project = Project.objects.create(workspace=cls.workspace, name="Main", identifier="MAIN")
        cls.second = Project.objects.create(workspace=cls.workspace, name="Second", identifier="SECOND")
        cls.hidden = Project.objects.create(workspace=cls.workspace, name="Hidden", identifier="HIDDEN")
        cls.foreign = Project.objects.create(workspace=cls.other_workspace, name="Foreign", identifier="FOREIGN")
        for project in [cls.project, cls.second]:
            for user, role in [(cls.admin, 20), (cls.member, 15), (cls.guest, 5)]:
                ProjectMember.objects.create(workspace=cls.workspace, project=project, member=user, role=role)
        cls.module = Module.objects.create(workspace=cls.workspace, project=cls.project, name="Implementation")
        cls.second_module = Module.objects.create(workspace=cls.workspace, project=cls.project, name="Support")
        cls.todo = State.objects.create(
            workspace=cls.workspace, project=cls.project, name="Todo", group="unstarted", color="#888888"
        )
        cls.done = State.objects.create(
            workspace=cls.workspace, project=cls.project, name="Done", group="completed", color="#00ff00"
        )
        cls.foreign_state = State.objects.create(
            workspace=cls.workspace, project=cls.second, name="Other", group="unstarted", color="#888888"
        )
        cls.legacy_issue = Issue.objects.create(
            workspace=cls.workspace, project=cls.project, name="Legacy state", state=cls.done
        )
        cls.guest_issue = Issue.objects.create(
            workspace=cls.workspace, project=cls.project, name="Guest task", state=cls.todo
        )
        Issue.objects.filter(pk=cls.legacy_issue.pk).update(created_by=cls.admin)
        Issue.objects.filter(pk=cls.guest_issue.pk).update(created_by=cls.guest)
        for issue in [cls.legacy_issue, cls.guest_issue]:
            ModuleIssue.objects.create(workspace=cls.workspace, project=cls.project, module=cls.module, issue=issue)

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.states = f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/module-states/"
        self.pages = f"/api/workspaces/{self.workspace.slug}/personal-pages/"

    def make_page(self, name, project=None, owner=None, access=Page.PUBLIC_ACCESS, archived=False):
        project = project or self.project
        page = Page.objects.create(
            workspace=project.workspace,
            owned_by=owner or self.admin,
            name=name,
            access=access,
            archived_at=timezone.now().date() if archived else None,
        )
        ProjectPage.objects.create(workspace=project.workspace, project=project, page=page)
        return page

    def ids(self, response):
        self.assertEqual(response.status_code, 200, response.data)
        return {str(row["id"]) for row in response.data["results"]}

    def test_module_visibility_admin_save_reload_reset_and_existing_tasks(self):
        url = self.states + f"{self.module.id}/"
        self.assertIsNone(self.client.get(url).data["state_ids"])
        response = self.client.patch(url, {"state_ids": [str(self.todo.id)]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.client.get(url).data["state_ids"], [str(self.todo.id)])
        self.assertEqual(set(self.client.get(url).data["occupied_state_ids"]), {str(self.todo.id), str(self.done.id)})
        self.legacy_issue.refresh_from_db()
        self.assertEqual(self.legacy_issue.state_id, self.done.id)
        self.assertIsNone(self.client.get(self.states + f"{self.second_module.id}/").data["state_ids"])
        self.assertEqual(self.client.patch(url, {"state_ids": None}, format="json").status_code, 200)
        self.assertFalse(ModuleStateVisibility.objects.filter(module=self.module).exists())

    def test_module_visibility_rejects_other_project_states_and_bad_payloads_atomically(self):
        url = self.states + f"{self.module.id}/"
        self.client.patch(url, {"state_ids": [str(self.todo.id)]}, format="json")
        for payload in [
            {"state_ids": []},
            {"state_ids": [str(self.foreign_state.id)]},
            {"state_ids": [str(uuid4())]},
            {"state_ids": [True]},
            {"state_ids": "all"},
            {"state_ids": None, "extra": True},
        ]:
            self.assertEqual(self.client.patch(url, payload, format="json").status_code, 400, payload)
        self.assertEqual(ModuleStateVisibility.objects.get(module=self.module).state_ids, [str(self.todo.id)])
        other_module = Module.objects.create(workspace=self.workspace, project=self.second, name="Other project module")
        self.assertEqual(self.client.get(self.states + f"{other_module.id}/").status_code, 404)
        self.assertEqual(
            self.client.patch(self.states + f"{other_module.id}/", {"state_ids": None}, format="json").status_code, 404
        )

    def test_module_visibility_members_read_guests_only_see_own_occupied_states(self):
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.get(self.states).status_code, 200)
        self.assertEqual(
            self.client.patch(self.states + f"{self.module.id}/", {"state_ids": None}, format="json").status_code, 403
        )
        self.client.force_authenticate(self.guest)
        response = self.client.get(self.states + f"{self.module.id}/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["occupied_state_ids"], [str(self.todo.id)])
        self.client.force_authenticate(self.outsider)
        self.assertEqual(self.client.get(self.states).status_code, 403)

    def test_module_visibility_archived_module_and_revoked_workspace_are_denied(self):
        hidden_path = f"/api/workspaces/{self.workspace.slug}/projects/{self.hidden.id}/module-states/"
        self.assertEqual(self.client.get(hidden_path).status_code, 403)
        Module.objects.filter(pk=self.module.id).update(archived_at=timezone.now())
        self.assertEqual(self.client.get(self.states + f"{self.module.id}/").status_code, 404)
        WorkspaceMember.objects.filter(workspace=self.workspace, member=self.admin).update(is_active=False)
        self.assertEqual(self.client.get(self.states).status_code, 403)

    def test_personal_pages_unites_projects_private_owner_and_shared_without_duplicates(self):
        own = self.make_page("Own private", access=Page.PRIVATE_ACCESS)
        shared = self.make_page("Shared", owner=self.member)
        second = self.make_page("Second project", project=self.second, owner=self.member)
        ProjectPage.objects.create(workspace=self.workspace, project=self.second, page=shared)
        self.make_page("Private other", owner=self.member, access=Page.PRIVATE_ACCESS)
        self.make_page("Inaccessible", project=self.hidden, owner=self.member)
        self.make_page("Wrong workspace", project=self.foreign, owner=self.admin)
        response = self.client.get(self.pages)
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(self.ids(response), {str(own.id), str(shared.id), str(second.id)})
        self.assertEqual(response.data["count"], 3)
        row = next(row for row in response.data["results"] if str(row["id"]) == str(shared.id))
        self.assertEqual(row["url"], f"/features/projects/{self.project.id}/pages/{shared.id}/")
        self.assertNotIn("description_html", row)

    def test_personal_pages_never_leaks_private_pages_via_creator_or_project_link(self):
        private = self.make_page("Transferred private", owner=self.member, access=Page.PRIVATE_ACCESS)
        Page.objects.filter(pk=private.pk).update(created_by=self.admin)
        hidden = self.make_page("Hidden link", project=self.hidden)
        ProjectPage.objects.create(
            workspace=self.workspace, project=self.project, page=hidden, deleted_at=timezone.now()
        )
        self.assertEqual(self.ids(self.client.get(self.pages)), set())

    def test_personal_pages_guest_policy_and_membership_revocation(self):
        own = self.make_page("Guest own", owner=self.guest, access=Page.PRIVATE_ACCESS)
        shared = self.make_page("Shared with project", owner=self.member)
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.ids(self.client.get(self.pages)), {str(own.id)})
        Project.objects.filter(pk=self.project.id).update(guest_view_all_features=True)
        self.assertEqual(self.ids(self.client.get(self.pages)), {str(own.id), str(shared.id)})
        ProjectMember.objects.filter(project=self.project, member=self.guest).update(is_active=False)
        self.assertEqual(self.ids(self.client.get(self.pages)), set())
        WorkspaceMember.objects.filter(workspace=self.workspace, member=self.guest).update(is_active=False)
        self.assertEqual(self.client.get(self.pages).status_code, 403)

    def test_personal_pages_filters_archived_search_project_and_invalid_inputs(self):
        own = self.make_page("Own needle", access=Page.PRIVATE_ACCESS)
        shared = self.make_page("Shared needle", project=self.second, owner=self.member)
        archived = self.make_page("Archived needle", archived=True)
        self.assertEqual(self.ids(self.client.get(self.pages, {"scope": "mine"})), {str(own.id)})
        self.assertEqual(self.ids(self.client.get(self.pages, {"scope": "shared"})), {str(shared.id)})
        self.assertEqual(
            self.ids(self.client.get(self.pages, {"search": "Shared", "project": str(self.second.id)})),
            {str(shared.id)},
        )
        self.assertEqual(
            self.ids(self.client.get(self.pages, {"archived": "1"})), {str(own.id), str(shared.id), str(archived.id)}
        )
        for params in [
            {"page": "-1"},
            {"page": "bad"},
            {"scope": "private"},
            {"project": "bad"},
            {"search": "x" * 201},
        ]:
            self.assertEqual(self.client.get(self.pages, params).status_code, 400)
        self.assertEqual(self.client.get(self.pages, {"project": str(self.hidden.id)}).status_code, 403)

    def test_personal_pages_paginates_and_omits_deleted_and_archived_projects(self):
        pages = [self.make_page(f"Page {index}") for index in range(33)]
        first = self.client.get(self.pages)
        second = self.client.get(self.pages, {"page": 2})
        self.assertEqual(len(first.data["results"]), 30)
        self.assertEqual(len(second.data["results"]), 3)
        self.assertEqual(self.ids(first) | self.ids(second), {str(page.id) for page in pages})
        self.assertFalse(self.ids(first) & self.ids(second))
        Project.objects.filter(pk=self.project.id).update(archived_at=timezone.now())
        self.assertEqual(self.ids(self.client.get(self.pages)), set())

    def test_anonymous_and_other_workspace_access_are_denied(self):
        self.assertEqual(
            self.client.get(f"/api/workspaces/{self.other_workspace.slug}/personal-pages/").status_code, 403
        )
        self.client.force_authenticate(user=None)
        self.assertIn(self.client.get(self.pages).status_code, [401, 403])

    def test_page_creation_destinations_require_active_writable_projects_with_pages(self):
        response = self.client.get(self.pages)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {str(row["id"]) for row in response.data["creatable_projects"]}, {str(self.project.id), str(self.second.id)}
        )
        Project.objects.filter(pk=self.second.id).update(page_view=False)
        self.assertEqual(
            {str(row["id"]) for row in self.client.get(self.pages).data["creatable_projects"]}, {str(self.project.id)}
        )
        ProjectMember.objects.filter(project=self.project, member=self.admin).update(is_active=False)
        self.assertEqual(self.client.get(self.pages).data["creatable_projects"], [])
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.client.get(self.pages).data["creatable_projects"], [])

    @override_settings(ROOT_URLCONF="plane.urls")
    def test_personal_page_creation_uses_native_endpoint_and_selected_project(self):
        with patch("plane.app.views.page.base.page_transaction.delay"):
            response = self.client.post(
                f"/api/workspaces/{self.workspace.slug}/projects/{self.second.id}/pages/",
                {"name": "Created from personal pages", "access": Page.PRIVATE_ACCESS},
                format="json",
            )
        self.assertEqual(response.status_code, 201, response.data)
        page = Page.objects.get(pk=response.data["id"])
        self.assertEqual(page.owned_by_id, self.admin.id)
        self.assertEqual(page.access, Page.PRIVATE_ACCESS)
        self.assertEqual(list(page.project_pages.values_list("project_id", flat=True)), [self.second.id])
        self.assertIn(str(page.id), self.ids(self.client.get(self.pages)))

    @override_settings(ROOT_URLCONF="plane.urls")
    def test_guest_cannot_create_pages_via_native_endpoint(self):
        self.client.force_authenticate(self.guest)
        before = Page.objects.count()
        response = self.client.post(
            f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/pages/",
            {"name": "Rejected", "access": Page.PUBLIC_ACCESS},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Page.objects.count(), before)
