"""Use the stock issue grouper/DTO, including counts and relationships."""

from django.db.models import Count, OuterRef, Subquery, IntegerField, Value
from django.db.models.functions import Coalesce
from plane.db.models import Issue, CycleIssue, IssueLink, FileAsset, ProjectMember
from django.db.models import Exists, Q
from plane.utils.grouper import issue_queryset_grouper, issue_on_results


def authorized_issues(user_id, workspace_id):
    memberships = ProjectMember.objects.filter(
        workspace_id=workspace_id,
        member_id=user_id,
        is_active=True,
        role__in=[5, 15, 20],
        project_id=OuterRef("project_id"),
    )
    return (
        Issue.issue_objects.filter(workspace_id=workspace_id)
        .filter(Exists(memberships))
        .filter(
            Q(project__guest_view_all_features=True)
            | Q(created_by_id=user_id)
            | Q(Exists(memberships.filter(role__gte=15)))
        )
    )


def authorize_child_counts(query, user_id, workspace_id):
    children = authorized_issues(user_id, workspace_id).filter(parent_id=OuterRef("pk"))
    return query.annotate(
        sub_issues_count=Coalesce(
            Subquery(children.order_by().values("parent_id").annotate(n=Count("id")).values("n")[:1]),
            Value(0),
            output_field=IntegerField(),
        )
    )


def native_items(query, *, user_id=None, workspace_id=None):
    def count_rows(rows):
        return Coalesce(
            Subquery(rows.order_by().values("issue_id").annotate(n=Count("id")).values("n")[:1]),
            Value(0),
            output_field=IntegerField(),
        )

    query = query.annotate(
        cycle_id=Subquery(CycleIssue.objects.filter(issue_id=OuterRef("pk")).values("cycle_id")[:1]),
        sub_issues_count=Coalesce(
            Subquery(
                Issue.issue_objects.filter(parent_id=OuterRef("pk"))
                .order_by()
                .values("parent_id")
                .annotate(n=Count("id"))
                .values("n")[:1]
            ),
            Value(0),
            output_field=IntegerField(),
        ),
        link_count=count_rows(IssueLink.objects.filter(issue_id=OuterRef("pk"))),
        attachment_count=count_rows(
            FileAsset.objects.filter(issue_id=OuterRef("pk"), entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT)
        ),
    )
    if user_id is not None:
        query = authorize_child_counts(query, user_id, workspace_id)
    return issue_on_results(issue_queryset_grouper(query, None, None), None, None)
