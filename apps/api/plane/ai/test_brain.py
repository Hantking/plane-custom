import json
from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from plane.db.models import Issue
from . import tests as fixtures
from .context import retrieve
from .security import Access, encrypt, decrypt
from .models import Connection
from .reports import build_report, prompt_report
from .orchestrator import run_generation


class BrainExperienceTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        fixtures.PlaneAITests.setUpTestData.__func__(cls)

    setUp = fixtures.PlaneAITests.setUp
    new_run = fixtures.PlaneAITests.new_run

    def test_catalog_can_discover_before_saving_without_exposing_the_key(self):
        count = Connection.objects.count()
        seen = []

        def provider(connection):
            seen.append(decrypt(connection.encrypted_key))

            class Adapter:
                def catalog(self):
                    return [{"id": "real-listed-id"}]

            return Adapter()

        with patch("plane.ai.views.adapter", side_effect=provider):
            response = self.client.post(
                self.path + "catalog/",
                {"base_url": "https://provider.invalid/v1", "api_key": "private-key"},
                format="json",
            )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(seen, ["private-key"])
        self.assertNotIn("private-key", json.dumps(response.data))
        self.assertEqual(Connection.objects.count(), count)

    def test_catalog_preserves_saved_key_and_rejects_members_and_credential_forwarding(self):
        self.connection.encrypted_key = encrypt("saved-key")
        self.connection.save()
        seen = []

        class Adapter:
            def __init__(self, connection):
                seen.append(decrypt(connection.encrypted_key))

            def catalog(self):
                return []

        with patch("plane.ai.views.adapter", side_effect=Adapter):
            response = self.client.post(
                self.path + "catalog/", {"connection_id": str(self.connection.id)}, format="json"
            )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(seen, ["saved-key"])
        response = self.client.post(
            self.path + "catalog/",
            {"connection_id": str(self.connection.id), "base_url": "https://other.invalid/v1"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.client.force_authenticate(self.member)
        self.assertEqual(
            self.client.post(
                self.path + "catalog/", {"connection_id": str(self.connection.id)}, format="json"
            ).status_code,
            403,
        )

    def test_reports_count_all_authorized_rows_and_workloads_do_not_duplicate_totals(self):
        for index in range(27):
            Issue.objects.create(
                workspace=self.workspace, project=self.project, name=f"More work {index}", state=self.state
            )
        self.issue.assignees.add(
            self.admin, self.member, through_defaults={"project": self.project, "workspace": self.workspace}
        )
        report, sources = build_report(self.access, {"kind": "workspace"}, {"kind": "workload", "group_by": "assignee"})
        self.assertEqual(report["metrics"]["total"], 29)
        self.assertEqual(report["metrics"]["overdue"], 1)
        self.assertEqual(sum(row[1] for row in report["rows"]), 30)
        self.assertEqual(len(report["rows"]), len(report["row_ids"]))
        self.assertNotIn(str(self.private.id), json.dumps(sources))
        self.assertIn("não some", report["definition"])

    def test_report_time_window_is_exact_and_validates_periods(self):
        Issue.objects.filter(pk=self.issue.pk).update(created_at=timezone.now() - timedelta(days=20))
        today = timezone.now().date()
        report, _ = build_report(
            self.access,
            {"kind": "project", "id": str(self.project.id)},
            {"kind": "created", "start": str(today - timedelta(days=2)), "end": str(today + timedelta(days=1))},
        )
        self.assertEqual(report["metrics"]["total"], 1)
        self.assertEqual(report["timezone"], "America/Sao_Paulo")
        for arguments in [
            {"kind": "overview", "sql": "unexpected"},
            {"start": "2026-10-02", "end": "2026-10-01"},
            {"start": "2020-01-01", "end": "2026-01-01"},
        ]:
            with self.assertRaises(ValidationError):
                build_report(self.access, {"kind": "workspace"}, arguments)

    def test_guests_only_see_their_own_items_in_report_totals(self):
        Issue.objects.filter(pk=self.issue.pk).update(created_by=self.guest)
        report, sources = build_report(Access(self.guest, self.workspace.slug), {"kind": "workspace"}, {})
        self.assertEqual(report["metrics"]["total"], 1)
        self.assertNotIn(str(self.private.id), json.dumps(sources))

    def test_search_finds_project_names_people_and_meaningful_terms_after_prompt_words(self):
        self.issue.assignees.add(self.admin, through_defaults={"project": self.project, "workspace": self.workspace})
        type(self.admin).objects.filter(pk=self.admin.pk).update(display_name="Marina")
        for query in ["Main", "Busque por favor todas as informações sobre Main", "Marina"]:
            context, _ = retrieve(self.access, {"kind": "workspace"}, query)
            self.assertGreater(context["metrics"]["matching"], 0)
            self.assertNotIn("Do not disclose", json.dumps(context))

    def test_report_is_renderable_even_when_model_has_no_tool_calling(self):
        run = self.new_run(prompt="Faça um relatório de progresso", model="second")

        class Adapter:
            def complete(self, *args, **kwargs):
                return {"content": "## Progresso\nResumo baseado nos dados enviados."}, {}

        with patch("plane.ai.orchestrator.adapter", return_value=Adapter()):
            run_generation(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "completed", run.error)
        self.assertEqual(run.context_summary["reports"][0]["metrics"]["total"], 2)
        self.assertTrue(run.context_summary["reports"][0]["rows"])

    def test_report_tool_uses_same_scope_and_persists_the_computed_table(self):
        run = self.new_run(prompt="Analise o trabalho da equipe")

        class Adapter:
            calls = 0

            def complete(self, *args, **kwargs):
                self.calls += 1
                if self.calls == 1:
                    return {
                        "content": "",
                        "tool_calls": [
                            {
                                "id": "report-1",
                                "type": "function",
                                "function": {
                                    "name": "report_workspace",
                                    "arguments": json.dumps({"kind": "overview", "group_by": "state"}),
                                },
                            }
                        ],
                    }, {}
                return {"content": "Relatório calculado."}, {}

        with patch("plane.ai.orchestrator.adapter", return_value=Adapter()):
            run_generation(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "completed", run.error)
        self.assertEqual(run.context_summary["reports"][0]["group_by"], "state")
        self.assertEqual(run.context_summary["reports"][0]["metrics"]["total"], 2)

    def test_previous_month_report_is_not_short_circuited_by_an_empty_current_week_sample(self):
        past = timezone.now().replace(day=1) - timedelta(days=2)
        Issue.objects.filter(project=self.project).update(updated_at=past)
        run = self.new_run(prompt="O que mudou no mês passado?", model="second")

        class Adapter:
            def complete(self, *args, **kwargs):
                return {"content": "Relatório do mês passado calculado."}, {}

        with patch("plane.ai.orchestrator.adapter", return_value=Adapter()):
            run_generation(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "completed", run.error)
        self.assertEqual(run.context_summary["reports"][0]["metrics"]["total"], 2)
        self.assertIn("calculado", run.response)

    def test_relative_period_uses_context_calendar_and_previous_month_boundaries(self):
        context = {"as_of": "2026-03-02T00:15:00-03:00", "report": "changed"}
        self.assertEqual(prompt_report("Resumo da semana passada", context)["start"], "2026-02-23")
        self.assertEqual(prompt_report("Conclusões do mês passado", context)["end"], "2026-02-28")
