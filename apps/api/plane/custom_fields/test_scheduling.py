from datetime import date, time
from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from plane.db.models import Issue, Project, ProjectMember, State, User, Workspace, WorkspaceMember
from plane.app.serializers import IssueDetailSerializer


@override_settings(ROOT_URLCONF="plane.ai.test_urls", WEB_URL="http://testserver", APP_BASE_URL="http://testserver")
class IssueSchedulingTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create(
            email="clock-admin@test.local", username="clock-admin", user_timezone="America/Sao_Paulo"
        )
        cls.member = User.objects.create(email="clock-member@test.local", username="clock-member", user_timezone="UTC")
        cls.guest = User.objects.create(email="clock-guest@test.local", username="clock-guest")
        cls.workspace = Workspace.objects.create(owner=cls.admin, name="Clock", slug="clock-tests")
        cls.project = Project.objects.create(workspace=cls.workspace, name="Clock", identifier="CLK")
        for user, role in [(cls.admin, 20), (cls.member, 15), (cls.guest, 5)]:
            WorkspaceMember.objects.create(workspace=cls.workspace, member=user, role=role)
            ProjectMember.objects.create(workspace=cls.workspace, project=cls.project, member=user, role=role)
        state = State.objects.create(
            workspace=cls.workspace, project=cls.project, name="Todo", group="unstarted", default=True
        )
        cls.issue = Issue.objects.create(
            workspace=cls.workspace,
            project=cls.project,
            state=state,
            name="Task with schedule",
            created_by=cls.admin,
            start_date=date(2026, 11, 10),
            target_date=date(2026, 11, 11),
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.url = f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/issues/{self.issue.id}/"
        for name in ["issue_activity", "model_activity", "issue_description_version_task", "recent_visited_task"]:
            mock = patch(f"plane.app.views.issue.base.{name}.delay")
            mock.start()
            self.addCleanup(mock.stop)

    def update(self, payload):
        return self.client.patch(self.url, payload, format="json")

    def test_optional_times_persist_without_shifting_native_dates(self):
        response = self.update({"start_time": "09:30", "target_time": "17:45"})
        self.assertEqual(response.status_code, 204, response.data)
        self.issue.refresh_from_db()
        self.assertEqual(self.issue.start_date, date(2026, 11, 10))
        self.assertEqual(self.issue.start_time, time(9, 30))
        self.assertEqual(self.issue.target_time, time(17, 45))
        self.assertEqual(self.issue.schedule_timezone, "America/Sao_Paulo")
        self.assertEqual(IssueDetailSerializer(self.issue).data["start_time"], "09:30:00")
        listed = self.client.get(self.url.removesuffix(f"{self.issue.id}/"), {"cursor": "100:0:0", "per_page": 100})
        self.assertEqual(listed.status_code, 200, listed.data)
        self.assertEqual(listed.json()["results"][0]["start_time"], "09:30:00")
        self.assertEqual(listed.json()["results"][0]["schedule_timezone"], "America/Sao_Paulo")

    def test_create_accepts_optional_times_and_uses_the_authors_timezone(self):
        response = self.client.post(
            self.url.removesuffix(f"{self.issue.id}/"),
            {
                "name": "New timed task",
                "start_date": "2026-11-10",
                "target_date": "2026-11-11",
                "start_time": "08:15",
                "target_time": "16:30",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        issue = Issue.objects.get(pk=response.data["id"])
        self.assertEqual(issue.start_time, time(8, 15))
        self.assertEqual(issue.target_time, time(16, 30))
        self.assertEqual(issue.schedule_timezone, "America/Sao_Paulo")

    def test_date_only_clients_and_removing_a_time_remain_supported(self):
        response = self.update({"target_date": "2026-11-12"})
        self.assertEqual(response.status_code, 204, response.data)
        self.issue.refresh_from_db()
        self.assertIsNone(self.issue.target_time)
        self.update({"target_time": "18:00"})
        self.assertEqual(self.update({"target_time": None}).status_code, 204)
        self.issue.refresh_from_db()
        self.assertEqual(self.issue.target_date, date(2026, 11, 12))
        self.assertIsNone(self.issue.target_time)

    def test_clearing_a_date_also_clears_its_time(self):
        self.update({"target_time": "18:00"})
        response = self.update({"target_date": None})
        self.assertEqual(response.status_code, 204, response.data)
        self.issue.refresh_from_db()
        self.assertIsNone(self.issue.target_date)
        self.assertIsNone(self.issue.target_time)

    def test_time_requires_a_date(self):
        Issue.objects.filter(pk=self.issue.pk).update(start_date=None)
        self.assertEqual(self.update({"start_time": "09:30"}).status_code, 400)

    def test_partial_updates_validate_the_full_schedule(self):
        Issue.objects.filter(pk=self.issue.pk).update(
            target_date=self.issue.start_date, start_time=time(14), target_time=time(15), schedule_timezone="UTC"
        )
        self.assertEqual(self.update({"target_time": "13:00"}).status_code, 400)
        self.assertEqual(self.update({"target_date": "2026-11-09"}).status_code, 400)

    def test_invalid_timezone_and_nonexistent_dst_time_are_rejected(self):
        self.assertEqual(self.update({"start_time": "09:00", "schedule_timezone": "invalid/zone"}).status_code, 400)
        response = self.update(
            {
                "start_date": "2026-03-08",
                "target_date": None,
                "start_time": "02:30",
                "schedule_timezone": "America/New_York",
            }
        )
        self.assertEqual(response.status_code, 400, response.data)

    def test_other_members_preserve_the_task_timezone(self):
        self.update({"start_time": "09:00"})
        self.client.force_authenticate(self.member)
        self.assertEqual(self.update({"target_time": "18:00"}).status_code, 204)
        self.issue.refresh_from_db()
        self.assertEqual(self.issue.schedule_timezone, "America/Sao_Paulo")

    def test_guest_cannot_edit_the_schedule(self):
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.update({"start_time": "09:00"}).status_code, 403)
