import json
from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.test import TestCase, SimpleTestCase
from plane.db.models import Issue, IssueComment, Page, ProjectPage
from . import tests as fixtures
from .models import Action
from .orchestrator import run_generation
from .report_intent import report_subject, wants_report_page
from .tool_transport import normalize_tool_message, visible_assistant_text, ToolEnvelopeError
from .tools import schema

PROMPT = "crie o resumo final da implantação do cliente En do Couto e Luciano do Couto, crie como relatório"
CALLS = (
    "<tool_call><function=search_workspace><parameter=query>En do Couto</parameter></function></tool_call>"
    "<tool_call><function=search_workspace><parameter=query>Luciano do Couto</parameter></function></tool_call>"
)
EXECUTIVE_REPORT = """## 1. Resumo executivo
Implantação acompanhada com entregas e pendências documentadas.

## 2. Dados do cliente
En do Couto e Luciano do Couto. CS responsável não informado nas fontes.

## 3. Serviços e condições comerciais
Não informado nas fontes.

## 4. Estrutura de atendimento
João foi informado como responsável no comentário.

## 5. Linha do tempo
A reunião com Emilly foi realizada em 29/09, segundo o comentário.

## 6. Entregas concluídas
A subtarefa de entregas está concluída.

## 7. Situação por responsável/departamento
O FDC assumiu as pendências da alteração contratual da filial.

## 8. Pendências e próximos passos
Pendências da filial em acompanhamento pelo responsável informado.

## 9. Conclusão e divergências cadastrais
A descrição antiga ainda pede organizar a reunião e deve ser revisada.
"""


class ToolTransportTests(SimpleTestCase):
    def test_the_reported_provider_envelope_becomes_two_real_search_calls(self):
        result = normalize_tool_message({"content": CALLS}, schema())
        self.assertEqual(result["content"], "")
        self.assertEqual([call["function"]["name"] for call in result["tool_calls"]], ["search_workspace"] * 2)
        self.assertEqual(json.loads(result["tool_calls"][1]["function"]["arguments"]), {"query": "Luciano do Couto"})

    def test_fragments_are_not_exposed_in_streamed_text(self):
        for text in ["<", "<too", "<tool_call", CALLS]:
            self.assertEqual(visible_assistant_text(text), "")
        self.assertEqual(visible_assistant_text("Buscando… " + CALLS), "Buscando…")
        self.assertEqual(visible_assistant_text("## Relatório final"), "## Relatório final")

    def test_no_tools_unknown_functions_or_mixed_quoted_text_are_never_executed(self):
        for text, schemas in [
            (CALLS, []),
            (CALLS.replace("search_workspace", "execute_sql"), schema()),
            ("Exemplo:\n```\n" + CALLS + "\n```", schema()),
            (CALLS.replace("</parameter>", "</parameter><parameter=query>duplicate</parameter>", 1), schema()),
        ]:
            with self.subTest(text=text[:50]), self.assertRaises(ToolEnvelopeError):
                normalize_tool_message({"content": text}, schemas)

    def test_explicit_report_creation_is_not_confused_with_other_writes_or_drafts(self):
        self.assertEqual(report_subject(PROMPT), "En do Couto e Luciano do Couto")
        self.assertTrue(wants_report_page(PROMPT))
        for prompt in [
            "Como criar um relatório?",
            "Crie uma tarefa chamada Relatório final",
            "Não crie uma página, apenas no chat",
            "Crie um rascunho de relatório",
        ]:
            self.assertFalse(wants_report_page(prompt))


class ClientReportTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        fixtures.PlaneAITests.setUpTestData.__func__(cls)
        cls.deployment = Issue.objects.create(
            workspace=cls.workspace,
            project=cls.project,
            state=cls.state,
            name="Implantação En do Couto e Luciano do Couto",
            description_html="<p>Organizar reunião com Emilly sobre o software.</p>",
        )
        cls.delivery = Issue.objects.create(
            workspace=cls.workspace,
            project=cls.project,
            state=cls.done,
            parent=cls.deployment,
            name="Entregas concluídas",
        )
        cls.pending = Issue.objects.create(
            workspace=cls.workspace,
            project=cls.project,
            state=cls.state,
            parent=cls.deployment,
            name="Pendências de documentação do FDC",
        )
        cls.unrelated = Issue.objects.create(
            workspace=cls.workspace,
            project=cls.project,
            state=cls.state,
            name="Júlio - Informática sem relação com o cliente",
        )
        cls.comment = IssueComment.objects.create(
            workspace=cls.workspace,
            project=cls.project,
            issue=cls.deployment,
            actor=cls.admin,
            comment_html=(
                "<p>Reunião realizada com Emilly em 29/09. O FDC assumiu as pendências "
                "da alteração contratual da filial. Responsável: João.</p>"
            ),
        )
        IssueComment.objects.filter(pk=cls.comment.pk).update(
            created_at=datetime(2026, 9, 29, 14, tzinfo=ZoneInfo("America/Sao_Paulo"))
        )

    setUp = fixtures.PlaneAITests.setUp
    new_run = fixtures.PlaneAITests.new_run

    def customer_run(self, prompt=PROMPT, model="first"):
        run = self.new_run(prompt=prompt, model=model)
        run.conversation.scope = {"kind": "workspace"}
        run.conversation.save()
        return run

    def test_exact_user_request_searches_only_client_records_and_creates_real_page(self):
        run = self.customer_run()
        captured = []

        class Adapter:
            calls = 0

            def complete(self, model, messages, *args):
                self.calls += 1
                captured.append(json.loads(json.dumps(messages)))
                if self.calls == 1:
                    return {"content": CALLS}, {}
                if self.calls == 2:
                    return {
                        "content": "",
                        "tool_calls": [
                            {
                                "id": "stats",
                                "type": "function",
                                "function": {
                                    "name": "report_workspace",
                                    "arguments": json.dumps({"kind": "overview", "group_by": "project"}),
                                },
                            }
                        ],
                    }, {}
                return {"content": EXECUTIVE_REPORT}, {}

        adapter = Adapter()
        with patch("plane.ai.orchestrator.adapter", return_value=adapter):
            run_generation(run.id)
            run_generation(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "completed", run.error)
        self.assertNotIn("<tool_call", run.response)
        self.assertEqual(run.context_summary["reports"][0]["metrics"]["total"], 3)
        self.assertEqual(len(run.context_summary["focus"]["issue_ids"]), 3)
        self.assertNotIn(str(self.unrelated.id), json.dumps(run.sources))
        self.assertNotIn("Júlio - Informática", json.dumps(captured, ensure_ascii=False))
        self.assertIn("29/09", json.dumps(captured, ensure_ascii=False))
        self.assertIn("Organizar reunião", json.dumps(captured, ensure_ascii=False))
        page = Page.objects.get()
        self.assertIn("FDC", page.description_html)
        self.assertIn("29/09", page.description_html)
        self.assertEqual(page.access, Page.PRIVATE_ACCESS)
        self.assertTrue(ProjectPage.objects.filter(page=page, project=self.project).exists())
        self.assertIn(str(page.id), run.context_summary["publication"]["url"])
        self.assertEqual(Action.objects.filter(run=run, operation="create_report_page", status="done").count(), 1)
        self.assertEqual(adapter.calls, 3)

    def test_models_without_tools_still_receive_focused_facts_and_can_publish_requested_report(self):
        run = self.customer_run(model="second")
        captured = []

        class Adapter:
            def complete(self, model, messages, *args):
                captured.extend(messages)
                return {"content": EXECUTIVE_REPORT}, {}

        with patch("plane.ai.orchestrator.adapter", return_value=Adapter()):
            run_generation(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "completed", run.error)
        self.assertEqual(Page.objects.count(), 1)
        self.assertNotIn("Overdue real task", json.dumps(captured))

    def test_a_model_without_tool_support_gets_one_format_repair_instead_of_raw_markup(self):
        run = self.customer_run(model="second")

        class Adapter:
            calls = 0

            def complete(self, *args):
                self.calls += 1
                return ({"content": CALLS} if self.calls == 1 else {"content": EXECUTIVE_REPORT}), {}

        adapter = Adapter()
        with patch("plane.ai.orchestrator.adapter", return_value=adapter):
            run_generation(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "completed", run.error)
        self.assertEqual(adapter.calls, 2)
        self.assertEqual(Page.objects.count(), 1)
        self.assertNotIn("<tool_call", run.response)

    def test_empty_model_response_does_not_create_an_empty_report_page(self):
        run = self.customer_run(model="second")

        class Adapter:
            def complete(self, *args):
                return {"content": ""}, {}

        with patch("plane.ai.orchestrator.adapter", return_value=Adapter()):
            run_generation(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "failed")
        self.assertIn("Nenhuma página", run.error)
        self.assertFalse(Page.objects.exists())

    def test_report_publication_still_requires_project_write_permission(self):
        self.connection.allowed_roles = [5, 15, 20]
        self.connection.save()
        Issue.objects.filter(pk__in=[self.deployment.id, self.delivery.id, self.pending.id]).update(
            created_by=self.guest
        )
        run = self.customer_run(model="second")
        run.conversation.owner = self.guest
        run.conversation.save()

        class Adapter:
            def complete(self, *args):
                return {"content": EXECUTIVE_REPORT}, {}

        with patch("plane.ai.orchestrator.adapter", return_value=Adapter()):
            run_generation(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "failed")
        self.assertIn("permissão", run.error)
        self.assertFalse(Page.objects.exists())

    def test_missing_clients_do_not_generate_a_workspace_report_or_create_a_page(self):
        run = self.customer_run("Crie relatório do cliente Não Existe de Verdade")
        with patch("plane.ai.orchestrator.adapter", side_effect=AssertionError("No evidence")):
            run_generation(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "completed", run.error)
        self.assertIn("Não encontrei", run.response)
        self.assertEqual(run.context_summary["reports"], [])
        self.assertFalse(Page.objects.exists())

    def test_browser_eventsource_accept_header_is_not_rejected_with_406(self):
        run = self.customer_run()
        response = self.client.get(f"{self.path}runs/{run.id}/events/", HTTP_ACCEPT="text/event-stream")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.streaming)
        self.assertIn("text/event-stream", response["Content-Type"])
        self.client.force_authenticate(self.outsider)
        denied = self.client.get(f"{self.path}runs/{run.id}/events/", HTTP_ACCEPT="text/event-stream")
        self.assertIn(denied.status_code, [403, 404])

    def test_ambiguous_deployments_ask_then_accept_the_task_identifier(self):
        duplicate = Issue.objects.create(
            workspace=self.workspace,
            project=self.project,
            state=self.state,
            name="Implantação En do Couto e Luciano do Couto - outra unidade",
        )
        run = self.customer_run()
        with patch("plane.ai.orchestrator.adapter", side_effect=AssertionError("Ambiguous")):
            run_generation(run.id)
        run.refresh_from_db()
        self.assertIn("mais de uma implantação", run.response)
        self.assertFalse(Page.objects.exists())
        from .models import Run
        from uuid import uuid4

        next_run = Run.objects.create(
            workspace=self.workspace,
            conversation=run.conversation,
            connection=self.connection,
            model="second",
            prompt=f"Use a implantação {self.deployment.id} e crie o relatório",
            request_key=uuid4(),
        )

        class Adapter:
            def complete(self, *args):
                return {"content": "## Relatório escolhido\nReunião concluída."}, {}

        with patch("plane.ai.orchestrator.adapter", return_value=Adapter()):
            run_generation(next_run.id)
        next_run.refresh_from_db()
        self.assertEqual(next_run.status, "completed", next_run.error)
        self.assertTrue(Page.objects.exists(), next_run.response)
        self.assertNotIn(str(duplicate.id), json.dumps(next_run.context_summary["focus"]["issue_ids"]))

    def test_a_model_search_cannot_escape_the_selected_customer(self):
        run = self.customer_run("Faça o relatório do cliente En do Couto e Luciano do Couto")
        results = []

        class Adapter:
            calls = 0

            def complete(self, model, messages, *args):
                self.calls += 1
                if self.calls == 1:
                    return {
                        "content": (
                            "<tool_call><function=search_workspace>"
                            "<parameter=query>Júlio Informática</parameter></function></tool_call>"
                        )
                    }, {}
                results.extend(item["content"] for item in messages if item.get("role") == "tool")
                return {"content": "Relatório do cliente."}, {}

        with patch("plane.ai.orchestrator.adapter", return_value=Adapter()):
            run_generation(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "completed", run.error)
        self.assertNotIn(str(self.unrelated.id), "".join(results))
        self.assertFalse(Page.objects.exists())
