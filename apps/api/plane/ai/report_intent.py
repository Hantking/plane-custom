"""Resolve named-client reports against authorized deployment records before generation."""

import re
import unicodedata
from uuid import uuid5

from django.db.models import Q
from django.db import transaction
from plane.custom_fields.models import Value
from plane.db.models import ProjectPage


def folded(value):
    return "".join(char for char in unicodedata.normalize("NFKD", value.lower()) if not unicodedata.combining(char))


def report_subject(prompt):
    match = re.search(r"\b(?:clientes?|customers?)\s+(?:chamad[oa]\s+)?[\"']?([^,;\n]+)", prompt, re.I)
    if not match:
        match = re.search(r"\b(?:implantação|implantacao|onboarding)\s+(?:do|da|de)\s+[\"']?([^,;\n]+)", prompt, re.I)
    if not match:
        match = re.search(r"\btarefa\s+([A-Za-z][\w]*-\d+)\b", prompt, re.I)
    if not match:
        return None
    subject = re.split(r"\s+(?:crie|gere|salve|publique|como relatorio|como relatório)\b", match[1], flags=re.I)[0]
    return subject.strip(" .\"'")[:300] or None


def wants_report_page(prompt):
    text = folded(prompt)
    if re.search(
        r"\b(crie|criar|create)\s+(?:uma?\s+)?(?:tarefa|subtarefa|task|comentario|comment)\b", text
    ) and not re.search(r"\b(pagina|documento|como relatorio)\b", text):
        return False
    if re.search(r"\b(nao|sem)\s+(?:criar|crie|salvar|salve|publicar|publique)\b", text) or any(
        phrase in text for phrase in ["apenas no chat", "somente no chat", "como criar", "explique como", "rascunho"]
    ):
        return False
    return bool(
        re.search(r"\b(crie|criar|salve|salvar|publique|publicar|create|save|publish)\b", text)
        and re.search(r"\b(relatorio|pagina|documento|report|document|page)\b", text)
    )


def subject_condition(alias):
    terms = [
        term
        for term in re.findall(r"[\w-]+", alias, re.UNICODE)
        if len(term) >= 3 and folded(term) not in {"dos", "das", "cliente", "clientes"}
    ]
    result = Q()
    for term in terms:
        result &= Q(name__icontains=term) | Q(description_stripped__icontains=term)
    return terms, result


def resolve_focus(access, scope, subject, selected_id=None):
    scope = access.scope(scope)
    issues, pages, projects = access.issues(), access.pages(), access.projects()
    if scope["kind"] == "project":
        issues = issues.filter(project_id=scope["id"])
        projects = projects.filter(pk=scope["id"])
        pages = pages.filter(projects__id=scope["id"])
    elif scope["kind"] == "issue":
        issue = access.issue(scope["id"])
        issues = issues.filter(Q(pk=issue.id) | Q(parent_id=issue.id))
        projects = projects.filter(pk=issue.project_id)
    elif scope["kind"] == "page":
        pages = pages.filter(pk=scope["id"])
        issues = issues.none()
    requested_aliases = [alias.strip() for alias in re.split(r"\s+(?:e|and)\s+", subject, flags=re.I) if alias.strip()]
    aliases = requested_aliases[:5]
    roots, page_ids, missing, ambiguous = set(), set(), [], []
    overflow = len(requested_aliases) > 5
    for alias in aliases:
        terms, condition = subject_condition(alias)
        if not terms:
            missing.append(alias)
            continue
        comment_query, custom_query = Q(), Q()
        for term in terms:
            comment_query &= Q(comment_stripped__icontains=term)
            custom_query &= Q(text_value__icontains=term)
        comments = access.comments().filter(comment_query).values("issue_id")
        values = Value.objects.filter(issue_id__in=issues.values("id")).filter(custom_query).values("issue_id")
        matching_projects = projects.filter(name__icontains=alias)
        identifier = re.fullmatch(r"([A-Za-z][\w]*)-(\d+)", alias)
        identifier_match = (
            Q(project__identifier__iexact=identifier[1], sequence_id=int(identifier[2])) if identifier else Q(pk__in=[])
        )
        matches = issues.filter(
            condition
            | identifier_match
            | Q(pk__in=comments)
            | Q(pk__in=values)
            | Q(project_id__in=matching_projects.values("id"))
        ).distinct()
        if selected_id and matches.filter(pk=selected_id).exists():
            matches = matches.filter(pk=selected_id)
        exact = matches.filter(Q(name__icontains=alias) | Q(description_stripped__icontains=alias))
        if exact.exists():
            matches = exact
        deployments = matches.filter(
            Q(name__icontains="implant") | Q(name__icontains="onboard") | Q(name__icontains="implement")
        )
        if deployments.exists():
            matches = deployments
        candidates = list(matches.only("id", "parent_id", "name", "project_id").order_by("created_at")[:1001])
        overflow = overflow or len(candidates) > 1000
        ids = {item.id for item in candidates}
        anchors = [item for item in candidates if item.parent_id not in ids]
        if len(anchors) > 1 and not matching_projects.exists():
            ambiguous.extend(
                {"id": str(item.id), "title": item.name, "project_id": str(item.project_id)} for item in anchors[:10]
            )
        else:
            roots.update(item.id for item in anchors)
        selected_pages = pages.filter(condition).distinct()
        page_ids.update(selected_pages.values_list("id", flat=True)[:20])
        if not candidates and not selected_pages.exists():
            missing.append(alias)
    ids = set(roots)
    frontier = set(roots)
    for _ in range(3):
        frontier = set(access.issues().filter(parent_id__in=frontier).values_list("id", flat=True)[:1001]) - ids
        ids.update(frontier)
        if not frontier or len(ids) > 1000:
            break
    project_ids = set(access.issues().filter(pk__in=ids).values_list("project_id", flat=True))
    project_ids.update(
        ProjectPage.objects.filter(
            page_id__in=page_ids, project_id__in=projects.values("id"), deleted_at__isnull=True
        ).values_list("project_id", flat=True)
    )
    destination_ids = set(access.issues().filter(pk__in=roots).values_list("project_id", flat=True)) or project_ids
    return {
        "subject": subject,
        "queries": aliases,
        "root_ids": [str(key) for key in roots],
        "issue_ids": [str(key) for key in ids],
        "page_ids": [str(key) for key in page_ids],
        "project_ids": [str(key) for key in project_ids],
        "target_project_id": str(next(iter(destination_ids))) if len(destination_ids) == 1 else None,
        "missing": missing,
        "ambiguous": list({item["id"]: item for item in ambiguous}.values()),
        "too_large": overflow or len(ids) > 1000,
    }


