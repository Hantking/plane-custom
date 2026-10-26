"""Immutable report snapshots shared by PDF downloads and native Plane pages."""

from html import escape
from urllib.parse import urljoin, urlsplit

import mistune
from bs4 import BeautifulSoup
from crum import impersonate
from django.conf import settings
from django.db import transaction
from django.db.models import Max
from rest_framework import serializers
from rest_framework.exceptions import APIException, ValidationError

from plane.app.serializers.page import PageSerializer
from plane.utils.content_validator import validate_html_content
from .context import page_url
from .models import Action, Run
from .evidence import supplied_sources


class PublicationConflict(APIException):
    status_code = 409
    default_detail = "Esta solicitação já foi usada com outra configuração de página."


class ReportPageRequest(serializers.Serializer):
    project_id = serializers.UUIDField()
    request_key = serializers.UUIDField()
    title = serializers.CharField(max_length=160)
    report_id = serializers.CharField(max_length=255, required=False, allow_blank=True)
    access = serializers.ChoiceField(choices=[0, 1], default=1)


def absolute_url(value):
    if not isinstance(value, str):
        return ""
    if value.startswith("/") and not value.startswith("//"):
        base = getattr(settings, "WEB_URL", None)
        if not base:
            return value
        value = urljoin(base.rstrip("/") + "/", value.lstrip("/"))
    try:
        return value if urlsplit(value).scheme in {"https", "http"} else ""
    except ValueError:
        return ""


def safe_markdown(text):
    renderer = mistune.create_markdown(escape=True, plugins=["table", "strikethrough"])
    soup = BeautifulSoup(renderer(text), "html.parser")
    for image in soup.find_all("img"):
        image.replace_with(image.get("alt", ""))
    for anchor in soup.find_all("a"):
        url = absolute_url(anchor.get("href", ""))
        if url:
            anchor["href"] = url
        else:
            anchor.unwrap()
    return str(soup).strip()


def report_document(run, report_id=None, title=None):
    if run.status != "completed":
        raise ValidationError("Aguarde a conclusão da resposta para exportar o relatório.")
    if (
        run.context_summary.get("generation", {}).get("complete") is False
        or run.context_summary.get("report_validation", {}).get("valid") is False
    ):
        raise ValidationError("O relatório ainda não foi concluído/validado para publicação.")
    reports = run.context_summary.get("reports", [])
    if report_id:
        reports = [report for report in reports if report["id"] == report_id]
        if not reports:
            raise ValidationError("Este relatório não pertence à resposta selecionada.")
    if not run.response and not reports:
        raise ValidationError("Esta resposta não possui conteúdo para exportação.")
    executive = run.context_summary.get("final_report", False)
    default_title = (
        ("Relatório final · " + run.context_summary.get("focus", {}).get("subject", "Cliente"))
        if executive
        else reports[0]["title"]
        if len(reports) == 1
        else "Relatório · Plane AI"
    )
    title = title or default_title
    parts = [f'<h1 class="page-title">{escape(title)}</h1>']
    metadata = f"<p>Plane AI · Modelo: {escape(run.model)}</p><p><strong>Solicitação:</strong> {escape(run.prompt)}</p>"
    if not executive:
        parts.append(metadata)
    if run.response:
        parts.append(safe_markdown(run.response))
    for report in reports:
        if report.get("presentation") == "operational_appendix":
            parts.append(
                "<h2>Anexo operacional — registro no Plane</h2><p>Os indicadores abaixo descrevem tarefas no sistema. "
                "Não representam o percentual de conclusão do onboarding nem substituem as evidências de negócio.</p>"
            )
        parts.append(f"<h2>{escape(report['title'])}</h2>")
        period = report.get("period")
        caption = f"{period['from']} a {period['to']}" if period else f"Retrato em {report['as_of']}"
        parts.append(f"<p>{escape(caption)} · {escape(report['timezone'])}</p>")
        metrics = report["metrics"]
        parts.append(
            f"<p><strong>Tarefas: {metrics['total']}</strong> · "
            f"Concluídas: {metrics['completed']} · Atrasadas: {metrics['overdue']}</p>"
        )
        parts.append(
            "<table><thead><tr>"
            + "".join(f"<th><p>{escape(column)}</p></th>" for column in report["columns"])
            + "</tr></thead><tbody>"
        )
        for row in report["rows"]:
            parts.append("<tr>" + "".join(f"<td><p>{escape(str(cell))}</p></td>" for cell in row) + "</tr>")
        parts.append("</tbody></table>")
        parts.append(f"<p>{escape(report['definition'])}</p>")
        if report.get("truncated"):
            parts.append("<p>Exibição limitada a 100 grupos; os totais consideram todos os itens autorizados.</p>")
    if run.context_summary.get("truncated"):
        parts.append("<p>A análise utiliza contexto limitado. As tabelas mantêm os totais calculados pelo backend.</p>")
    if executive:
        parts.append("<h2>Detalhes da geração</h2>" + metadata)
    sources = supplied_sources(run)
    if sources:
        parts.append("<h2>Fontes consultadas</h2><ul>")
        for source in sources:
            url = absolute_url(source.get("url"))
            label = escape(source.get("title", "Fonte"))
            parts.append(f'<li><a href="{escape(url, quote=True)}">{label}</a></li>' if url else f"<li>{label}</li>")
        parts.append("</ul>")
    valid, error, html = validate_html_content("".join(parts))
    if not valid:
        raise ValidationError(error)
    return {"title": title, "html": html, "filename": "relatorio-plane-ai.pdf"}


def publish_report(access, run, data):
    if set(data) - {"project_id", "request_key", "title", "report_id", "access"}:
        raise ValidationError("Parâmetros de publicação inválidos.")
    request = ReportPageRequest(data=data)
    request.is_valid(raise_exception=True)
    values = request.validated_data
    project = access.project(values["project_id"], write=True)
    arguments = {key: str(value) if key in {"project_id", "request_key"} else value for key, value in values.items()}
    with transaction.atomic():
        run = (
            Run.objects.select_for_update()
            .select_related("conversation__owner", "connection", "workspace")
            .get(pk=run.pk)
        )
        from .orchestrator import get_access

        access = get_access(run)
        access.project(project.id, write=True)
        old = run.actions.filter(
            operation="create_report_page", arguments__request_key=arguments["request_key"]
        ).first()
        if old:
            if old.arguments != arguments:
                raise PublicationConflict()
            page = access.page(old.result["id"])
            return {**old.result, "title": page.name}
        document = report_document(run, values.get("report_id"), values["title"])
        page_content = BeautifulSoup(document["html"], "html.parser")
        page_title = page_content.find("h1", class_="page-title")
        if page_title:
            page_title.decompose()
        serializer = PageSerializer(
            data={"name": values["title"], "access": values["access"]},
            context={
                "project_id": project.id,
                "owned_by_id": access.user.id,
                "description_json": {},
                "description_binary": None,
                "description_html": str(page_content),
            },
        )
        serializer.is_valid(raise_exception=True)
        with impersonate(access.user):
            page = serializer.save(created_by=access.user, updated_by=access.user)
        result = {
            "kind": "page",
            "id": str(page.id),
            "title": page.name,
            "url": page_url(access.workspace.slug, page, project.id),
        }
        ordinal = max(1000, run.actions.aggregate(value=Max("ordinal"))["value"] or 0) + 1
        Action.objects.create(
            workspace=access.workspace,
            run=run,
            ordinal=ordinal,
            operation="create_report_page",
            arguments=arguments,
            status="done",
            result=result,
        )
        return result
