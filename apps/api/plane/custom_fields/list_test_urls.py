"""Real native endpoints used by isolated integration tests (no mocked issue responses)."""

from django.urls import path
from plane.app.views.issue.base import IssueViewSet
from plane.app.views.module.issue import ModuleIssueViewSet
from plane.app.views.cycle.issue import CycleIssueViewSet
from plane.app.views.view.base import WorkspaceViewIssuesViewSet

urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/",
        IssueViewSet.as_view({"get": "list", "post": "create"}),
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:pk>/",
        IssueViewSet.as_view({"patch": "partial_update"}),
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/issues/",
        ModuleIssueViewSet.as_view({"get": "list"}),
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/cycle-issues/",
        CycleIssueViewSet.as_view({"get": "list"}),
    ),
    path("workspaces/<str:slug>/issues/", WorkspaceViewIssuesViewSet.as_view({"get": "list"})),
]
