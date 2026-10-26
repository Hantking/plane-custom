import json
from datetime import date, datetime
from unittest.mock import patch
from uuid import uuid4
from zoneinfo import ZoneInfo

from django.test import TestCase, SimpleTestCase
from rest_framework.exceptions import ValidationError
from plane.db.models import Issue, IssueComment, Page, ProjectMember, ProjectPage
from plane.custom_fields.models import Field
from plane.custom_fields.services import save_values, validate_values, values_for
from . import tests as fixtures
from .context import retrieve
from .evidence import build_dossier, claim_kind, date_mentions, evidence_manifest
from .orchestrator import run_generation
from .report_documents import report_document
from .report_intent import resolve_focus
from .report_quality import executive_problems, join_continuation
from .models import Action

SUBJECT = "PROJETO SOCIAL AMIGOS PARA SEMPRE"
PROMPT = f"crie o resumo final da implantação do cliente {SUBJECT}, crie como relatório."
REPORT = """## 1. Resumo executivo
A entrada do cliente foi finalizada em 22/10/2026, conforme comentário. Restam ajustes municipais.

## 2. Dados do cliente
Código 931. Início dos serviços em 01/06/2026. CS responsável não informado nas fontes.

## 3. Serviços e condições comerciais
Abertura de CNPJ e contabilidade consultiva sem funcionários e sem movimentação financeira.

## 4. Estrutura de atendimento
Kenya, Maria Rigueti e Gabriella são citadas nos comentários. As etiquetas não provam função de CS.

## 5. Linha do tempo
| Data | Evento |
| --- | --- |
| 17/06/2026 | Entrada no cartório. |
| 22/10/2026 | Entrada finalizada; certificação restante em acompanhamento. |

## 6. Entregas concluídas
CNPJ vinculado e carta de boas-vindas enviada, segundo as fontes.

## 7. Situação por responsável/departamento
Kenya acompanha declarações municipais; Gabriella acompanha documentação da certificação.

## 8. Pendências e próximos passos
Confirmar declarações e receber documentação da segunda certificação. Próximo contato informado: 27/10/2026.

## 9. Conclusão e divergências cadastrais
A tarefa continua aberta no sistema; isso não significa 0% da implantação. O comentário informa entrada finalizada.
O campo de etapa ainda registra Início assistido e o contato em 20/10, divergindo da atualização de 22/10.
"""


class EvidenceUnitTests(SimpleTestCase):
    def test_dates_do_not_invent_years_and_verification_does_not_prove_completion(self):
        mentions = date_mentions("Serviços em 01/06/2026. Próximo contato: 27/10.")
        self.assertEqual(mentions[0]["iso"], "2026-06-01")
        self.assertIsNone(mentions[1]["iso"])
        self.assertEqual(claim_kind("Verificar se a implantação foi finalizada."), "question_or_verification")
        self.assertEqual(claim_kind("A implantação não foi finalizada."), "not_completed")

    def test_manifest_does_not_claim_complete_coverage_when_a_middle_fragment_was_omitted(self):
        source = {"source_id": "issue:a", "original_chars": 30}
        chunks = [
            {"id": str(index), "source_id": "issue:a", "offset": index * 10, "text": "x" * 10} for index in range(3)
        ]
        dossier = {"source_inventory": [source], "evidence": chunks}
        self.assertFalse(evidence_manifest(dossier, [chunks[0], chunks[2]])[0]["complete"])
        self.assertTrue(evidence_manifest(dossier, chunks)[0]["complete"])

    def test_executive_validation_and_partial_table_row_continuation(self):
        self.assertEqual(executive_problems(REPORT), [])
        self.assertTrue(executive_problems(REPORT.split("| 22/10")[0] + "| 22/1"))
        self.assertEqual(
            join_continuation("Texto\n| 22/1", "0/2026 | Concluído. |"), "Texto\n| 22/10/2026 | Concluído. |"
        )
        self.assertEqual(
            join_continuation("Texto\n| 22/1", "\n| 22/10/2026 | Concluído. |"), "Texto\n| 22/10/2026 | Concluído. |"
        )


class ExecutiveReportTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        fixtures.PlaneAITests.setUpTestData.__func__(cls)
        cls.root = Issue.objects.create(
            workspace=cls.workspace,
            project=cls.project,
            state=cls.state,
            name=f"{SUBJECT} - Euclides",
            start_date=date(2026, 6, 1),
            target_date=date(2026, 10, 20),
            external_source="clickup",
            description_html="<p>Código do cliente: 931</p><p>"
            + "Registro cadastral. " * 140
            + "</p><p>SERVIÇO NO FINAL DA DESCRIÇÃO: abertura de CNPJ e contabilidade consultiva.</p>",
        )
        imported = datetime(2026, 10, 18, 16, 28, tzinfo=ZoneInfo("UTC"))
        Issue.objects.filter(pk=cls.root.pk).update(created_at=imported)
        cls.option = str(uuid4())
        cls.stage = Field.objects.create(
            project=cls.project,
            name="Etapa do onboarding",
            kind="select",
            options=[{"id": cls.option, "label": "Início assistido"}],
        )
        cls.contact = Field.objects.create(project=cls.project, name="Próximo contato", kind="date")
        cls.cs = Field.objects.create(project=cls.project, name="CS responsável", kind="text")
        save_values(
            cls.root,
            validate_values(
                cls.project.id, {str(cls.stage.id): cls.option, str(cls.contact.id): "2026-10-20", str(cls.cs.id): None}
            ),
            cls.admin.id,
        )
        dates = [
            "17/06/2026",
            "25/06/2026",
            "26/06/2026",
            "29/06/2026",
            "13/07/2026",
            "15/07/2026",
            "14/09/2026",
            "21/09/2026",
            "22/10/2026",
        ]
        for index, value in enumerate(dates):
            text = f"{value}: Atendimento registrado."
            if index == 0:
                text += " Jurídico registrou entrada no cartório."
            if index == 4:
                text += " CNPJ vinculado e boleto emitido."
            if index == 6:
                text += " Carta de boas-vindas enviada."
            if index == 8:
                text += " " + "Informação de apoio. " * 220
                text += (
                    " Entrada do cliente finalizada em 22/10/2026. Etapa atual: Ajustes; "
                    "Próximo contato: 27/10/2026. Kenya verifica declarações municipais. "
                    "Gabriella aguarda documentação da segunda certificação."
                )
            comment = IssueComment.objects.create(
                workspace=cls.workspace,
                project=cls.project,
                issue=cls.root,
                actor=cls.admin,
                comment_html=f"<p>{text}</p>",
                external_source="clickup",
            )
            IssueComment.objects.filter(pk=comment.pk).update(created_at=imported)

    setUp = fixtures.PlaneAITests.setUp
    new_run = fixtures.PlaneAITests.new_run

    def report_run(self):
        run = self.new_run(prompt=PROMPT, model="second")
        self.connection.context_tokens = 24000
        self.connection.output_tokens = 2000
        self.connection.save()
        return run

    def test_dossier_preserves_full_sources_named_fields_conflicts_and_business_date_candidates(self):
        focus = resolve_focus(self.access, {"kind": "workspace"}, SUBJECT)
        context, _ = retrieve(self.access, {"kind": "workspace"}, report="customer", focus=focus, complete=True)
        context["focus"] = {"subject": SUBJECT}
        dossier = build_dossier(context)
        self.assertIsNone(context["period"])
        self.assertIn("technical", context["record_period"]["meaning"])
        self.assertIn("SERVIÇO NO FINAL", context["issues"][0]["description"])
        self.assertTrue(
            any("Entrada do cliente finalizada" in item["comment_stripped"] for item in context["comments"])
        )
        fields = dossier["business_fields"]
        self.assertTrue(any(item["value"] == "Início assistido" for item in fields))
        self.assertTrue(any(item["value"] == "Ajustes" for item in fields))
        self.assertTrue(any(item["field"] == "next_contact" for item in dossier["conflicts"]))
        self.assertTrue(any(item["iso"] == "2026-06-17" for item in dossier["date_mentions"]))

    def test_readonly_report_receives_all_nine_comments_and_publishes_executive_before_operational_appendix(self):
        run = self.report_run()
        captured = []

        class Adapter:
            def complete(self, model, messages, *args):
                captured.extend(messages)
                return {"content": REPORT, "_finish_reason": "stop"}, {"total_tokens": 10}

        with patch("plane.ai.orchestrator.adapter", return_value=Adapter()):
            run_generation(run.id)
        run.refresh_from_db()
        audit = {key: value for key, value in run.context_summary.get("evidence_audit", {}).items() if key != "sources"}
        self.assertEqual(run.status, "completed", f"{run.error}\n{audit}")
        sent = json.dumps(captured, ensure_ascii=False)
        for value in ["2026-10-27", "27/10/2026", "Início assistido", "Ajustes", "SERVIÇO NO FINAL"]:
            self.assertIn(value, sent)
        manifest = run.context_summary["evidence_audit"]["sources"]
        self.assertEqual(sum(item["kind"] == "comment" for item in manifest), 9)
        self.assertTrue(all(item["complete"] for item in manifest))
        page = Page.objects.get()
        self.assertLess(
            page.description_html.index("Resumo executivo"), page.description_html.index("Anexo operacional")
        )
        self.assertIn("0% da implantação", page.description_html)
        self.assertNotIn("Criei a página", report_document(run)["html"])
        self.assertEqual(report_document(run)["title"], f"Relatório final · {SUBJECT}")
        self.assertEqual(values_for([self.root])[str(self.root.id)][str(self.contact.id)], "2026-10-20")

    def test_length_termination_continues_the_cut_date_before_publication(self):
        run = self.report_run()
        cut = REPORT.index("| 22/10") + len("| 22/1")

        class Adapter:
            calls = 0

            def complete(self, *args):
                self.calls += 1
                return {
                    "content": REPORT[:cut] if self.calls == 1 else REPORT[cut:],
                    "_finish_reason": "length" if self.calls == 1 else "stop",
                }, {"total_tokens": 5}

        adapter = Adapter()
        with patch("plane.ai.orchestrator.adapter", return_value=adapter):
            run_generation(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "completed", run.error)
        self.assertEqual(adapter.calls, 2)
        self.assertEqual(run.context_summary["generation"]["continuations"], 1)
        self.assertEqual(run.usage["total_tokens"], 10)
        self.assertIn("22/10/2026", Page.objects.get().description_html)

    def test_exhausted_output_limit_cannot_publish_or_export_a_partial_report(self):
        run = self.report_run()

        class Adapter:
            calls = 0

            def complete(self, *args):
                self.calls += 1
                return {"content": "## 1. Resumo executivo\n| 22/1", "_finish_reason": "length"}, {}

        adapter = Adapter()
        with patch("plane.ai.orchestrator.adapter", return_value=adapter):
            run_generation(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "failed")
        self.assertEqual(adapter.calls, 4)
        self.assertFalse(Page.objects.exists())
        run.status = "completed"
        with self.assertRaises(ValidationError):
            report_document(run)

    def test_missing_sections_are_repaired_once_and_persistent_incompleteness_is_not_published(self):
        for repair_succeeds in [True, False]:
            Page.objects.all().delete()
            run = self.report_run()

            class Adapter:
                calls = 0

                def complete(self, *args):
                    self.calls += 1
                    return {
                        "content": REPORT
                        if repair_succeeds and self.calls > 1
                        else "## 1. Resumo executivo\nTexto parcial.",
                        "_finish_reason": "stop",
                    }, {}

            with patch("plane.ai.orchestrator.adapter", return_value=Adapter()):
                run_generation(run.id)
            run.refresh_from_db()
            self.assertEqual(run.status, "completed" if repair_succeeds else "failed", run.error)
            self.assertEqual(Page.objects.exists(), repair_succeeds)

    def test_evidence_does_not_get_silently_dropped_when_window_is_too_small(self):
        run = self.report_run()
        self.connection.context_tokens = 3000
        self.connection.output_tokens = 1000
        self.connection.save()
        with patch("plane.ai.orchestrator.adapter", side_effect=AssertionError("Evidence must fit first")):
            run_generation(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "failed")
        self.assertIn("janela", run.error)
        self.assertFalse(Page.objects.exists())

    def test_revocation_during_continuation_prevents_publication(self):
        run = self.report_run()
        project = self.project
        actor = self.admin

        class Adapter:
            def complete(self, *args):
                ProjectMember.objects.filter(project=project, member=actor).delete()
                return {"content": "Relatório parcial", "_finish_reason": "length"}, {}

        with patch("plane.ai.orchestrator.adapter", return_value=Adapter()):
            run_generation(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "failed")
        self.assertFalse(Page.objects.exists())

    def test_reading_limit_is_checked_before_loading_a_huge_customer_document(self):
        run = self.report_run()
        Issue.objects.filter(pk=self.root.pk).update(description_html="<p>" + "x" * 2_000_001 + "</p>")
        with patch("plane.ai.orchestrator.adapter", side_effect=AssertionError("Read limit must run first")):
            run_generation(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "failed")
        self.assertIn("limite de leitura", run.error)
        self.assertFalse(Page.objects.exists())

    def test_previous_ai_reports_are_not_reimported_as_primary_business_evidence(self):
        old_page = Page.objects.create(
            workspace=self.workspace,
            owned_by=self.admin,
            name=f"Relatório antigo {SUBJECT}",
            description_html="<p>AFIRMAÇÃO INCORRETA: onboarding em 0% e contato perdido.</p>",
        )
        ProjectPage.objects.create(workspace=self.workspace, project=self.project, page=old_page)
        old_run = self.new_run(prompt="Relatório anterior", model="second")
        old_run.status = "completed"
        old_run.save()
        Action.objects.create(
            workspace=self.workspace,
            run=old_run,
            ordinal=1001,
            operation="create_report_page",
            status="done",
            arguments={},
            result={"kind": "page", "id": str(old_page.id), "title": old_page.name},
        )
        run = self.report_run()
        captured = []

        class Adapter:
            def complete(self, model, messages, *args):
                captured.extend(messages)
                return {"content": REPORT, "_finish_reason": "stop"}, {}

        with patch("plane.ai.orchestrator.adapter", return_value=Adapter()):
            run_generation(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "completed", run.error)
        self.assertNotIn("AFIRMAÇÃO INCORRETA", json.dumps(captured, ensure_ascii=False))
        excluded = [item for item in run.context_summary["evidence_audit"]["sources"] if item["id"] == str(old_page.id)]
        self.assertEqual(excluded[0]["excluded_reason"], "previous_ai_report_not_primary_evidence")

    def test_provider_content_filter_is_not_retried_or_published(self):
        run = self.report_run()

        class Adapter:
            calls = 0

            def complete(self, *args):
                self.calls += 1
                return {"content": "Parcial", "_finish_reason": "content_filter"}, {}

        adapter = Adapter()
        with patch("plane.ai.orchestrator.adapter", return_value=adapter):
            run_generation(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "failed")
        self.assertEqual(adapter.calls, 1)
        self.assertFalse(Page.objects.exists())
