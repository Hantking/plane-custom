import json
from decimal import Decimal
from uuid import uuid4

from django.test import TestCase
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from plane.db.models import Issue, Project, ProjectMember, State, User, Workspace, WorkspaceMember
from plane.app.serializers.issue import IssueCreateSerializer
from .models import Change, Field, SavedView, Value
from .services import normalize, save_values, validate_values, values_for


class CustomFieldsIntegrationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create(email="admin@fields.test", username="fields-admin")
        cls.member = User.objects.create(email="member@fields.test", username="fields-member")
        cls.guest = User.objects.create(email="guest@fields.test", username="fields-guest")
        cls.stranger = User.objects.create(email="stranger@fields.test", username="fields-stranger")
        cls.workspace = Workspace.objects.create(name="Fields Test", slug="fields-test", owner=cls.admin)
        for user, role in [(cls.admin, 20), (cls.member, 15), (cls.guest, 5)]:
            WorkspaceMember.objects.create(workspace=cls.workspace, member=user, role=role)
        cls.project = Project.objects.create(workspace=cls.workspace, name="Main", identifier="MAIN")
        cls.other = Project.objects.create(workspace=cls.workspace, name="Other", identifier="OTHER")
        for user, role in [(cls.admin, 20), (cls.member, 15), (cls.guest, 5)]:
            ProjectMember.objects.create(project=cls.project, workspace=cls.workspace, member=user, role=role)
        cls.state = State.objects.create(
            project=cls.project, workspace=cls.workspace, name="Todo", group="unstarted", default=True
        )
        cls.issue = Issue.objects.create(project=cls.project, name="First", state=cls.state, created_by=cls.admin)
        cls.guest_issue = Issue.objects.create(
            project=cls.project, name="Guest task", state=cls.state, created_by=cls.guest
        )
        # Core audit model derives creator from crum; fixtures run outside request middleware.
        Issue.objects.filter(pk=cls.issue.pk).update(created_by=cls.admin)
        Issue.objects.filter(pk=cls.guest_issue.pk).update(created_by=cls.guest)
        cls.numeric = Field.objects.create(project=cls.project, name="Amount", kind="number")
        cls.select = Field.objects.create(
            project=cls.project,
            name="Client",
            kind="select",
            options=[{"id": str(uuid4()), "label": "Hentis"}, {"id": str(uuid4()), "label": "Other"}],
        )
        cls.boolean = Field.objects.create(project=cls.project, name="Approved", kind="boolean")
        cls.foreign_field = Field.objects.create(project=cls.other, name="Private", kind="text")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.base = f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/custom-fields/"

    def save(self, issue, payload):
        return self.client.patch(self.base + f"issues/{issue.id}/", {"values": payload}, format="json")

    def test_project_scope_rejects_foreign_fields_and_strangers(self):
        self.assertEqual(self.save(self.issue, {str(self.foreign_field.id): "secret"}).status_code, 400)
        self.client.force_authenticate(self.stranger)
        self.assertEqual(self.client.get(self.base).status_code, 403)

    def test_members_can_edit_values_but_only_admins_manage_definitions(self):
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.post(self.base, {"name": "No", "kind": "text"}, format="json").status_code, 403)
        self.assertEqual(self.save(self.issue, {str(self.numeric.id): "12.125"}).status_code, 200)
        self.assertEqual(Value.objects.get(issue=self.issue).number_value, Decimal("12.125"))

    def test_guest_only_sees_own_items_and_cannot_write(self):
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.client.get(self.base + f"issues/{self.issue.id}/").status_code, 404)
        batch = self.client.get(self.base + "values/", {"ids": f"{self.issue.id},{self.guest_issue.id}"})
        self.assertEqual(set(batch.data), {str(self.guest_issue.id)})
        self.assertEqual(self.save(self.guest_issue, {str(self.numeric.id): "3"}).status_code, 403)

    def test_typed_validation_rejects_nan_precision_and_invalid_options(self):
        for invalid in ("NaN", "Infinity", "1.1234567", True, "100000000000000"):
            with self.assertRaises(ValidationError):
                normalize(self.numeric, invalid)
        with self.assertRaises(ValidationError):
            normalize(self.select, str(uuid4()))
        with self.assertRaises(ValidationError):
            normalize(self.boolean, "false")
        self.assertIs(normalize(self.boolean, False), False)

    def test_native_serializer_requires_fields_and_saves_atomically(self):
        required = Field.objects.create(project=self.project, name="Reference", kind="text", required=True)
        context = {"project_id": self.project.id, "workspace_id": self.workspace.id, "default_assignee_id": None}
        invalid = IssueCreateSerializer(data={"name": "Rejected"}, context=context)
        self.assertFalse(invalid.is_valid())
        serializer = IssueCreateSerializer(
            data={"name": "Created", "custom_fields": {str(required.id): "ABC", str(self.numeric.id): "15"}},
            context=context,
        )
        serializer.is_valid(raise_exception=True)
        issue = serializer.save(created_by=self.admin)
        self.assertEqual(values_for([issue])[str(issue.id)][str(required.id)], "ABC")
        self.assertEqual(Change.objects.filter(issue=issue).count(), 2)
        before = Issue.objects.count()
        # A field archived between validation and save must roll back task creation.
        raced = IssueCreateSerializer(
            data={"name": "Race", "custom_fields": {str(required.id): "ABC"}}, context=context
        )
        raced.is_valid(raise_exception=True)
        required.active = False
        required.save()
        with self.assertRaises(ValidationError):
            raced.save(created_by=self.admin)
        self.assertEqual(Issue.objects.count(), before)

    def test_audit_and_required_clear_preserve_previous_value(self):
        self.numeric.required = True
        self.numeric.save()
        self.assertEqual(self.save(self.issue, {str(self.numeric.id): "5"}).status_code, 200)
        self.assertEqual(self.save(self.issue, {str(self.numeric.id): None}).status_code, 400)
        self.assertEqual(Value.objects.get(issue=self.issue).number_value, Decimal("5"))
        self.assertEqual(Change.objects.filter(issue=self.issue).count(), 1)
        self.assertEqual(self.save(self.issue, {str(self.numeric.id): "5.0"}).status_code, 200)
        self.assertEqual(Change.objects.filter(issue=self.issue).count(), 1)

    def test_archiving_a_column_keeps_saved_view_usable_and_preserves_values(self):
        self.save(self.issue, {str(self.numeric.id): "8"})
        self.numeric.active = False
        self.numeric.save()
        config = {"columns": [str(self.numeric.id)]}
        result = self.client.get(self.base + "items/", {"config": json.dumps(config)})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(Value.objects.get(issue=self.issue).number_value, Decimal("8"))
        self.assertEqual(result.data["results"][0]["custom_fields"], {})

    def test_filters_and_counts_apply_before_pagination_and_numeric_sort(self):
        for index in range(30):
            issue = Issue.objects.create(project=self.project, name=f"Task {index}", state=self.state)
            save_values(issue, validate_values(self.project.id, {str(self.numeric.id): str(index)}), self.admin.id)
        config = {
            "filters": [{"field": str(self.numeric.id), "operator": "gte", "value": "10"}],
            "order_by": "-" + str(self.numeric.id),
        }
        result = self.client.get(self.base + "items/", {"config": json.dumps(config)})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data["count"], 20)
        self.assertEqual(result.data["results"][0]["custom_fields"][str(self.numeric.id)], "29.000000")

    def test_groups_count_full_dataset_and_paginate_each_group(self):
        option = self.select.options[0]["id"]
        for index in range(28):
            issue = Issue.objects.create(project=self.project, name=f"Group {index}", state=self.state)
            save_values(issue, validate_values(self.project.id, {str(self.select.id): option}), self.admin.id)
        config = {"group_by": str(self.select.id)}
        result = self.client.get(self.base + "items/", {"config": json.dumps(config)})
        group = next(g for g in result.data["groups"] if g["key"] == option)
        self.assertEqual(group["count"], 28)
        self.assertEqual(len(group["results"]), 25)
        self.assertTrue(group["has_more"])
        more = self.client.get(self.base + "items/", {"config": json.dumps(config), "group_value": option, "page": 2})
        self.assertEqual(len(more.data["groups"][0]["results"]), 3)

    def test_option_ids_are_stable_and_used_options_cannot_be_deleted(self):
        option = self.select.options[0]["id"]
        self.save(self.issue, {str(self.select.id): option})
        response = self.client.patch(
            self.base + f"definitions/{self.select.id}/", {"options": self.select.options[1:]}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.select.options[0]["label"] = "Renamed"
        response = self.client.patch(
            self.base + f"definitions/{self.select.id}/", {"options": self.select.options}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Value.objects.get(issue=self.issue).option_value, option)

    def test_private_views_not_exposed_to_other_members(self):
        SavedView.objects.create(project=self.project, owner=self.admin, name="Private")
        public = SavedView.objects.create(project=self.project, owner=self.admin, name="Shared", shared=True)
        self.client.force_authenticate(self.member)
        response = self.client.get(self.base + "views/")
        self.assertEqual([str(v["id"]) for v in response.data], [str(public.id)])
        self.assertEqual(self.client.delete(self.base + f"views/{public.id}/").status_code, 403)

    def test_option_background_color_round_trips_without_changing_task_values(self):
        selected = self.select.options[0]["id"]
        self.assertEqual(self.save(self.issue, {str(self.select.id): selected}).status_code, 200)
        options = [{**option, "color": "#F59E0B"} for option in self.select.options]
        response = self.client.patch(self.base + f"definitions/{self.select.id}/", {"options": options}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["options"][0]["color"], "#f59e0b")
        self.assertEqual(Value.objects.get(issue=self.issue).option_value, selected)
        self.assertEqual(Change.objects.filter(issue=self.issue).count(), 1)
        metadata = self.client.get(self.base)
        saved = next(field for field in metadata.data["fields"] if field["id"] == str(self.select.id))
        self.assertEqual(saved["options"][0]["color"], "#f59e0b")

    def test_invalid_option_colors_are_rejected_without_overwriting_definition(self):
        for color in ("red", "#fff", "#12345678", "url(example)", None, 123456):
            with self.subTest(color=color):
                options = [{**option, "color": color} for option in self.select.options]
                response = self.client.patch(
                    self.base + f"definitions/{self.select.id}/", {"options": options}, format="json"
                )
                self.assertEqual(response.status_code, 400)
        self.select.refresh_from_db()
        self.assertNotIn("color", self.select.options[0])

    def test_old_options_without_colors_remain_valid(self):
        options = [{"id": str(uuid4()), "label": "Legacy option"}]
        response = self.client.post(
            self.base, {"name": "Legacy selection", "kind": "select", "options": options}, format="json"
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["options"], options)

    def test_moving_issue_does_not_expose_old_project_custom_data(self):
        self.save(self.issue, {str(self.numeric.id): "33"})
        self.issue.project = self.other
        self.issue.save()
        self.assertEqual(values_for([self.issue])[str(self.issue.id)], {})