def focus_for_run(access, run):
    if re.search(
        r"\b(crie|criar|create)\s+(?:uma?\s+)?(?:tarefa|subtarefa|task|comentario|comment)\b", folded(run.prompt)
    ):
        return None
    if any(
        phrase in folded(run.prompt) for phrase in ["todo o workspace", "todos os projetos", "visao geral do workspace"]
    ):
        return None
    subject = report_subject(run.prompt)
    if "outro cliente" in folded(run.prompt) and not subject:
        return None
    selected_id = None
    if not subject:
        previous = (
            run.conversation.runs.filter(created_at__lt=run.created_at, status="completed")
            .order_by("-created_at")
            .first()
        )
        if previous and previous.context_summary.get("focus") and len(run.prompt) < 1000:
            subject = previous.context_summary["focus"]["subject"]
            selected = {
                item["id"]
                for item in previous.context_summary["focus"].get("ambiguous", [])
                if item["id"] in run.prompt
            }
            if len(selected) == 1:
                selected_id = next(iter(selected))
    return resolve_focus(access, run.conversation.scope, subject, selected_id) if subject else None


def focus_question(focus):
    if focus.get("too_large"):
        return "Encontrei muitos registros para este pedido. Informe a tarefa de implantação ou restrinja o projeto."
    if focus.get("ambiguous"):
        choices = "\n".join(f"- {item['title']} · identificador `{item['id']}`" for item in focus["ambiguous"])
        return "Encontrei mais de uma implantação correspondente. Qual delas devo usar para o relatório?\n\n" + choices
    if focus.get("missing"):
        return (
            "Não encontrei registros autorizados suficientes para: "
            + ", ".join(focus["missing"])
            + ". Informe o nome da tarefa de implantação ou seu identificador para eu gerar o relatório correto."
        )
    return None


def publish_requested_report(access, run, focus):
    previous = (
        run.conversation.runs.filter(created_at__lt=run.created_at, status="completed").order_by("-created_at").first()
    )
    requested = wants_report_page(run.prompt)
    destination_choices = access.projects().filter(pk__in=focus["project_ids"]) if focus else access.projects()
    requested_text = folded(run.prompt).strip(" .")
    chosen = [
        project
        for project in destination_choices
        if str(project.id) in run.prompt
        or len(project.name) > 2
        and (
            folded(project.name) == requested_text
            or re.search(r"\bprojeto\s+[\"']?" + re.escape(folded(project.name)) + r"\b", requested_text)
        )
    ]
    selecting_destination = bool(re.match(r"^(?:use|no|em|projeto|pode ser)\b", requested_text)) or any(
        folded(project.name) == requested_text or str(project.id) == requested_text for project in chosen
    )
    if previous and previous.context_summary.get("publication_pending") and len(chosen) == 1 and selecting_destination:
        requested = True
    if not requested or run.automation_policy:
        return
    if run.actions.filter(operation__in=["create_page", "create_report_page"], status="done").exists():
        return
    destination = str(chosen[0].id) if len(chosen) == 1 else focus.get("target_project_id") if focus else None
    if not destination and run.conversation.scope["kind"] == "project":
        destination = run.conversation.scope["id"]
    if not destination and run.conversation.scope["kind"] == "issue":
        destination = str(access.issue(run.conversation.scope["id"]).project_id)
    if not destination:
        candidates = access.projects().filter(pk__in=focus["project_ids"]) if focus else access.projects()
        if candidates.count() == 1:
            destination = str(candidates.first().id)
    if not destination:
        run.response += "\n\nO relatório está pronto no chat. Em qual projeto devo criar a página?"
        run.context_summary["publication_pending"] = True
        return
    from .report_documents import publish_report
    from .models import Run
    from .providers import Cancelled

    with transaction.atomic():
        current = Run.objects.select_for_update().get(pk=run.pk)
        if current.cancelled:
            raise Cancelled()
        Run.objects.filter(pk=run.pk).update(
            response=run.response, context_summary=run.context_summary, sources=run.sources, status="completed"
        )
        page = publish_report(
            access,
            run,
            {
                "project_id": destination,
                "request_key": str(uuid5(run.id, "requested-report-page")),
                "title": ("Relatório final · " + focus["subject"])[:160] if focus else "Relatório · Plane AI",
                "access": 1,
            },
        )
        run.context_summary["publication"] = page
        Run.objects.filter(pk=run.pk).update(context_summary=run.context_summary)
