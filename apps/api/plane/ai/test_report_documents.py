from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase, override_settings
from plane.db.models import Issue, Page, ProjectPage, ProjectMember
from . import tests as fixtures
from .models import Action
from .reports import build_report
from .security import Access


@override_settings(WEB_URL="https://plane.example")
class ReportDocumentTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        fixtures.PlaneAITests.setUpTestData.__func__(cls)

    setUp = fixtures.PlaneAITests.setUp
    new_run = fixtures.PlaneAITests.new_run

    def completed_run(self, actor=None):
        run = self.new_run(prompt="Relatório do projeto", model="second")
        if actor:
            run.conversation.owner = actor
            run.conversation.save()
        report, sources = build_report(Access(actor or self.admin, self.workspace.slug), run.conversation.scope, {})
        run.context_summary = {"scope": run.conversation.scope, "reports": [report]}
        run.sources = sources
        run.response = "## Análise do projeto\n\nConclusões e próximos passos com **ênfase**."
        run.status = "completed"
        run.save()
        return run

    def publish(self, run, **changes):
        body = {
            "project_id": str(self.project.id),
            "request_key": str(uuid4()),
            "title": "Relatório de progresso",
            **changes,
        }
        return self.client.post(self.path + f"runs/{run.id}/report-page/", body, format="json")

    def test_export_uses_stored_snapshot_with_markdown_tables_period_and_sources(self):
        run = self.completed_run()
        Issue.objects.create(workspace=self.workspace, project=self.project, name="Created later", state=self.state)
        with patch("plane.ai.orchestrator.adapter", side_effect=AssertionError("Export must not call a model")):
            response = self.client.get(self.path + f"runs/{run.id}/report-document/")
        self.assertEqual(response.status_code, 200, response.data)
        html = response.data["html"]
        self.assertIn("<h2>Análise do projeto</h2>", html)
        self.assertIn("<strong>ênfase</strong>", html)
        self.assertIn("<table>", html)
        self.assertIn("Tarefas: 2", html)
        self.assertIn("https://plane.example/ai-tests/projects/", html)
        self.assertNotIn("Created later", html)

    def test_selected_report_and_unfinished_run_are_validated(self):
        run = self.completed_run()
        path = self.path + f"runs/{run.id}/report-document/"
        self.assertEqual(self.client.get(path, {"report_id": run.context_summary["reports"][0]["id"]}).status_code, 200)
        self.assertEqual(self.client.get(path, {"report_id": "foreign-report"}).status_code, 400)
        run.status = "running"
        run.save()
        self.assertEqual(self.client.get(path).status_code, 400)
        self.assertEqual(self.publish(run).status_code, 400)

    def test_publication_creates_native_editable_private_page_with_snapshot_content(self):
        run = self.completed_run()
        response = self.publish(run)
        self.assertEqual(response.status_code, 201, response.data)
        page = Page.objects.get(pk=response.data["id"])
        self.assertEqual(page.owned_by_id, self.admin.id)
        self.assertEqual(page.created_by_id, self.admin.id)
        self.assertEqual(page.access, Page.PRIVATE_ACCESS)
        self.assertFalse(page.is_locked)
        self.assertIsNone(page.description_binary)
        self.assertIn("<table>", page.description_html)
        self.assertIn("Tarefas: 2", page.description_html)
        self.assertNotIn('class="page-title"', page.description_html)
        self.assertTrue(ProjectPage.objects.filter(page=page, project=self.project).exists())
        self.assertEqual(Action.objects.get(run=run, operation="create_report_page").result["id"], str(page.id))
        self.assertIn(f"/projects/{self.project.id}/pages/{page.id}", response.data["url"])

    def test_retry_does_not_duplicate_page_and_changed_request_conflicts(self):
        run = self.completed_run()
        key = str(uuid4())
        first = self.publish(run, request_key=key)
        repeated = self.publish(run, request_key=key)
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(repeated.data, first.data)
        self.assertEqual(Page.objects.count(), 1)
        self.assertEqual(self.publish(run, request_key=key, title="Another title").status_code, 409)
        self.assertEqual(Page.objects.count(), 1)

    def test_destination_access_and_content_cannot_be_spoofed(self):
        run = self.completed_run()
        self.assertEqual(self.publish(run, project_id=str(self.private.id)).status_code, 404)
        self.assertEqual(self.publish(run, html="<p>Forged totals</p>").status_code, 400)
        self.assertEqual(self.publish(run, report_id="unknown").status_code, 400)
        self.assertFalse(Page.objects.exists())

    def test_explicit_shared_visibility_uses_native_page_permissions(self):
        run = self.completed_run()
        response = self.publish(run, access=0)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Page.objects.get(pk=response.data["id"]).access, Page.PUBLIC_ACCESS)

    def test_guests_can_export_owned_reports_but_cannot_publish_pages(self):
        self.connection.allowed_roles = [5, 15, 20]
        self.connection.save()
        run = self.completed_run(actor=self.guest)
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.client.get(self.path + f"runs/{run.id}/report-document/").status_code, 200)
        self.assertEqual(self.publish(run).status_code, 403)
        self.assertEqual(self.client.get(self.path).data["writable_projects"], [])

    def test_revoked_sources_and_another_conversation_owner_cannot_export_or_publish(self):
        run = self.completed_run()
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.get(self.path + f"runs/{run.id}/report-document/").status_code, 404)
        self.assertEqual(self.publish(run).status_code, 404)
        self.client.force_authenticate(self.admin)
        ProjectMember.objects.filter(project=self.project, member=self.admin).delete()
        self.assertIn(self.client.get(self.path + f"runs/{run.id}/report-document/").status_code, [403, 404])
        self.assertIn(self.publish(run).status_code, [403, 404])

    def test_html_scripts_images_and_harmful_links_are_not_exported_as_executable_content(self):
        run = self.completed_run()
        run.response = "# Relatório\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n![Imagem](https://external.invalid/pixel)"
        run.save()
        html = self.client.get(self.path + f"runs/{run.id}/report-document/").data["html"]
        self.assertNotIn("<script", html)
        self.assertNotIn("<img", html)
        self.assertNotIn('href="javascript:', html)
        self.assertIn("<h1>Relatório</h1>", html)
