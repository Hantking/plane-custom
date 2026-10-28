# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Report integration tests use real API-key authentication and database ACLs."""

from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase, override_settings
from django.urls import resolve
from django.utils import timezone
from rest_framework.test import APIClient

from plane.api.views.report_read import ReportReadEndpoint
from plane.custom_fields.models import Field, Value
from plane.db.models import APIToken, Issue, Page, Project, ProjectMember, ProjectPage, State, User, Workspace, WorkspaceMember


@override_settings(ROOT_URLCONF="plane.api.test_report_urls", ALLOWED_HOSTS=["testserver"])
class ReportReadAPITests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create(username="reports-member", email="member@reports.test", is_active=True)
        cls.other = User.objects.create(username="reports-other", email="other@reports.test", is_active=True)
        cls.workspace = Workspace.objects.create(name="Report test", slug="report-test", owner=cls.user)
        cls.workspace_member = WorkspaceMember.objects.create(workspace=cls.workspace, member=cls.user, role=15)
        cls.project = Project.objects.create(name="Report project", identifier="REP", workspace=cls.workspace)
        cls.member = ProjectMember.objects.create(project=cls.project, workspace=cls.workspace, member=cls.user, role=15)
        cls.other_project = Project.objects.create(name="Other project", identifier="OTH", workspace=cls.workspace)
        cls.state = State.objects.create(project=cls.project, workspace=cls.workspace, name="Todo", group="unstarted", default=True)
        cls.other_state = State.objects.create(project=cls.other_project, workspace=cls.workspace, name="Todo", group="unstarted", default=True)
        cls.page = Page.objects.create(workspace=cls.workspace, owned_by=cls.other, access=0, name="Report page", description_html="<p>Readable content</p>")
        cls.link = ProjectPage.objects.create(workspace=cls.workspace, project=cls.project, page=cls.page)
        cls.token = APIToken.objects.create(user=cls.user)

    def setUp(self):
        # The existing API suite covers throttling; isolate only the shared rate
        # limiter so these permission tests do not exhaust a token's 60/min quota.
        throttle = patch.object(ReportReadEndpoint, "get_throttles", return_value=[])
        throttle.start()
        self.addCleanup(throttle.stop)
        self.client = APIClient()
        self.client.credentials(HTTP_X_API_KEY=self.token.token)
        self.root = f"/api/v1/workspaces/{self.workspace.slug}/projects/{self.project.id}/"
        self.page_url = self.root + f"pages/{self.page.id}/"

    def create_page(self, name, *, owner=None, access=0, project=None, parent=None):
        page = Page.objects.create(workspace=self.workspace, owned_by=owner or self.user, access=access, name=name, parent=parent)
        ProjectPage.objects.create(workspace=self.workspace, project=project or self.project, page=page)
        return page

    def make_guest(self):
        ProjectMember.objects.filter(pk=self.member.pk).update(role=5)
        WorkspaceMember.objects.filter(pk=self.workspace_member.pk).update(role=5)

    def test_detail_route_reads_page_with_api_key_without_session(self):
        self.assertEqual(resolve(self.page_url).url_name, "report-page-read")
        response = self.client.get(self.page_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["description_html"], "<p>Readable content</p>")
        self.assertEqual(response.data["url"], f"http://testserver/{self.workspace.slug}/projects/{self.project.id}/pages/{self.page.id}/")
        self.assertNotIn("description_binary", response.data)

    def test_list_route_returns_paginated_links_without_page_contents(self):
        self.assertEqual(resolve(self.root + "pages/").url_name, "report-pages-read")
        response = self.client.get(self.root + "pages/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        page = response.data["results"][0]
        self.assertEqual(page["id"], str(self.page.id))
        self.assertEqual(page["url"], f"http://testserver/{self.workspace.slug}/projects/{self.project.id}/pages/{self.page.id}/")
        self.assertNotIn("description_html", page)

    def test_list_does_not_leak_private_foreign_removed_or_child_pages(self):
        self.create_page("Private", owner=self.other, access=1)
        self.create_page("Other project", project=self.other_project)
        self.create_page("Child", parent=self.page)
        removed = self.create_page("Removed")
        ProjectPage.objects.filter(page=removed, project=self.project).delete()
        response = self.client.get(self.root + "pages/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([page["id"] for page in response.data["results"]], [str(self.page.id)])

    def test_list_pagination_returns_each_page_once(self):
        for index in range(3):
            self.create_page(f"Page {index}")
        first = self.client.get(self.root + "pages/", {"per_page": 2})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(len(first.data["results"]), 2)
        self.assertTrue(first.data["next_page_results"])
        second = self.client.get(self.root + "pages/", {"per_page": 2, "cursor": first.data["next_cursor"]})
        self.assertEqual(second.status_code, 200)
        ids = [page["id"] for page in first.data["results"] + second.data["results"]]
        self.assertEqual(len(ids), 4)
        self.assertEqual(len(set(ids)), 4)
        self.assertFalse(second.data["next_page_results"])

    def test_missing_key_is_rejected_for_all_report_routes(self):
        self.client.credentials()
        for path in (self.page_url, self.root + "pages/", self.root + "custom-fields/", self.root + "custom-fields/values/"):
            with self.subTest(path=path):
                self.assertIn(self.client.get(path).status_code, (401, 403))

    def test_session_alone_cannot_access_public_api(self):
        self.client.credentials()
        self.client.force_login(self.user)
        self.assertIn(self.client.get(self.page_url).status_code, (401, 403))

    def test_invalid_key_is_rejected(self):
        self.client.credentials(HTTP_X_API_KEY="invalid-key-not-in-database")
        self.assertIn(self.client.get(self.page_url).status_code, (401, 403))

    def test_inactive_key_is_rejected(self):
        APIToken.objects.filter(pk=self.token.pk).update(is_active=False)
        self.assertIn(self.client.get(self.page_url).status_code, (401, 403))

    def test_expired_key_is_rejected(self):
        APIToken.objects.filter(pk=self.token.pk).update(expired_at=timezone.now() - timedelta(seconds=1))
        self.assertIn(self.client.get(self.page_url).status_code, (401, 403))

    def test_inactive_user_is_rejected(self):
        User.objects.filter(pk=self.user.pk).update(is_active=False)
        self.assertIn(self.client.get(self.page_url).status_code, (401, 403))

    def test_private_page_is_owner_only(self):
        Page.objects.filter(pk=self.page.pk).update(access=1)
        self.assertIn(self.client.get(self.page_url).status_code, (403, 404))
        Page.objects.filter(pk=self.page.pk).update(owned_by=self.user)
        self.assertEqual(self.client.get(self.page_url).status_code, 200)

    def test_page_cannot_be_accessed_via_another_project(self):
        url = self.page_url.replace(str(self.project.id), str(self.other_project.id))
        self.assertIn(self.client.get(url).status_code, (403, 404))

    def test_page_cannot_be_accessed_via_another_workspace(self):
        url = self.page_url.replace(self.workspace.slug, "other-workspace")
        self.assertIn(self.client.get(url).status_code, (403, 404))

    def test_removed_project_page_link_is_rejected(self):
        ProjectPage.objects.filter(pk=self.link.pk).delete()
        self.assertIn(self.client.get(self.page_url).status_code, (403, 404))

    def test_deleted_page_is_rejected(self):
        Page.objects.filter(pk=self.page.pk).delete()
        self.assertIn(self.client.get(self.page_url).status_code, (403, 404))

    def test_inactive_project_member_is_rejected(self):
        ProjectMember.objects.filter(pk=self.member.pk).update(is_active=False)
        self.assertIn(self.client.get(self.page_url).status_code, (403, 404))

    def test_inactive_workspace_member_is_rejected(self):
        WorkspaceMember.objects.filter(pk=self.workspace_member.pk).update(is_active=False)
        self.assertIn(self.client.get(self.page_url).status_code, (403, 404))

    def test_archived_project_is_rejected(self):
        Project.objects.filter(pk=self.project.pk).update(archived_at=timezone.now())
        self.assertIn(self.client.get(self.page_url).status_code, (403, 404))

    def test_guest_without_general_feature_access_reads_only_owned_pages(self):
        self.make_guest()
        owned = self.create_page("Guest page")
        self.assertIn(self.client.get(self.page_url).status_code, (403, 404))
        self.assertEqual(self.client.get(self.root + f"pages/{owned.id}/").status_code, 200)
        response = self.client.get(self.root + "pages/")
        self.assertEqual([page["id"] for page in response.data["results"]], [str(owned.id)])

    def test_guest_with_general_feature_access_reads_public_pages(self):
        self.make_guest()
        Project.objects.filter(pk=self.project.pk).update(guest_view_all_features=True)
        self.assertEqual(self.client.get(self.page_url).status_code, 200)

    def test_report_routes_reject_all_writes(self):
        ProjectMember.objects.filter(pk=self.member.pk).update(role=20)
        for path in (self.page_url, self.root + "pages/", self.root + "custom-fields/", self.root + "custom-fields/values/"):
            for method in ("post", "put", "patch", "delete"):
                with self.subTest(path=path, method=method):
                    self.assertEqual(getattr(self.client, method)(path, {}, format="json").status_code, 405)

    def test_custom_fields_route_uses_native_definitions(self):
        field = Field.objects.create(project=self.project, name="Confirmed", kind="boolean")
        Field.objects.create(project=self.other_project, name="Foreign", kind="text")
        self.assertEqual(resolve(self.root + "custom-fields/").url_name, "report-fields-read")
        response = self.client.get(self.root + "custom-fields/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([str(item["id"]) for item in response.data["fields"]], [str(field.id)])

    def test_custom_values_keep_zero_false_project_and_guest_scope(self):
        own = Issue(project=self.project, workspace=self.workspace, state=self.state, name="Owned", created_by=self.user)
        own.save(disable_auto_set_user=True)
        other = Issue(project=self.project, workspace=self.workspace, state=self.state, name="Other", created_by=self.other)
        other.save(disable_auto_set_user=True)
        foreign = Issue(project=self.other_project, workspace=self.workspace, state=self.other_state, name="Foreign", created_by=self.user)
        foreign.save(disable_auto_set_user=True)
        number = Field.objects.create(project=self.project, name="Zero", kind="number")
        boolean = Field.objects.create(project=self.project, name="False", kind="boolean")
        Value.objects.create(issue=own, field=number, number_value=0)
        Value.objects.create(issue=own, field=boolean, boolean_value=False)
        Value.objects.create(issue=other, field=number, number_value=1)
        self.make_guest()
        url = self.root + "custom-fields/values/"
        self.assertEqual(resolve(url).url_name, "report-field-values-read")
        response = self.client.get(url, {"ids": f"{own.pk},{other.pk},{foreign.pk}"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.data), {str(own.pk)})
        self.assertEqual(response.data[str(own.pk)][str(number.pk)], "0.000000")
        self.assertIs(response.data[str(own.pk)][str(boolean.pk)], False)

    def test_custom_values_reject_malformed_ids(self):
        response = self.client.get(self.root + "custom-fields/values/", {"ids": "not-a-uuid"})
        self.assertEqual(response.status_code, 400)

    def test_custom_values_reject_more_than_one_hundred_ids(self):
        response = self.client.get(self.root + "custom-fields/values/", {"ids": ",".join(str(uuid4()) for _ in range(101))})
        self.assertEqual(response.status_code, 400)
