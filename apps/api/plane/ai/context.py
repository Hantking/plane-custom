"""Bounded lexical retrieval on the real CE data model. All metrics are SQL-derived."""

import json
import re
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from django.db.models import Q, Count, Case, When, Value as Literal, IntegerField
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from plane.db.models import (
    IssueActivity,
    IssueRelation,
    Cycle,
    Module,
    State,
    ProjectMember,
    Label,
    ProjectPage,
)
from plane.custom_fields.models import Field
from plane.custom_fields.services import values_for

REPORTS = {"search", "customer", "overview", "overdue", "blocked", "changed", "cycle", "priorities"}


def issue_url(slug, issue):
    return f"/{slug}/projects/{issue.project_id}/issues/{issue.id}"


def page_url(slug, page, project_id):
    return f"/{slug}/projects/{project_id}/pages/{page.id}"


def retrieve(access, scope, query="", report="search", limit=20, focus=None):
    scope = access.scope(scope)
    if report not in REPORTS:
        raise ValidationError("Relatório desconhecido.")
    try:
        zone = ZoneInfo(access.user.user_timezone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo("UTC")
    now = timezone.now().astimezone(zone)
    today = now.date()
    since = datetime.combine(today - timedelta(days=today.weekday()), time.min, zone)
    issues = access.issues()
    projects = access.projects()
    pages = access.pages()
    if scope["kind"] == "project":
        projects = projects.filter(pk=scope["id"])
        issues = issues.filter(project_id=scope["id"])
        pages = pages.filter(
            pk__in=ProjectPage.objects.filter(project_id=scope["id"], deleted_at__isnull=True).values("page_id")
        )
    elif scope["kind"] == "issue":
        current = access.issue(scope["id"])
        issues = issues.filter(Q(pk=current.id) | Q(parent_id=current.id))
        projects = projects.filter(pk=current.project_id)
        pages = pages.none()
    elif scope["kind"] == "page":
        page = access.page(scope["id"])
        pages = pages.filter(pk=page.id)
        projects = projects.filter(
            pk__in=ProjectPage.objects.filter(page=page, deleted_at__isnull=True).values("project_id")
        )
        issues = issues.none()
    if focus:
        issues = issues.filter(pk__in=focus["issue_ids"])
        pages = pages.filter(pk__in=focus["page_ids"])
        projects = projects.filter(pk__in=focus["project_ids"])
    sources, records = [], []

    def source(kind, identifier, title, url):
        item = {"kind": kind, "id": str(identifier), "title": title, "url": url}
        if not any(s["kind"] == kind and s["id"] == str(identifier) for s in sources):
            sources.append(item)
        return item

    open_issues = issues.exclude(state__group__in=["completed", "cancelled"])
    filtered = issues
    if report == "overdue":
        filtered = open_issues.filter(target_date__lt=today)
    elif report == "blocked":
        filtered = open_issues.filter(
            id__in=IssueRelation.objects.filter(
                issue_id__in=issues.values("id"),
                related_issue_id__in=access.issues().exclude(state__group__in=["completed", "cancelled"]).values("id"),
                relation_type="blocked_by",
            ).values("issue_id")
        )
    elif report == "changed":
        changed_ids = IssueActivity.objects.filter(created_at__gte=since, project_id__in=projects.values("id")).values(
            "issue_id"
        )
        filtered = issues.filter(Q(updated_at__gte=since) | Q(pk__in=changed_ids))
    elif report == "priorities":
        filtered = open_issues.filter(assignees=access.user).filter(
            Q(target_date__lte=today) | Q(priority__in=["urgent", "high"])
        )
    elif report == "cycle":
        active = Cycle.objects.filter(project_id__in=projects.values("id"), start_date__lte=now, end_date__gte=now)
        filtered = issues.filter(issue_cycle__cycle_id__in=active.values("id"))
    elif report == "search" and query.strip() and scope["kind"] not in {"issue", "page"}:
        # Preserve exact identifiers and meaningful words without sending the workspace wholesale.
        stop = {
            "que",
            "como",
            "para",
            "uma",
            "this",
            "what",
            "the",
            "quais",
            "projeto",
            "tarefas",
            "está",
            "onde",
            "buscar",
            "busque",
            "encontre",
            "procure",
            "sobre",
            "mostre",
            "mostrar",
            "informe",
            "preciso",
            "quero",
            "workspace",
            "todos",
            "todas",
            "meus",
            "minhas",
            "documentos",
            "páginas",
            "informações",
            "detalhes",
            "faça",
            "faca",
            "por",
            "favor",
        }
        terms = [term for term in re.findall(r"[\w-]{3,}", query, re.UNICODE) if term.lower() not in stop][:8]
        conditions, page_conditions, comment_conditions, identifiers = Q(), Q(), Q(), Q()
        for term in terms:
            if term.lower() not in stop:
                conditions |= Q(name__icontains=term) | Q(description_stripped__icontains=term)
                conditions |= Q(project__name__icontains=term) | Q(project__identifier__iexact=term)
                conditions |= Q(assignees__display_name__icontains=term) | Q(labels__name__icontains=term)
                page_conditions |= Q(name__icontains=term) | Q(description_stripped__icontains=term)
                comment_conditions |= Q(comment_stripped__icontains=term)
                match = re.fullmatch(r"(.+)-(\d+)", term)
                if match:
                    identifiers |= Q(project__identifier__iexact=match[1], sequence_id=int(match[2]))
                from uuid import UUID

                try:
                    identifiers |= Q(pk=UUID(term))
                except ValueError:
                    pass
        if conditions:
            matching_comments = access.comments().filter(comment_conditions).values("issue_id")
            filtered = issues.filter(conditions | identifiers | Q(pk__in=matching_comments))
            pages = pages.filter(page_conditions).distinct()
    metrics = {
        "total": issues.count(),
        "completed": issues.filter(state__group="completed").count(),
        "overdue": open_issues.filter(target_date__lt=today).count(),
        "matching": filtered.distinct().count(),
        "report_completed": filtered.filter(state__group="completed").distinct().count(),
        "states": list(
            issues.values("state__name", "state__group").annotate(count=Count("id")).order_by("state__name")
        ),
    }
    metrics["report_completion_percent"] = (
        round(100 * metrics["report_completed"] / metrics["matching"], 2) if metrics["matching"] else 0
    )
    if report not in {"search", "customer"}:
        pages = pages.none()
    selection = filtered.distinct()
    if focus:
        selection = selection.annotate(
            _focus_root=Case(
                When(pk__in=focus["root_ids"], then=Literal(0)), default=Literal(1), output_field=IntegerField()
            )
        )
    selected = list(
        selection.select_related("project", "state")
        .prefetch_related("assignees", "labels")
        .order_by(*(["_focus_root", "target_date", "-updated_at"] if focus else ["target_date", "-updated_at"]))[:limit]
    )
    for issue in selected:
        ref = source(
            "issue",
            issue.id,
            f"{issue.project.identifier}-{issue.sequence_id} · {issue.name}",
            issue_url(access.workspace.slug, issue),
        )
        records.append(
            {
                **ref,
                "description": (issue.description_stripped or "")[:2200],
                "created_at": issue.created_at.isoformat(),
                "updated_at": issue.updated_at.isoformat(),
                "completed_at": issue.completed_at.isoformat() if issue.completed_at else None,
                "start_date": str(issue.start_date) if issue.start_date else None,
                "state": issue.state.name if issue.state else None,
                "priority": issue.priority,
                "due": str(issue.target_date) if issue.target_date else None,
                "parent_id": str(issue.parent_id) if issue.parent_id else None,
                "project_id": str(issue.project_id),
                "assignees": [{"id": str(u.id), "name": u.display_name} for u in issue.assignees.all()],
                "labels": [{"id": str(label.id), "name": label.name} for label in issue.labels.all()],
            }
        )
    ids = [i.id for i in selected]
    custom_values = values_for(selected)
    for record in records:
        record["custom_fields"] = custom_values.get(record["id"], {})
    comment_limit = 100 if focus else 20
    comment_query = access.comments().filter(issue_id__in=ids)
    comments = list(
        comment_query.order_by("-created_at").values(
            "id", "issue_id", "comment_stripped", "created_at", "actor_id", "actor__display_name"
        )[:comment_limit]
    )
    for comment in comments:
        comment["comment_stripped"] = comment["comment_stripped"][: 4000 if focus else 1500]
        issue = next(item for item in selected if item.id == comment["issue_id"])
        source("comment", comment["id"], "Comentário · " + issue.name, issue_url(access.workspace.slug, issue))
    activities = list(
        IssueActivity.objects.filter(issue_id__in=ids, project_id__in=projects.values("id"))
        .filter(**({} if focus else {"created_at__gte": since}))
        .order_by("-created_at")
        .values("issue_id", "field", "verb", "created_at")[:30]
    )
    relations = list(
        IssueRelation.objects.filter(issue_id__in=ids, related_issue_id__in=access.issues().values("id")).values(
            "issue_id", "related_issue_id", "relation_type"
        )[:30]
    )
    for relation in relations:
        related = access.issue(relation["related_issue_id"])
        source("issue", related.id, related.name, issue_url(access.workspace.slug, related))
    project_data = []
    for project in projects.order_by("name")[:20]:
        source("project", project.id, project.name, f"/{access.workspace.slug}/projects/{project.id}/issues/")
        project_data.append({"id": str(project.id), "name": project.name, "identifier": project.identifier})
    documents = []
    for page in pages.order_by("-updated_at")[:8]:
        project = projects.filter(
            pk__in=ProjectPage.objects.filter(page=page, deleted_at__isnull=True).values("project_id")
        ).first()
        if project:
            ref = source("page", page.id, page.name, page_url(access.workspace.slug, page, project.id))
            documents.append({**ref, "text": (page.description_stripped or "")[:3500]})
    pids = [p["id"] for p in project_data]
    # Counts may span more projects than the bounded text/lookup result set. Track every
    # contributing project's ACL so a later revocation also hides aggregate history.
    for project in projects.exclude(pk__in=pids).only("id", "name"):
        source("project", project.id, project.name, f"/{access.workspace.slug}/projects/{project.id}/issues/")
    lookup = {
        "custom_fields": list(
            Field.objects.filter(project_id__in=pids, active=True).values(
                "id", "name", "kind", "required", "options", "project_id"
            )[:100]
        ),
        "states": list(State.objects.filter(project_id__in=pids).values("id", "name", "project_id")[:80]),
        "people": list(
            ProjectMember.objects.filter(project_id__in=pids, is_active=True, role__gte=15).values(
                "member_id", "member__display_name", "project_id"
            )[:80]
        ),
        "labels": list(Label.objects.filter(project_id__in=pids).values("id", "name", "project_id")[:50]),
        "cycles": list(
            Cycle.objects.filter(project_id__in=pids).values("id", "name", "project_id", "start_date", "end_date")[:40]
        ),
        "modules": list(Module.objects.filter(project_id__in=pids).values("id", "name", "project_id")[:40]),
    }
    memories = list(
        access.memories()
        .filter(Q(project__isnull=True) | Q(project_id__in=pids))
        .order_by("created_at")
        .values("id", "kind", "text")[:12]
    )
    for memory in memories:
        source(
            "memory",
            memory["id"],
            "Memória · " + memory["kind"],
            f"/api/workspaces/{access.workspace.slug}/ai/memories/",
        )
    context = {
        "scope": scope,
        "report": report,
        "as_of": now.isoformat(),
        "timezone": str(zone),
        "period": {"from": since.isoformat(), "to": now.isoformat()},
        "metrics": metrics,
        "issues": records,
        "projects": project_data,
        "pages": documents,
        "comments": comments,
        "activities": activities,
        "relations": relations,
        "lookup": lookup,
        "memories": memories,
        "truncated": metrics["matching"] > len(records) or comment_query.count() > len(comments),
    }
    if focus:
        dates = [issue.created_at for issue in selected] + [comment["created_at"] for comment in comments]
        context["period"] = {"from": min(dates).isoformat() if dates else now.isoformat(), "to": now.isoformat()}
    return json.loads(json.dumps(context, default=str)), sources
