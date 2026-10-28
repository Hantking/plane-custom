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
        cls.multiple = Field.objects.create(
            project=cls.project,
            name="Tags",
            kind="multiselect",
            options=[
                {"id": str(uuid4()), "label": "Red", "color": "#ef4444"},
                {"id": str(uuid4()), "label": "Green", "color": "#22c55e"},
                {"id": str(uuid4()), "label": "Blue", "color": "#3b82f6"},
            ],
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.base = f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/custom-fields/"

    def save(self, issue, payload):
        return self.client.patch(self.base + f"issues/{issue.id}/", {"values": payload}, format="json")

    def test_project_scope_rejects_foreign_fields_and_strangers(self):
        self.assertEqual(self.save(self.issue, {str(self.foreign_field.id): "secret"}).status_code, 400)
        self.assertEqual(self.client.delete(self.base + f"definitions/{self.foreign_field.id}/").status_code, 404)
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

    def test_long_text_phone_site_roundtrip_and_lossless_conversion(self):
        samples = {
            "long_text": ("Primeira linha\r\nSegunda linha\nTerceira", "Primeira linha\nSegunda linha\nTerceira"),
            "phone": ("+55 (21) 93323-8159", "21933238159"),
            "site": ("example.com/pagina?q=teste", "https://example.com/pagina?q=teste"),
        }
        for kind, (raw, expected) in samples.items():
            with self.subTest(kind=kind):
                response = self.client.post(self.base, {"name": kind, "kind": kind}, format="json")
                self.assertEqual(response.status_code, 201, response.data)
                key = str(response.data["id"])
                self.assertEqual(self.save(self.issue, {key: raw}).status_code, 200)
                self.assertEqual(values_for([self.issue])[str(self.issue.id)][key], expected)
                # Converting to ordinary text keeps all content, including line breaks.
                response = self.client.patch(self.base + f"definitions/{key}/", {"kind": "text"}, format="json")
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual(values_for([self.issue])[str(self.issue.id)][key], expected)

    def test_new_text_types_reject_invalid_values_and_keep_atomic_conversion(self):
        phone = Field.objects.create(project=self.project, name="Phone", kind="phone")
        site = Field.objects.create(project=self.project, name="Site", kind="site")
        self.assertEqual(normalize(phone, "(21) 3323-8159"), "2133238159")
        for field, raw in [
            (phone, "123"),
            (phone, "letters21933238159"),
            (site, "javascript:alert(1)"),
            (site, "data:text/html,test"),
            (site, "ftp://example.com"),
        ]:
            with self.subTest(raw=raw), self.assertRaises(ValidationError):
                normalize(field, raw)
        text = Field.objects.create(project=self.project, name="Pending", kind="text")
        self.assertEqual(self.save(self.issue, {str(text.id): "First\nSecond"}).status_code, 200)
        url = self.base + f"definitions/{text.id}/"
        self.assertEqual(self.client.patch(url, {"kind": "phone"}, format="json").status_code, 400)
        text.refresh_from_db()
        self.assertEqual(text.kind, "text")
        self.assertEqual(self.client.patch(url, {"kind": "long_text"}, format="json").status_code, 200)
        self.assertEqual(values_for([self.issue])[str(self.issue.id)][str(text.id)], "First\nSecond")

    def test_decimal_comma_is_explicit_decimal_without_grouping_or_precision_loss(self):
        self.assertEqual(normalize(self.numeric, "99999999999999,123456"), Decimal("99999999999999.123456"))
        for invalid in ("1,000,000", "1.000,25", "1,1234567"):
            with self.assertRaises(ValidationError):
                normalize(self.numeric, invalid)

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

    def test_multiple_values_are_deduplicated_and_keep_definition_order_and_colors(self):
        first, second = [option["id"] for option in self.multiple.options[:2]]
        response = self.save(self.issue, {str(self.multiple.id): [second, first, second]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["values"][str(self.multiple.id)], [first, second])
        self.assertEqual(Value.objects.get(issue=self.issue).option_values, [first, second])
        self.save(self.issue, {str(self.multiple.id): [first, second]})
        self.assertEqual(Change.objects.filter(issue=self.issue).count(), 1)
        self.assertEqual(self.client.get(self.base).data["fields"][-1]["options"][0]["color"], "#ef4444")

    def test_multiple_rejects_unknown_options_and_empty_required_values(self):
        first = self.multiple.options[0]["id"]
        self.multiple.required = True
        self.multiple.save()
        self.assertEqual(self.save(self.issue, {str(self.multiple.id): [first]}).status_code, 200)
        for invalid in ([], None, first, [str(uuid4())], [False]):
            with self.subTest(invalid=invalid):
                self.assertEqual(self.save(self.issue, {str(self.multiple.id): invalid}).status_code, 400)
        self.assertEqual(Value.objects.get(issue=self.issue).option_values, [first])

    def test_multiple_filters_include_any_all_exclusion_and_empty(self):
        first, second = [option["id"] for option in self.multiple.options[:2]]
        self.save(self.issue, {str(self.multiple.id): [first, second]})
        self.save(self.guest_issue, {str(self.multiple.id): [first]})
        empty = Issue.objects.create(project=self.project, state=self.state, name="No tags")
        for operator, choices, expected in [
            ("contains_any", [second], {self.issue.id}),
            ("contains_all", [first, second], {self.issue.id}),
            ("ne", [second], {self.guest_issue.id, empty.id}),
            ("empty", None, {empty.id}),
            ("not_empty", None, {self.issue.id, self.guest_issue.id}),
        ]:
            config = {"filters": [{"field": str(self.multiple.id), "operator": operator, "value": choices}]}
            response = self.client.get(self.base + "items/", {"config": json.dumps(config)})
            self.assertEqual(response.status_code, 200)
            self.assertEqual({item["id"] for item in response.data["results"]}, {str(key) for key in expected})

    def test_multiple_grouping_counts_unique_items_and_each_label_membership(self):
        first, second = [option["id"] for option in self.multiple.options[:2]]
        self.save(self.issue, {str(self.multiple.id): [first, second]})
        self.save(self.guest_issue, {str(self.multiple.id): [first]})
        Issue.objects.create(project=self.project, state=self.state, name="No tags")
        response = self.client.get(self.base + "items/", {"config": json.dumps({"group_by": str(self.multiple.id)})})
        groups = {group["key"]: group for group in response.data["groups"]}
        self.assertEqual(response.data["count"], 3)
        self.assertEqual(groups[first]["count"], 2)
        self.assertEqual(groups[second]["count"], 1)
        self.assertEqual(groups["__empty__"]["count"], 1)

    def test_multiple_board_move_preserves_unrelated_labels_and_rejects_stale_moves(self):
        first, second, third = [option["id"] for option in self.multiple.options]
        self.save(self.issue, {str(self.multiple.id): [first, third]})
        url = self.base + f"issues/{self.issue.id}/"
        move = {"selection_move": {"field": str(self.multiple.id), "from": first, "to": second}}
        response = self.client.patch(url, move, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["values"][str(self.multiple.id)], [second, third])
        self.assertEqual(self.client.patch(url, move, format="json").status_code, 400)
        clear = {"selection_move": {"field": str(self.multiple.id), "from": second, "to": "__empty__"}}
        self.assertEqual(self.client.patch(url, clear, format="json").status_code, 200)
        self.assertFalse(Value.objects.filter(issue=self.issue, field=self.multiple).exists())

    def test_single_to_multiple_preserves_ids_colors_and_saved_filter(self):
        first = self.select.options[0]["id"]
        self.save(self.issue, {str(self.select.id): first})
        saved = SavedView.objects.create(
            project=self.project,
            owner=self.admin,
            name="Conversion",
            config={
                "filters": [{"field": str(self.select.id), "operator": "eq", "value": first}],
                "group_by": str(self.select.id),
                "order_by": str(self.select.id),
                "columns": [str(self.select.id)],
            },
        )
        response = self.client.patch(
            self.base + f"definitions/{self.select.id}/", {"kind": "multiselect"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["options"], self.select.options)
        row = Value.objects.get(issue=self.issue)
        self.assertEqual(row.option_values, [first])
        self.assertIsNone(row.option_value)
        saved.refresh_from_db()
        self.assertEqual(saved.config["filters"][0]["operator"], "contains_any")
        self.assertEqual(saved.config["filters"][0]["value"], [first])
        self.assertEqual(saved.config["order_by"], "-created_at")
        self.assertEqual(self.client.get(self.base + "items/", {"config": json.dumps(saved.config)}).status_code, 200)

    def test_multiple_to_single_blocks_data_loss_then_converts_when_unambiguous(self):
        first, second = [option["id"] for option in self.multiple.options[:2]]
        self.save(self.issue, {str(self.multiple.id): [first, second]})
        self.save(self.guest_issue, {str(self.multiple.id): [first]})
        url = self.base + f"definitions/{self.multiple.id}/"
        failed = self.client.patch(url, {"kind": "select"}, format="json")
        self.assertEqual(failed.status_code, 400)
        self.multiple.refresh_from_db()
        self.assertEqual(self.multiple.kind, "multiselect")
        self.assertEqual(Value.objects.get(issue=self.guest_issue).option_values, [first])
        self.save(self.issue, {str(self.multiple.id): [first]})
        self.assertEqual(self.client.patch(url, {"kind": "select"}, format="json").status_code, 200)
        self.assertEqual(Value.objects.get(issue=self.issue).option_value, first)
        self.assertEqual(Value.objects.get(issue=self.issue).option_values, [])

    def test_type_conversion_validates_all_rows_before_writing_and_preserves_readable_labels(self):
        text = Field.objects.create(project=self.project, name="Text conversion", kind="text")
        self.save(self.issue, {str(text.id): "12.5"})
        self.save(self.guest_issue, {str(text.id): "Not a number"})
        url = self.base + f"definitions/{text.id}/"
        response = self.client.patch(url, {"kind": "number"}, format="json")
        self.assertEqual(response.status_code, 400)
        text.refresh_from_db()
        self.assertEqual(text.kind, "text")
        self.assertEqual(Value.objects.get(issue=self.issue, field=text).text_value, "12.5")
        self.save(self.guest_issue, {str(text.id): "7"})
        self.assertEqual(self.client.patch(url, {"kind": "number"}, format="json").status_code, 200)
        self.assertEqual(Value.objects.get(issue=self.issue, field=text).number_value, Decimal("12.5"))
        first, second = [option["id"] for option in self.multiple.options[:2]]
        self.save(self.issue, {str(self.multiple.id): [first, second]})
        response = self.client.patch(self.base + f"definitions/{self.multiple.id}/", {"kind": "text"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Value.objects.get(issue=self.issue, field=self.multiple).text_value, "Red, Green")

    def test_definition_deletion_removes_only_its_values_and_repairs_saved_views(self):
        first = self.multiple.options[0]["id"]
        self.save(self.issue, {str(self.multiple.id): [first], str(self.numeric.id): "8"})
        saved = SavedView.objects.create(
            project=self.project,
            owner=self.admin,
            name="Deleted field",
            config={
                "filters": [{"field": str(self.multiple.id), "operator": "contains_any", "value": [first]}],
                "columns": [str(self.multiple.id), str(self.numeric.id)],
                "group_by": str(self.multiple.id),
                "order_by": "-created_at",
            },
        )
        response = self.client.delete(self.base + f"definitions/{self.multiple.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Field.objects.filter(pk=self.multiple.id).exists())
        self.assertFalse(Change.objects.filter(field_id=self.multiple.id).exists())
        self.assertEqual(Value.objects.get(issue=self.issue).number_value, Decimal("8"))
        saved.refresh_from_db()
        self.assertEqual(saved.config["filters"], [])
        self.assertEqual(saved.config["columns"], [str(self.numeric.id)])
        self.assertEqual(saved.config["group_by"], "")
        self.assertEqual(self.client.get(self.base + "items/", {"config": json.dumps(saved.config)}).status_code, 200)

    def test_archive_and_restore_multiple_preserves_values_and_delete_requires_admin(self):
        first = self.multiple.options[0]["id"]
        self.save(self.issue, {str(self.multiple.id): [first]})
        url = self.base + f"definitions/{self.multiple.id}/"
        self.assertEqual(self.client.patch(url, {"active": False}, format="json").status_code, 200)
        self.assertEqual(Value.objects.get(issue=self.issue).option_values, [first])
        self.assertEqual(values_for([self.issue])[str(self.issue.id)], {})
        self.assertEqual(self.client.patch(url, {"active": True}, format="json").status_code, 200)
        self.assertEqual(values_for([self.issue])[str(self.issue.id)][str(self.multiple.id)], [first])
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.delete(url).status_code, 403)
        self.assertEqual(self.client.patch(url, {"kind": "text"}, format="json").status_code, 403)

    def test_options_used_by_multiple_values_cannot_be_removed(self):
        first = self.multiple.options[0]["id"]
        self.save(self.issue, {str(self.multiple.id): [first]})
        response = self.client.patch(
            self.base + f"definitions/{self.multiple.id}/", {"options": self.multiple.options[1:]}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Value.objects.get(issue=self.issue).option_values, [first])

    def test_definition_type_changed_after_value_validation_rejects_stale_writes(self):
        prepared = validate_values(self.project.id, {str(self.numeric.id): "7"})
        self.assertEqual(
            self.client.patch(
                self.base + f"definitions/{self.numeric.id}/", {"kind": "text"}, format="json"
            ).status_code,
            200,
        )
        with self.assertRaises(ValidationError):
            save_values(self.issue, prepared, self.admin.id)
        self.assertFalse(Value.objects.filter(issue=self.issue).exists())

    def test_empty_field_can_change_to_every_supported_type(self):
        field = Field.objects.create(project=self.project, name="Editable type", kind="text")
        url = self.base + f"definitions/{field.id}/"
        for kind in ("number", "date", "boolean", "url", "select", "multiselect", "text"):
            options = self.multiple.options if kind in ("select", "multiselect") else []
            response = self.client.patch(url, {"kind": kind, "options": options}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data["kind"], kind)
            self.assertEqual(response.data["id"], str(field.id))
