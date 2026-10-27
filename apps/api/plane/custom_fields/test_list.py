import csv
import importlib
import io
import json
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.apps import apps
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from plane.db.models import (
    User,
    Workspace,
    WorkspaceMember,
    Project,
    ProjectMember,
    State,
    Issue,
    Module,
    ModuleIssue,
    Cycle,
    CycleIssue,
)
from .models import Field, NativeLayoutPreference, SavedView, Change
from .services import validate_values, save_values, values_for
from .query import normalize_query, apply_query


@override_settings(WEB_URL="http://testserver")
class NativeListTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create(email="list-admin@test.local", username="list-admin")
        cls.member = User.objects.create(email="list-member@test.local", username="list-member")
        cls.guest = User.objects.create(email="list-guest@test.local", username="list-guest")
        cls.workspace = Workspace.objects.create(owner=cls.admin, name="List", slug="native-list")
        cls.project = Project.objects.create(workspace=cls.workspace, name="Main", identifier="LST")
        cls.other = Project.objects.create(workspace=cls.workspace, name="Private", identifier="PRV")
        for user, role in [(cls.admin, 20), (cls.member, 15), (cls.guest, 5)]:
            WorkspaceMember.objects.create(workspace=cls.workspace, member=user, role=role)
            ProjectMember.objects.create(workspace=cls.workspace, project=cls.project, member=user, role=role)
        cls.todo = State.objects.create(
            workspace=cls.workspace, project=cls.project, name="Todo", group="unstarted", default=True
        )
        cls.done = State.objects.create(workspace=cls.workspace, project=cls.project, name="Done", group="completed")
        cls.alpha = Issue.objects.create(
            workspace=cls.workspace,
            project=cls.project,
            name="Alpha",
            state=cls.todo,
            created_by=cls.admin,
            description_html="<p>description-keyword</p>",
        )
        cls.beta = Issue.objects.create(
            workspace=cls.workspace, project=cls.project, name="Beta", state=cls.done, created_by=cls.guest
        )
        cls.foreign = Issue.objects.create(workspace=cls.workspace, project=cls.other, name="Private task")
        Issue.objects.filter(pk=cls.alpha.pk).update(created_by=cls.admin)
        Issue.objects.filter(pk=cls.beta.pk).update(created_by=cls.guest)
        cls.options = [
            {"id": str(uuid4()), "label": "Zebra", "color": "#B69277"},
            {"id": str(uuid4()), "label": "Alpha option", "color": "#3399AA"},
        ]
        cls.red, cls.blue = cls.options[0]["id"], cls.options[1]["id"]
        cls.fields = {
            kind: Field.objects.create(
                project=cls.project,
                name=kind,
                kind=kind,
                options=cls.options if kind in {"select", "multiselect"} else [],
            )
            for kind in ["text", "number", "date", "boolean", "select", "multiselect", "url"]
        }
        cls.private_field = Field.objects.create(project=cls.other, name="Private field", kind="text")
        for issue, number, selection in [(cls.alpha, "30", [cls.red, cls.blue]), (cls.beta, "2", [cls.blue])]:
            save_values(
                issue,
                validate_values(
                    cls.project.id,
                    {
                        str(cls.fields["number"].id): number,
                        str(cls.fields["multiselect"].id): selection,
                        str(cls.fields["text"].id): "needle-custom" if issue == cls.alpha else "ordinary",
                        str(cls.fields["select"].id): cls.red if issue == cls.alpha else cls.blue,
                    },
                ),
                cls.admin.id,
            )
        cls.module = Module.objects.create(project=cls.project, workspace=cls.workspace, name="Module")
        cls.cycle = Cycle.objects.create(project=cls.project, workspace=cls.workspace, name="Cycle", owned_by=cls.admin)
        ModuleIssue.objects.create(project=cls.project, workspace=cls.workspace, module=cls.module, issue=cls.alpha)
        CycleIssue.objects.create(project=cls.project, workspace=cls.workspace, cycle=cls.cycle, issue=cls.beta)

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.base = f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/"
        self.custom = self.base + "custom-fields/"
        self.native = f"/api/workspaces/{self.workspace.slug}/custom-fields/"
        for name in ["recent_visited_task", "issue_activity", "model_activity", "issue_description_version_task"]:
            mock = patch(f"plane.app.views.issue.base.{name}.delay")
            mock.start()
            self.addCleanup(mock.stop)

    def context(self, layout="list", scope="project", target=None):
        return {
            "layout": layout,
            "scope": scope,
            "target": str(target or self.project.id),
            "project_id": str(self.project.id),
        }

    def query(self, **patches):
        return {
            "schema_version": 2,
            "filters": [],
            "filter_tree": {"op": "and", "children": []},
            "sorts": [],
            "columns": [],
            "group_by": "",
            "subtasks": "collapsed",
            **patches,
        }

    def leaf(self, kind, operator="eq", value=None):
        return {"field": str(self.fields[kind].id), "operator": operator, "value": value}

    def get_list(self, query=None, *, page=0, size=25, group=None, path=None, context=None, **standard):
        query = query or self.query()
        params = {
            "hentis_query": json.dumps({"context": context or self.context(), "query": query}),
            "per_page": str(size),
            "cursor": f"{size}:{page}:0",
            "sub_issue": "true",
            **standard,
        }
        if query.get("group_by"):
            params["group_by"] = "hentis_custom"
        if group is not None:
            params["hentis_group"] = group
        return self.client.get(path or self.base + "issues/", params)

    def operation(self, name, query=None, **extra):
        return self.client.post(
            self.native + f"native-list/{name}/",
            {"context": self.context(), "query": query or self.query(), "standard": {}, **extra},
            format="json",
        )

    def ids(self, response):
        self.assertEqual(response.status_code, 200, response.data)
        return [str(row["id"]) for row in response.data["results"]]

    def test_native_endpoints_keep_full_issue_dto_and_server_order_flag(self):
        response = self.get_list()
        self.assertEqual(set(self.ids(response)), {str(self.alpha.id), str(self.beta.id)})
        self.assertTrue(response.data["hentis_server_order"])
        self.assertTrue(
            {
                "parent_id",
                "assignee_ids",
                "module_ids",
                "label_ids",
                "sequence_id",
                "created_at",
                "state_id",
                "sub_issues_count",
                "cycle_id",
                "attachment_count",
                "link_count",
            }.issubset(response.data["results"][0])
        )

    def test_nested_and_or_not_composes_with_native_filters(self):
        tree = {
            "op": "and",
            "children": [
                {"op": "or", "children": [self.leaf("number", "gt", "20"), self.leaf("text", "contains", "unknown")]},
                {"op": "not", "children": [self.leaf("select", "eq", self.blue)]},
            ],
        }
        self.assertEqual(self.ids(self.get_list(self.query(filter_tree=tree))), [str(self.alpha.id)])
        response = self.get_list(self.query(filter_tree=tree), filters=json.dumps({"priority": "urgent"}))
        self.assertEqual(self.ids(response), [])

    def test_invalid_tree_and_sort_fields_are_rejected(self):
        invalid = [
            self.query(filter_tree={"op": "xor", "children": []}),
            self.query(filter_tree=self.leaf("number", "contains", "1")),
            self.query(filter_tree={"field": str(self.private_field.id), "operator": "empty"}),
            self.query(sorts=[{"field": "assignees__password", "direction": "asc"}]),
            self.query(sorts=[{"field": str(self.fields["multiselect"].id)}]),
        ]
        for query in invalid:
            with self.subTest(query=query):
                self.assertEqual(self.get_list(query).status_code, 400)
        deep = self.leaf("number", "gt", "1")
        for _ in range(7):
            deep = {"op": "and", "children": [deep]}
        self.assertEqual(self.get_list(self.query(filter_tree=deep)).status_code, 400)
        self.assertEqual(
            self.get_list(
                self.query(filter_tree={"op": "and", "children": [self.leaf("number", "empty") for _ in range(100)]})
            ).status_code,
            400,
        )

    def test_multisort_precedes_pagination_and_has_stable_ties(self):
        rows = []
        for index in range(65):
            issue = Issue.objects.create(
                workspace=self.workspace, project=self.project, name=f"bulk-{index:03}", state=self.todo
            )
            number = Decimal((64 - index) % 13)
            save_values(
                issue, validate_values(self.project.id, {str(self.fields["number"].id): str(number)}), self.admin.id
            )
            rows.append((issue, number))
        config = self.query(
            search="bulk-",
            sorts=[
                {"field": str(self.fields["number"].id), "direction": "asc", "nulls": "last"},
                {"field": "name", "direction": "desc", "nulls": "last"},
            ],
        )
        expected = sorted(rows, key=lambda pair: pair[0].name, reverse=True)
        expected.sort(key=lambda pair: pair[1])
        actual = []
        for page in range(10):
            actual.extend(self.ids(self.get_list(config, page=page, size=7)))
        self.assertEqual(actual, [str(issue.id) for issue, _ in expected])
        self.assertEqual(len(set(actual)), 65)

    def test_null_policy_numeric_order_and_option_metadata_order(self):
        missing = Issue.objects.create(
            workspace=self.workspace, project=self.project, name="No number", state=self.todo
        )
        config = self.query(sorts=[{"field": str(self.fields["number"].id), "direction": "asc", "nulls": "first"}])
        self.assertEqual(self.ids(self.get_list(config)), [str(missing.id), str(self.beta.id), str(self.alpha.id)])
        config["sorts"][0]["nulls"] = "last"
        self.assertEqual(self.ids(self.get_list(config)), [str(self.beta.id), str(self.alpha.id), str(missing.id)])
        config["sorts"][0]["field"] = str(self.fields["select"].id)
        self.assertEqual(self.ids(self.get_list(config))[:2], [str(self.alpha.id), str(self.beta.id)])

    def test_multisort_works_in_native_state_groups(self):
        Issue.objects.filter(pk=self.beta.id).update(state=self.todo)
        response = self.get_list(
            self.query(sorts=[{"field": str(self.fields["number"].id), "direction": "asc"}]), group_by="state_id"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            [str(row["id"]) for row in response.data["results"][str(self.todo.id)]["results"]],
            [str(self.beta.id), str(self.alpha.id)],
        )

    def test_selection_direction_reverses_ungrouped_scoped_results(self):
        ModuleIssue.objects.create(project=self.project, workspace=self.workspace, module=self.module, issue=self.beta)
        self.fields["select"].name = "Setor da pendência"
        self.fields["select"].save(update_fields=["name"])
        CycleIssue.objects.create(project=self.project, workspace=self.workspace, cycle=self.cycle, issue=self.alpha)
        for path, context, standard in [
            (self.base + "issues/", self.context(), {}),
            (self.base + f"modules/{self.module.id}/issues/", self.context(scope="module", target=self.module.id), {}),
            (
                self.base + "issues/",
                self.context(scope="module", target=self.module.id),
                {"module": str(self.module.id)},
            ),
            (
                self.base + f"cycles/{self.cycle.id}/cycle-issues/",
                self.context(scope="cycle", target=self.cycle.id),
                {},
            ),
            (self.base + "issues/", self.context(scope="cycle", target=self.cycle.id), {"cycle": str(self.cycle.id)}),
        ]:
            for direction, expected in [("asc", [self.alpha, self.beta]), ("desc", [self.beta, self.alpha])]:
                with self.subTest(path=path, direction=direction):
                    response = self.get_list(
                        self.query(
                            sorts=[{"field": str(self.fields["select"].id), "direction": direction, "nulls": "last"}]
                        ),
                        path=path,
                        context=context,
                        **standard,
                    )
                    self.assertEqual(self.ids(response), [str(issue.id) for issue in expected])
                    self.assertTrue(response.data["hentis_server_order"])

    def test_multiselect_filter_suppresses_incompatible_occurrences(self):
        config = self.query(
            group_by=str(self.fields["multiselect"].id),
            filter_tree=self.leaf("multiselect", "contains_any", [self.red]),
        )
        response = self.get_list(config)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn(self.blue, response.data["results"])
        self.assertEqual(response.data["total_count"], 1)
        self.assertEqual(str(response.data["results"][self.red]["results"][0]["id"]), str(self.alpha.id))
        self.assertEqual(self.get_list(config, group=self.blue).status_code, 400)

    def test_multiselect_contains_all_keeps_each_relevant_label_and_unique_totals(self):
        config = self.query(
            group_by=str(self.fields["multiselect"].id),
            filter_tree=self.leaf("multiselect", "contains_all", [self.red, self.blue]),
        )
        response = self.get_list(config)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["total_count"], 1)
        self.assertEqual(response.data["results"][self.red]["total_results"], 1)
        self.assertEqual(response.data["results"][self.blue]["total_results"], 1)

    def test_or_branch_allows_blue_only_when_the_other_predicate_matches(self):
        config = self.query(
            group_by=str(self.fields["multiselect"].id),
            filter_tree={
                "op": "or",
                "children": [self.leaf("multiselect", "contains_any", [self.red]), self.leaf("number", "gt", "25")],
            },
        )
        response = self.get_list(config)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            [str(row["id"]) for row in response.data["results"][self.blue]["results"]], [str(self.alpha.id)]
        )

    def test_custom_group_pagination_is_25_and_returns_full_native_entities(self):
        for i in range(27):
            issue = Issue.objects.create(
                workspace=self.workspace, project=self.project, name=f"group-{i}", state=self.todo
            )
            save_values(
                issue, validate_values(self.project.id, {str(self.fields["select"].id): self.red}), self.admin.id
            )
        config = self.query(group_by=str(self.fields["select"].id))
        first = self.get_list(config)
        second = self.get_list(config, page=1, group=self.red)
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(len(first.data["results"][self.red]["results"]), 25)
        self.assertEqual(len(self.ids(second)), 3)
        self.assertIn("assignee_ids", second.data["results"][0])

    def test_search_id_description_visible_values_and_explicit_hidden_extension(self):
        for term in [
            f"LST-{self.alpha.sequence_id}",
            str(self.alpha.id),
            "description-keyword",
            "needle-custom",
            "Zebra",
        ]:
            self.assertEqual(self.ids(self.get_list(self.query(search=term))), [str(self.alpha.id)])
        visible = [str(field.id) for kind, field in self.fields.items() if kind != "text"]
        self.client.patch(self.native + "native-display/", {**self.context(), "visible": visible}, format="json")
        self.assertEqual(self.ids(self.get_list(self.query(search="needle-custom"))), [])
        self.assertEqual(
            self.ids(self.get_list(self.query(search="needle-custom", search_hidden=True))), [str(self.alpha.id)]
        )
        self.assertEqual(self.ids(self.get_list(self.query(search="Private task", search_hidden=True))), [])

    def test_seven_types_and_colors_keep_their_ids_values_and_history(self):
        wanted = {
            "text": "Original text",
            "number": "12.500000",
            "date": "2026-10-22",
            "boolean": False,
            "select": self.blue,
            "multiselect": [self.red, self.blue],
            "url": "https://example.test/path",
        }
        for kind, value in wanted.items():
            key = str(self.fields[kind].id)
            before = values_for([self.alpha])[str(self.alpha.id)].get(key)
            response = self.client.patch(
                self.custom + f"issues/{self.alpha.id}/",
                {"values": {key: value}, "expected": {key: before}},
                format="json",
            )
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data["values"][key], value)
        metadata = self.client.get(self.custom).data
        self.assertEqual(
            next(field for field in metadata["fields"] if field["id"] == str(self.fields["select"].id))["options"],
            self.options,
        )
        self.assertTrue(Change.objects.filter(issue=self.alpha, actor=self.admin).exists())

    def test_stale_cell_update_does_not_overwrite_a_concurrent_change(self):
        key = str(self.fields["number"].id)
        first = self.client.patch(
            self.custom + f"issues/{self.alpha.id}/", {"values": {key: "10"}, "expected": {key: "30"}}, format="json"
        )
        self.assertEqual(first.status_code, 200)
        second = self.client.patch(
            self.custom + f"issues/{self.alpha.id}/", {"values": {key: "20"}, "expected": {key: "30"}}, format="json"
        )
        self.assertEqual(second.status_code, 409)
        self.assertEqual(values_for([self.alpha])[str(self.alpha.id)][key], "10.000000")

    def test_preferences_widths_and_queries_are_isolated_by_layout_context_and_user(self):
        for layout, width in [("list", 610), ("spreadsheet", 420)]:
            response = self.client.patch(
                self.native + "native-display/", {**self.context(layout), "widths": {"title": width}}, format="json"
            )
            self.assertEqual(response.status_code, 200)
        query = self.query(filter_tree=self.leaf("number", "gt", "10"))
        response = self.client.patch(self.native + "native-display/", {**self.context(), "query": query}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["preference"]["widths"], {"title": 610})
        sheet = self.client.get(self.native + "native-display/", self.context("spreadsheet")).data["preference"]
        self.assertEqual(sheet["widths"], {"title": 420})
        self.assertEqual(sheet["query"], {})
        module = self.client.get(
            self.native + "native-display/", self.context(scope="module", target=self.module.id)
        ).data["preference"]
        self.assertEqual(module["widths"], {})
        self.client.force_authenticate(self.member)
        self.assertEqual(
            self.client.get(self.native + "native-display/", self.context()).data["preference"]["query"], {}
        )

    def test_module_cycle_and_private_view_contexts_use_native_queries(self):
        for scope, entity, path in [
            ("module", self.module, self.base + f"modules/{self.module.id}/issues/"),
            ("cycle", self.cycle, self.base + f"cycles/{self.cycle.id}/cycle-issues/"),
        ]:
            self.assertEqual(
                len(self.ids(self.get_list(path=path, context=self.context(scope=scope, target=entity.id)))), 1
            )

    def test_guest_query_export_and_bulk_only_use_authorized_entities(self):
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.ids(self.get_list()), [str(self.beta.id)])
        self.assertEqual(self.operation("summary").data["count"], 1)
        snapshot = self.operation("selection").data
        result = self.operation("bulk", token=snapshot["token"], values={str(self.fields["text"].id): "Forbidden"})
        self.assertEqual(result.data["succeeded"], 0)
        self.assertNotEqual(values_for([self.beta])[str(self.beta.id)][str(self.fields["text"].id)], "Forbidden")
        exported = self.operation("export", mode="all").content.decode("utf-8-sig")
        self.assertIn("Beta", exported)
        self.assertNotIn("Alpha;", exported)

    def test_summary_aggregates_complete_unique_results_not_occurrences_or_loaded_pages(self):
        config = self.query(
            group_by=str(self.fields["multiselect"].id),
            calculations=[{"field": str(self.fields["number"].id), "operation": "sum"}],
        )
        response = self.operation("summary", config)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 2)
        self.assertEqual(response.data["calculations"][0]["value"], Decimal("32"))

    def test_selection_snapshot_and_bulk_retries_do_not_duplicate_mutations(self):
        key = str(self.fields["number"].id)
        snapshot = self.operation("selection").data
        first = self.operation("bulk", token=snapshot["token"], values={key: "7"})
        self.assertEqual(first.data["succeeded"], 2)
        count = Change.objects.count()
        self.assertEqual(self.operation("bulk", token=snapshot["token"], values={key: "7"}).data, first.data)
        self.assertEqual(Change.objects.count(), count)
        self.assertEqual(self.operation("bulk", token=snapshot["token"], values={key: "8"}).status_code, 409)
        self.client.force_authenticate(self.member)
        self.assertEqual(self.operation("bulk", token=snapshot["token"], values={key: "7"}).status_code, 409)

    def test_view_schema_migration_is_additive_and_preserves_legacy_results(self):
        config = {
            "filters": [self.leaf("number", "gt", "10")],
            "match": "any",
            "order_by": str(self.fields["number"].id),
            "columns": [str(self.fields["number"].id)],
            "layout": "list",
        }
        view = SavedView.objects.create(project=self.project, owner=self.admin, name="Legacy", config=config)
        before = list(
            apply_query(
                Issue.issue_objects.filter(project=self.project),
                self.project.id,
                normalize_query(self.project.id, config),
            ).values_list("id", flat=True)
        )
        importlib.import_module("plane.custom_fields.migrations.0006_upgrade_saved_query_schema").upgrade(apps, None)
        view.refresh_from_db()
        self.assertEqual(view.config["filters"], config["filters"])
        self.assertEqual(view.config["columns"], config["columns"])
        self.assertEqual(view.schema_version, 2)
        after = list(
            apply_query(
                Issue.issue_objects.filter(project=self.project),
                self.project.id,
                normalize_query(self.project.id, view.config),
            ).values_list("id", flat=True)
        )
        self.assertEqual(before, after)

    def test_view_revision_lock_private_access_and_definition_cleanup(self):
        field = self.fields["number"]
        view = SavedView.objects.create(
            project=self.project,
            owner=self.member,
            name="Locked",
            shared=True,
            locked=True,
            config=self.query(
                filter_tree=self.leaf("number", "gt", "10"), sorts=[{"field": str(field.id), "direction": "asc"}]
            ),
        )
        self.client.force_authenticate(self.member)
        self.assertEqual(
            self.client.patch(
                self.custom + f"views/{view.id}/", {"revision": 1, "name": "Changed"}, format="json"
            ).status_code,
            403,
        )
        self.client.force_authenticate(self.admin)
        self.assertEqual(
            self.client.patch(
                self.custom + f"views/{view.id}/", {"revision": 1, "locked": False}, format="json"
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.patch(
                self.custom + f"views/{view.id}/", {"revision": 1, "name": "Stale"}, format="json"
            ).status_code,
            409,
        )
        pref = NativeLayoutPreference.objects.create(
            owner=self.admin,
            workspace=self.workspace,
            project=self.project,
            context_type="project",
            target=self.project.id,
            layout="list",
            query_config=view.config,
        )
        self.assertEqual(self.client.delete(self.custom + f"definitions/{field.id}/").status_code, 204)
        pref.refresh_from_db()
        view.refresh_from_db()
        self.assertEqual(pref.query_config["filter_tree"]["children"], [])
        self.assertEqual(view.config["sorts"], [])

    def test_parent_cycles_required_fields_and_subtask_count_contract(self):
        child = Issue.objects.create(
            workspace=self.workspace, project=self.project, name="Child", state=self.todo, parent=self.alpha
        )
        response = self.client.patch(
            self.base + f"issues/{self.alpha.id}/", {"parent_id": str(child.id)}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(len(self.ids(self.get_list(self.query(subtasks="separate")))), 3)
        self.assertEqual(self.operation("summary", self.query(subtasks="expanded")).data["count"], 2)
        children = self.operation("children", ids=[str(self.alpha.id)])
        self.assertEqual(children.status_code, 200, children.data)
        self.assertEqual(str(children.data["results"][0]["id"]), str(child.id))
        required = Field.objects.create(project=self.project, name="Required", kind="text", required=True)
        rejected = self.client.post(self.base + "issues/", {"name": "Incomplete"}, format="json")
        self.assertEqual(rejected.status_code, 400)
        created = self.client.post(
            self.base + "issues/", {"name": "Complete", "custom_fields": {str(required.id): "yes"}}, format="json"
        )
        self.assertEqual(created.status_code, 201, created.data)

    def test_csv_export_has_authorized_values_and_protects_spreadsheet_formulas(self):
        Issue.objects.filter(pk=self.alpha.id).update(name="=Dangerous formula")
        save_values(
            self.alpha, validate_values(self.project.id, {str(self.fields["boolean"].id): False}), self.admin.id
        )
        response = self.operation("export", mode="all")
        self.assertEqual(response.status_code, 200)
        rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig")), delimiter=";"))
        boolean = rows[0].index("boolean")
        self.assertTrue(any(row[1] == "'=Dangerous formula" for row in rows[1:]))
        self.assertTrue(any(row[boolean] == "False" for row in rows[1:]))
        self.assertNotIn("Private task", response.content.decode())

    def test_requests_without_list_hint_keep_native_order_pagination_and_response(self):
        for group in [None, "state_id"]:
            params = {"per_page": 1, "cursor": "1:0:0", "order_by": "sequence_id"}
            if group:
                params["group_by"] = group
            response = self.client.get(self.base + "issues/", params)
            self.assertEqual(response.status_code, 200, response.data)
            self.assertNotIn("hentis_server_order", response.data)
            rows = response.data["results"][str(self.todo.id)]["results"] if group else response.data["results"]
            ids = [str(row["id"]) for row in rows]
            self.assertEqual(ids, [str(self.alpha.id)])

    def test_guest_children_and_counts_do_not_expose_other_creators(self):
        hidden = Issue.objects.create(
            workspace=self.workspace, project=self.project, name="Hidden child", state=self.todo, parent=self.beta
        )
        visible = Issue.objects.create(
            workspace=self.workspace, project=self.project, name="Visible child", state=self.todo, parent=self.beta
        )
        Issue.objects.filter(pk=hidden.pk).update(created_by=self.admin)
        Issue.objects.filter(pk=visible.pk).update(created_by=self.guest)
        self.client.force_authenticate(self.guest)
        response = self.operation("children", ids=[str(self.beta.id), str(self.alpha.id)])
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["parents"], [str(self.beta.id)])
        self.assertEqual([str(row["id"]) for row in response.data["results"]], [str(visible.id)])
        self.assertEqual(response.data["editable_project_ids"], [])
        rows = self.get_list().data["results"]
        self.assertEqual(next(row for row in rows if str(row["id"]) == str(self.beta.id))["sub_issues_count"], 1)

    def test_bulk_snapshot_returns_partial_results_if_an_item_is_archived_after_selection(self):
        snapshot = self.operation("selection").data
        Issue.objects.filter(pk=self.beta.pk).update(archived_at=timezone.now())
        key = str(self.fields["text"].id)
        response = self.operation("bulk", token=snapshot["token"], values={key: "Updated"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 2)
        self.assertEqual(response.data["succeeded"], 1)
        self.assertEqual(values_for([self.alpha])[str(self.alpha.id)][key], "Updated")
        self.assertEqual(values_for([self.beta])[str(self.beta.id)][key], "ordinary")
        self.assertFalse(next(row for row in response.data["results"] if row["id"] == str(self.beta.id))["ok"])
