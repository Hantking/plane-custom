from uuid import uuid4

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import (
    Cycle,
    Issue,
    IssueView,
    Module,
    Project,
    ProjectMember,
    State,
    User,
    Workspace,
    WorkspaceMember,
)
from .models import Field, NativeLayoutPreference


class NativeLayoutTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create(email="native-admin@test.local", username="native-admin")
        cls.member = User.objects.create(email="native-member@test.local", username="native-member")
        cls.guest = User.objects.create(email="native-guest@test.local", username="native-guest")
        cls.stranger = User.objects.create(email="native-stranger@test.local", username="native-stranger")
        cls.workspace = Workspace.objects.create(owner=cls.admin, name="Native", slug="native-layouts")
        cls.project = Project.objects.create(workspace=cls.workspace, name="Main", identifier="MAIN")
        cls.other = Project.objects.create(workspace=cls.workspace, name="Other", identifier="OTHER")
        for user, role in ((cls.admin, 20), (cls.member, 15), (cls.guest, 5)):
            WorkspaceMember.objects.create(workspace=cls.workspace, member=user, role=role)
            ProjectMember.objects.create(project=cls.project, workspace=cls.workspace, member=user, role=role)
        cls.module = Module.objects.create(project=cls.project, workspace=cls.workspace, name="Module A")
        cls.module_b = Module.objects.create(project=cls.project, workspace=cls.workspace, name="Module B")
        cls.cycle = Cycle.objects.create(project=cls.project, workspace=cls.workspace, name="Cycle", owned_by=cls.admin)
        cls.foreign_module = Module.objects.create(project=cls.other, workspace=cls.workspace, name="Private module")
        cls.view = IssueView.objects.create(
            project=cls.project, workspace=cls.workspace, name="Project view", owned_by=cls.admin
        )
        cls.private = IssueView.objects.create(
            project=cls.project, workspace=cls.workspace, name="Private view", owned_by=cls.admin, access=0
        )
        cls.global_view = IssueView.objects.create(workspace=cls.workspace, name="Workspace view", owned_by=cls.admin)
        cls.field = Field.objects.create(project=cls.project, name="Client", kind="text")
        cls.second = Field.objects.create(project=cls.project, name="Value", kind="number")
        cls.foreign = Field.objects.create(project=cls.other, name="Client", kind="text")
        cls.state = State.objects.create(project=cls.project, workspace=cls.workspace, name="Todo", group="unstarted")
        cls.issue = Issue.objects.create(
            project=cls.project, workspace=cls.workspace, state=cls.state, name="Admin task"
        )
        cls.guest_issue = Issue.objects.create(
            project=cls.project, workspace=cls.workspace, state=cls.state, name="Guest task"
        )
        cls.foreign_issue = Issue.objects.create(project=cls.other, workspace=cls.workspace, name="Foreign task")
        Issue.objects.filter(pk=cls.issue.pk).update(created_by=cls.admin)
        Issue.objects.filter(pk=cls.guest_issue.pk).update(created_by=cls.guest)

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.path = f"/api/workspaces/{self.workspace.slug}/custom-fields/"
        self.project_path = f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/custom-fields/"

    def context(self, scope="project", target=None, layout="spreadsheet"):
        if target is None:
            target = {
                "project": self.project.id,
                "module": self.module.id,
                "cycle": self.cycle.id,
                "project_view": self.view.id,
                "workspace_view": self.global_view.id,
            }[scope]
        return {
            "scope": scope,
            "target": str(target),
            "layout": layout,
            **({} if scope == "workspace_view" else {"project_id": str(self.project.id)}),
        }

    def read(self, context=None):
        return self.client.get(self.path + "native-display/", context or self.context())

    def write(self, context=None, order=None, visible=None):
        return self.client.patch(
            self.path + "native-display/",
            {
                **(context or self.context()),
                "order": order
                if order is not None
                else ["custom:" + str(self.field.id), "standard:priority", "custom:" + str(self.second.id)],
                "visible": visible if visible is not None else [str(self.field.id)],
            },
            format="json",
        )

    def batch(self, context=None, ids=None):
        return self.client.post(
            self.path + "native-values/",
            {
                **(context or self.context()),
                "ids": ids or [str(self.issue.id), str(self.guest_issue.id), str(self.foreign_issue.id)],
            },
            format="json",
        )

    def test_all_five_layouts_have_project_metadata_without_creating_preferences(self):
        for layout in ("spreadsheet", "list", "kanban", "calendar", "gantt_chart"):
            response = self.read(self.context(layout=layout))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(set(response.data["preference"]["visible"]), {str(self.field.id), str(self.second.id)})
        self.assertEqual(NativeLayoutPreference.objects.count(), 0)

    def test_column_order_and_visibility_are_saved_per_context_layout_and_user(self):
        response = self.write()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self.read().data["preference"]["order"][:2], ["custom:" + str(self.field.id), "standard:priority"]
        )
        self.assertEqual(self.read().data["preference"]["visible"], [str(self.field.id)])
        for context in (
            self.context(layout="list"),
            self.context("module"),
            self.context("cycle"),
            self.context("project_view"),
        ):
            self.assertEqual(len(self.read(context).data["preference"]["visible"]), 2)
        self.client.force_authenticate(self.member)
        self.assertEqual(len(self.read().data["preference"]["visible"]), 2)
        self.assertEqual(NativeLayoutPreference.objects.count(), 1)

    def test_module_preferences_do_not_affect_other_modules(self):
        self.assertEqual(self.write(self.context("module"), visible=[]).status_code, 200)
        self.assertEqual(self.read(self.context("module")).data["preference"]["visible"], [])
        self.assertEqual(
            len(self.read(self.context("module", target=self.module_b.id)).data["preference"]["visible"]), 2
        )

    def test_builtin_workspace_views_have_separate_personal_preferences_and_preserve_acl(self):
        all_items = {
            "scope": "workspace_builtin",
            "target": "00000000-0000-0000-0000-000000000001",
            "layout": "spreadsheet",
        }
        assigned = {**all_items, "target": "00000000-0000-0000-0000-000000000002"}
        self.assertEqual(self.write(all_items, visible=[]).status_code, 200)
        self.assertEqual(self.read(all_items).data["preference"]["visible"], [])
        self.assertEqual(len(self.read(assigned).data["preference"]["visible"]), 2)
        self.assertNotIn(str(self.foreign_issue.id), self.batch(all_items).data["values"])
        self.assertEqual(self.read({**all_items, "target": str(uuid4())}).status_code, 400)
        self.client.force_authenticate(self.guest)
        self.assertEqual(set(self.batch(all_items).data["values"]), {str(self.guest_issue.id)})

    def test_unknown_or_foreign_fields_and_duplicate_properties_are_rejected(self):
        for order, visible in (
            (["custom:" + str(self.foreign.id)], []),
            ([], [str(self.foreign.id)]),
            (["standard:password"], []),
            ([], [str(self.field.id), str(self.field.id)]),
        ):
            self.assertEqual(self.write(order=order, visible=visible).status_code, 400)
        self.assertEqual(NativeLayoutPreference.objects.count(), 0)

    def test_context_entity_must_belong_to_the_project_and_workspace(self):
        self.assertEqual(self.read(self.context("module", self.foreign_module.id)).status_code, 403)
        self.assertEqual(self.read(self.context("module", uuid4())).status_code, 404)
        self.assertEqual(self.read({**self.context(), "layout": "unsupported"}).status_code, 400)

    def test_strangers_and_anonymous_users_cannot_read_preferences_or_values(self):
        self.client.force_authenticate(self.stranger)
        self.assertEqual(self.read().status_code, 403)
        self.assertEqual(self.batch().status_code, 403)
        self.client.force_authenticate(None)
        self.assertEqual(self.read().status_code, 403)

    def test_guests_can_personalize_but_batch_only_contains_their_own_tasks(self):
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.write().status_code, 200)
        metadata = self.read().data
        self.assertEqual(metadata["editable_project_ids"], [])
        response = self.batch()
        self.assertEqual(set(response.data["values"]), {str(self.guest_issue.id)})
        self.assertEqual(NativeLayoutPreference.objects.get().owner_id, self.guest.id)

    def test_workspace_views_use_only_accessible_projects_and_qualify_fields(self):
        context = self.context("workspace_view")
        response = self.read(context)
        self.assertNotIn(str(self.foreign.id), {str(field["id"]) for field in response.data["fields"]})
        self.assertNotIn(str(self.foreign_issue.id), self.batch(context).data["values"])
        ProjectMember.objects.create(project=self.other, workspace=self.workspace, member=self.admin, role=15)
        response = self.read(context)
        foreign = next(field for field in response.data["fields"] if str(field["id"]) == str(self.foreign.id))
        self.assertEqual(foreign["project_identifier"], "OTHER")
        self.assertIn(str(self.foreign_issue.id), self.batch(context).data["values"])

    def test_private_view_owner_is_respected(self):
        context = self.context("project_view", self.private.id)
        self.assertEqual(self.read(context).status_code, 200)
        self.client.force_authenticate(self.member)
        self.assertEqual(self.read(context).status_code, 403)

    def test_deleted_projects_do_not_leak_into_workspace_view_metadata(self):
        Project.objects.filter(pk=self.project.id).update(deleted_at=timezone.now())
        response = self.read(self.context("workspace_view"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["fields"], [])
        self.assertEqual(self.batch(self.context("workspace_view")).data["values"], {})

    def test_archive_temporarily_hides_fields_and_delete_cleans_all_native_preferences(self):
        self.write()
        self.write(self.context("workspace_view"))
        definition = self.project_path + f"definitions/{self.field.id}/"
        self.assertEqual(self.client.patch(definition, {"active": False}, format="json").status_code, 200)
        self.assertNotIn(str(self.field.id), self.read().data["preference"]["visible"])
        self.assertIn(str(self.field.id), NativeLayoutPreference.objects.first().visible)
        self.assertEqual(self.client.patch(definition, {"active": True}, format="json").status_code, 200)
        self.assertIn(str(self.field.id), self.read().data["preference"]["visible"])
        self.assertEqual(self.client.delete(definition).status_code, 204)
        for preference in NativeLayoutPreference.objects.all():
            self.assertNotIn(str(self.field.id), preference.visible)
            self.assertNotIn("custom:" + str(self.field.id), preference.property_order)

    def test_new_fields_do_not_override_explicit_visibility_and_owner_cannot_be_spoofed(self):
        self.assertEqual(
            self.client.patch(
                self.path + "native-display/",
                {**self.context(), "owner": str(self.member.id), "order": [], "visible": []},
                format="json",
            ).status_code,
            200,
        )
        created = Field.objects.create(project=self.project, name="New", kind="text")
        response = self.read().data
        self.assertEqual(response["preference"]["visible"], [])
        self.assertIn("custom:" + str(created.id), response["preference"]["order"])
        self.assertEqual(NativeLayoutPreference.objects.get().owner_id, self.admin.id)

    def test_batches_are_bounded_and_invalid_identifiers_do_not_error_the_server(self):
        response = self.client.post(
            self.path + "native-values/", {**self.context(), "ids": [str(uuid4())] * 101}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.batch(ids=["invalid"]).status_code, 400)
