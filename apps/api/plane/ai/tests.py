import json
import os
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4
from cryptography.fernet import Fernet
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework.exceptions import PermissionDenied, ValidationError
from plane.db.models import User, Workspace, WorkspaceMember, Project, ProjectMember, State, Issue, Page, ProjectPage
from .models import Policy, Connection, Conversation, Run, Action, Memory, Automation
from .security import Access, decrypt, provider_address
from .providers import ChatCompletions, ProviderError
from .context import retrieve
from .orchestrator import run_generation
from .tools import execute, validate


class PlaneAITests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create(
            email="ai-admin@test.local", username="ai-admin", user_timezone="America/Sao_Paulo"
        )
        cls.member = User.objects.create(email="ai-member@test.local", username="ai-member")
        cls.outsider = User.objects.create(email="ai-outsider@test.local", username="ai-outsider")
        cls.guest = User.objects.create(email="ai-guest@test.local", username="ai-guest")
        cls.workspace = Workspace.objects.create(owner=cls.admin, name="AI", slug="ai-tests")
        cls.project = Project.objects.create(workspace=cls.workspace, name="Main", identifier="AI")
        cls.private = Project.objects.create(workspace=cls.workspace, name="Secret", identifier="SEC")
        for user, role in [(cls.admin, 20), (cls.member, 15), (cls.guest, 5)]:
            WorkspaceMember.objects.create(workspace=cls.workspace, member=user, role=role)
            ProjectMember.objects.create(workspace=cls.workspace, project=cls.project, member=user, role=role)
        cls.state = State.objects.create(
            workspace=cls.workspace, project=cls.project, name="Todo", group="unstarted", default=True
        )
        cls.done = State.objects.create(workspace=cls.workspace, project=cls.project, name="Done", group="completed")
        cls.issue = Issue.objects.create(
            workspace=cls.workspace,
            project=cls.project,
            name="Overdue real task",
            state=cls.state,
            target_date=timezone.now().date() - timedelta(days=3),
            created_by=cls.admin,
        )
        Issue.objects.create(workspace=cls.workspace, project=cls.private, name="Do not disclose")
        Issue.objects.create(
            workspace=cls.workspace,
            project=cls.project,
            name="Finished",
            state=cls.done,
            target_date=timezone.now().date() - timedelta(days=3),
        )
        cls.policy = Policy.objects.create(workspace=cls.workspace, enabled=True)
        cls.connection = Connection.objects.create(
            workspace=cls.workspace,
            name="Compatible",
            base_url="https://provider.invalid/v1",
            allowed_roles=[15, 20],
            context_tokens=32000,
            default_model="first",
            models=[
                {
                    "id": "first",
                    "capabilities": {
                        "streaming": False,
                        "tools": True,
                        "system": True,
                        "structured": False,
                        "embeddings": False,
                        "multimodal": False,
                    },
                },
                {
                    "id": "second",
                    "capabilities": {
                        "streaming": False,
                        "tools": False,
                        "system": False,
                        "structured": False,
                        "embeddings": False,
                        "multimodal": False,
                    },
                    "output_parameter": "none",
                },
            ],
        )

    def setUp(self):
        self.env = patch.dict(
            os.environ,
            {
                "PLANE_AI_ENABLED": "1",
                "PLANE_AI_ENCRYPTION_KEY": Fernet.generate_key().decode(),
                "PLANE_AI_ALLOWED_HOSTS": "provider.invalid",
            },
        )
        self.env.start()
        self.addCleanup(self.env.stop)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.path = "/api/workspaces/ai-tests/ai/"
        self.access = Access(self.admin, self.workspace.slug)

    def new_run(self, prompt="Quais tarefas estão atrasadas?", model="first", allow_actions=False):
        conversation = Conversation.objects.create(
            workspace=self.workspace, owner=self.admin, scope={"kind": "project", "id": str(self.project.id)}
        )
        return Run.objects.create(
            workspace=self.workspace,
            conversation=conversation,
            connection=self.connection,
            model=model,
            prompt=prompt,
            request_key=uuid4(),
            allow_actions=allow_actions,
        )

    def action(self, operation, arguments, run=None, ordinal=1):
        return Action.objects.create(
            workspace=self.workspace,
            run=run or self.new_run(allow_actions=True),
            ordinal=ordinal,
            operation=operation,
            arguments={"project_id": str(self.project.id), **arguments},
        )

    def test_metrics_links_and_timezone_come_from_real_authorized_rows(self):
        context, sources = retrieve(self.access, {"kind": "project", "id": str(self.project.id)}, report="overdue")
        self.assertEqual(context["metrics"]["overdue"], 1)
        self.assertEqual(context["metrics"]["matching"], 1)
        self.assertEqual(context["timezone"], "America/Sao_Paulo")
        self.assertEqual(context["issues"][0]["id"], str(self.issue.id))
        self.assertIn(str(self.issue.id), context["issues"][0]["url"])
        self.assertNotIn("Do not disclose", json.dumps(context))

    def test_private_pages_and_foreign_projects_are_not_sent(self):
        page = Page.objects.create(workspace=self.workspace, owned_by=self.member, name="Private decision", access=1)
        ProjectPage.objects.create(workspace=self.workspace, project=self.project, page=page)
        context, _ = retrieve(self.access, {"kind": "workspace"})
        self.assertNotIn("Private decision", json.dumps(context))
        with self.assertRaises(Exception):
            self.access.project(self.private.id)

    def test_admin_configuration_encrypts_and_never_returns_credential(self):
        data = {
            "name": "Manual",
            "base_url": "https://provider.invalid/v1",
            "api_key": "secret-not-for-browser",
            "default_model": "manual",
            "models": [{"id": "manual", "capabilities": {"tools": False}}],
            "allowed_roles": [15, 20],
        }
        with patch("plane.ai.security.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("8.8.8.8", 443))]):
            response = self.client.post(self.path + "connections/", data, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertNotIn("secret-not-for-browser", json.dumps(response.data))
        self.assertNotIn("api_key", response.data)
        connection = Connection.objects.get(id=response.data["id"])
        self.assertNotEqual(connection.encrypted_key, data["api_key"])
        self.assertEqual(decrypt(connection.encrypted_key), data["api_key"])
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.get(self.path + "connections/").status_code, 403)

    def test_models_only_receive_declared_parameters(self):
        provider = ChatCompletions(self.connection)
        messages = [{"role": "system", "content": "Rules"}, {"role": "user", "content": "Hi"}]
        payload = provider.payload("second", messages, [{"type": "function"}])
        self.assertNotIn("tools", payload)
        self.assertNotIn("stream", payload)
        self.assertNotIn("max_tokens", payload)
        self.assertEqual(payload["messages"][0]["role"], "user")
        self.assertEqual(messages[0]["role"], "system")
        first = provider.payload("first", messages, [{"type": "function"}])
        self.assertIn("tools", first)
        self.assertEqual(first["model"], "first")
        with self.assertRaises(ValidationError):
            provider.payload("unlisted", messages)

    def test_create_update_and_retry_have_real_effect_once(self):
        action = self.action(
            "create_issue", {"name": "Created by AI", "text": "Acceptance criteria", "priority": "high"}
        )
        first = execute(self.access, action)
        second = execute(self.access, action)
        self.assertEqual(first, second)
        self.assertEqual(Issue.objects.filter(name="Created by AI").count(), 1)
        update = self.action("update_issue", {"issue_id": first["id"], "name": "Edited by AI", "priority": "urgent"})
        execute(self.access, update)
        self.assertEqual(Issue.objects.get(pk=first["id"]).name, "Edited by AI")

    def test_guest_cannot_write_or_read_someone_elses_task(self):
        access = Access(self.guest, self.workspace.slug)
        self.assertFalse(access.issues().filter(pk=self.issue.id).exists())
        with self.assertRaises(PermissionDenied):
            execute(access, self.action("create_issue", {"name": "Forbidden"}))

    def test_foreign_references_and_invalid_rules_fail_before_writes(self):
        with self.assertRaises(ValidationError):
            validate(
                self.access,
                {"kind": "workspace"},
                "update_issue",
                {
                    "project_id": str(self.project.id),
                    "issue_id": str(self.issue.id),
                    "assignee_ids": [str(self.outsider.id)],
                },
            )
        with self.assertRaises(ValidationError):
            validate(
                self.access,
                {"kind": "workspace"},
                "create_issue",
                {
                    "project_id": str(self.project.id),
                    "name": "Bad dates",
                    "start_date": "2026-12-02",
                    "target_date": "2026-12-01",
                },
            )
        with self.assertRaises(ValidationError):
            validate(self.access, {"kind": "workspace"}, "sql", {"project_id": str(self.project.id)})

    def test_model_switch_without_code_and_failed_provider_does_not_fallback(self):
        for model in ["first", "second"]:
            run = self.new_run(model=model)
            with patch.object(
                ChatCompletions,
                "complete",
                return_value=({"role": "assistant", "content": "There is 1 overdue task."}, {"total_tokens": 20}),
            ) as complete:
                run_generation(run.id)
                self.assertEqual(complete.call_args.args[0], model)
            run.refresh_from_db()
            self.assertEqual(run.status, "completed", run.error)
        failed = self.new_run()
        with patch.object(ChatCompletions, "complete", side_effect=ProviderError("Credencial recusada")) as complete:
            run_generation(failed.id)
            self.assertEqual(complete.call_count, 1)
        failed.refresh_from_db()
        self.assertEqual(failed.status, "failed")

    def test_tool_call_creates_real_task_and_result_is_returned_to_model(self):
        run = self.new_run("Crie uma tarefa", allow_actions=True)
        call = {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call-1",
                    "type": "function",
                    "function": {
                        "name": "plane_action",
                        "arguments": json.dumps(
                            {
                                "operation": "create_issue",
                                "arguments": {"project_id": str(self.project.id), "name": "Via model tool"},
                            }
                        ),
                    },
                }
            ],
        }
        with patch.object(
            ChatCompletions, "complete", side_effect=[(call, {}), ({"role": "assistant", "content": "Criada."}, {})]
        ):
            run_generation(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "completed", run.error)
        self.assertTrue(Issue.objects.filter(name="Via model tool").exists())
        self.assertEqual(run.actions.get().status, "done")

    def test_bulk_proposal_requires_confirmation(self):
        run = self.new_run("Crie duas tarefas", allow_actions=True)
        calls = [
            {
                "id": str(index),
                "type": "function",
                "function": {
                    "name": "plane_action",
                    "arguments": json.dumps(
                        {
                            "operation": "create_issue",
                            "arguments": {"project_id": str(self.project.id), "name": f"Bulk {index}"},
                        }
                    ),
                },
            }
            for index in range(2)
        ]
        with patch.object(
            ChatCompletions, "complete", return_value=({"role": "assistant", "content": "", "tool_calls": calls}, {})
        ):
            run_generation(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "awaiting_confirmation", run.error)
        self.assertFalse(Issue.objects.filter(name__startswith="Bulk").exists())
        response = self.client.post(self.path + f"runs/{run.id}/approve/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Issue.objects.filter(name__startswith="Bulk").count(), 2)
        repeated = self.client.post(self.path + f"runs/{run.id}/approve/", {}, format="json")
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(Issue.objects.filter(name__startswith="Bulk").count(), 2)

    def test_conversation_is_private_and_revocation_hides_previous_answers(self):
        run = self.new_run()
        run.sources = [{"kind": "issue", "id": str(self.issue.id)}]
        run.response = "Sensitive answer"
        run.status = "completed"
        run.save()
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.get(self.path + f"conversations/{run.conversation_id}/").status_code, 404)
        self.client.force_authenticate(self.admin)
        ProjectMember.objects.filter(project=self.project, member=self.admin).update(is_active=False)
        self.assertIn(self.client.get(self.path + f"runs/{run.id}/").status_code, [403, 404])

    def test_request_key_deduplicates_and_daily_quota_is_enforced(self):
        run = self.new_run()
        payload = {
            "conversation_id": str(run.conversation_id),
            "connection_id": str(self.connection.id),
            "model": "first",
            "prompt": run.prompt,
            "request_key": str(run.request_key),
        }
        self.assertEqual(self.client.post(self.path + "runs/", payload, format="json").data["id"], str(run.id))
        self.policy.user_daily_limit = 1
        self.policy.save()
        payload["request_key"] = str(uuid4())
        self.assertEqual(self.client.post(self.path + "runs/", payload, format="json").status_code, 429)

    def test_ssrf_blocks_metadata_private_and_unlisted_hosts(self):
        with self.assertRaises(ValidationError):
            provider_address("https://unlisted.invalid/v1")
        for ip in ["127.0.0.1", "169.254.169.254", "10.0.0.1", "::1"]:
            with patch("plane.ai.security.socket.getaddrinfo", return_value=[(2, 1, 6, "", (ip, 443))]):
                with self.assertRaises(ValidationError):
                    provider_address("https://provider.invalid/v1")

    def test_personal_memories_are_not_shared(self):
        Memory.objects.create(workspace=self.workspace, owner=self.member, kind="personal", text="Private preference")
        context, _ = retrieve(self.access, {"kind": "workspace"})
        self.assertNotIn("Private preference", json.dumps(context))

    def test_disabled_feature_rejects_requests_and_non_tools_cannot_execute(self):
        with patch.dict(os.environ, {"PLANE_AI_ENABLED": "0"}):
            self.assertEqual(self.client.get(self.path + "conversations/").status_code, 403)
        run = self.new_run(model="second")
        payload = {
            "conversation_id": str(run.conversation_id),
            "connection_id": str(self.connection.id),
            "model": "second",
            "prompt": "Do it",
            "request_key": str(uuid4()),
            "allow_actions": True,
        }
        self.assertEqual(self.client.post(self.path + "runs/", payload, format="json").status_code, 400)

    def test_comments_labels_cycle_module_relations_and_pages_are_real(self):
        from plane.db.models import Label, Cycle, Module, IssueComment, IssueRelation, CycleIssue, ModuleIssue

        label = Label.objects.create(workspace=self.workspace, project=self.project, name="AI label")
        cycle = Cycle.objects.create(workspace=self.workspace, project=self.project, name="Cycle", owned_by=self.admin)
        module = Module.objects.create(workspace=self.workspace, project=self.project, name="Module")
        sibling = Issue.objects.create(workspace=self.workspace, project=self.project, name="Dependency")
        for operation, data in [
            ("add_comment", {"text": "Real comment"}),
            ("add_labels", {"label_ids": [str(label.id)]}),
            ("set_cycle", {"cycle_id": str(cycle.id)}),
            ("add_module", {"module_id": str(module.id)}),
            ("relate_issues", {"related_issue_id": str(sibling.id), "relation_type": "blocked_by"}),
        ]:
            execute(self.access, self.action(operation, {"issue_id": str(self.issue.id), **data}))
        self.assertTrue(IssueComment.objects.filter(issue=self.issue, comment_stripped="Real comment").exists())
        self.assertTrue(self.issue.labels.filter(pk=label.id).exists())
        self.assertTrue(CycleIssue.objects.filter(issue=self.issue, cycle=cycle).exists())
        self.assertTrue(ModuleIssue.objects.filter(issue=self.issue, module=module).exists())
        self.assertTrue(IssueRelation.objects.filter(issue=self.issue, related_issue=sibling).exists())
        result = execute(self.access, self.action("create_page", {"name": "Decision", "text": "Written by AI"}))
        self.assertTrue(Page.objects.filter(pk=result["id"], description_stripped="Written by AI").exists())
        execute(self.access, self.action("update_page", {"page_id": result["id"], "text": "Revised"}))
        self.assertEqual(Page.objects.get(pk=result["id"]).description_stripped, "Revised")

    def test_subtask_creation_and_issue_scope_cannot_escape(self):
        run = self.new_run(allow_actions=True)
        run.conversation.scope = {"kind": "issue", "id": str(self.issue.id)}
        run.conversation.save()
        action = self.action("create_issue", {"name": "Child", "parent_id": str(self.issue.id)}, run)
        result = execute(self.access, action)
        self.assertEqual(Issue.objects.get(pk=result["id"]).parent_id, self.issue.id)
        with self.assertRaises(PermissionDenied):
            execute(self.access, self.action("create_issue", {"name": "Outside scope"}, run, 2))

    def test_automation_schedule_limits_history_and_revocation(self):
        from .tasks import schedule

        automation = Automation.objects.create(
            workspace=self.workspace,
            owner=self.admin,
            connection=self.connection,
            model="first",
            name="Progress",
            instruction="Resuma o progresso",
            scope={"kind": "project", "id": str(self.project.id)},
            next_run_at=timezone.now() - timedelta(minutes=1),
            max_runs=1,
        )
        with patch("plane.ai.views.dispatch_run"):
            schedule()
        automation.refresh_from_db()
        self.assertEqual(automation.execution_count, 1)
        self.assertIsNotNone(automation.last_run_id)
        self.assertEqual(automation.last_run.conversation.owner_id, self.admin.id)
        automation.next_run_at = timezone.now() - timedelta(minutes=1)
        automation.save()
        schedule()
        automation.refresh_from_db()
        self.assertFalse(automation.enabled)

    def test_automatic_writes_need_admin_policy_and_enforce_fields(self):
        payload = {
            "name": "Classify",
            "instruction": "Priorize",
            "connection": str(self.connection.id),
            "model": "first",
            "scope": {"kind": "project", "id": str(self.project.id)},
            "action_policy": "limited_writes",
        }
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.post(self.path + "automations/", payload, format="json").status_code, 403)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(self.path + "automations/", payload, format="json").status_code, 201)
        run = self.new_run(allow_actions=True)
        run.automation_policy = {
            "operations": ["update_issue", "add_comment"],
            "fields": ["priority", "state_id", "assignee_ids"],
            "max_actions": 1,
        }
        run.save()
        with self.assertRaises(PermissionDenied):
            execute(
                self.access, self.action("update_issue", {"issue_id": str(self.issue.id), "name": "Not permitted"}, run)
            )
        execute(
            self.access, self.action("update_issue", {"issue_id": str(self.issue.id), "priority": "urgent"}, run, 2)
        )
        with self.assertRaises(PermissionDenied):
            execute(
                self.access,
                self.action("add_comment", {"issue_id": str(self.issue.id), "text": "Second write"}, run, 3),
            )

    def test_retry_after_committed_write_never_calls_provider_again(self):
        run = self.new_run(allow_actions=True)
        execute(self.access, self.action("create_issue", {"name": "Before failure"}, run))
        run.status = "failed"
        run.save()
        with patch("plane.ai.views.dispatch_run") as dispatch:
            response = self.client.post(self.path + f"runs/{run.id}/retry/", {}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(dispatch.called)
        self.assertEqual(Issue.objects.filter(name="Before failure").count(), 1)

    def test_cancelling_running_generation_cannot_be_retried_concurrently(self):
        run = self.new_run()
        run.status = "running"
        run.save()
        response = self.client.post(self.path + f"runs/{run.id}/cancel/", {}, format="json")
        self.assertEqual(response.data["status"], "cancelling")
        self.assertEqual(self.client.post(self.path + f"runs/{run.id}/retry/", {}, format="json").status_code, 400)

    def test_empty_search_reports_absent_evidence_and_no_invented_records(self):
        context, sources = retrieve(
            self.access, {"kind": "project", "id": str(self.project.id)}, "unfindable-decision-xyz"
        )
        self.assertEqual(context["metrics"]["matching"], 0)
        self.assertEqual(context["issues"], [])
        self.assertEqual(context["pages"], [])

    def test_missing_ids_and_unknown_fields_are_rejected(self):
        self.assertEqual(
            self.client.post(self.path + "runs/", {"conversation_id": "not-uuid"}, format="json").status_code, 400
        )
        with self.assertRaises(ValidationError):
            execute(self.access, self.action("update_issue", {"issue_id": str(self.issue.id)}))

    def test_no_report_evidence_returns_factual_backend_answer_without_inference(self):
        Issue.objects.filter(pk=self.issue.pk).update(target_date=None)
        run = self.new_run()
        with patch.object(ChatCompletions, "complete") as provider:
            run_generation(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "completed", run.error)
        self.assertIn("Não encontrei", run.response)
        self.assertFalse(provider.called)

    def test_source_access_and_configuration_are_revalidated_after_provider_returns(self):
        run = self.new_run("Crie uma tarefa", allow_actions=True)
        call = {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call",
                    "type": "function",
                    "function": {
                        "name": "plane_action",
                        "arguments": json.dumps(
                            {
                                "operation": "create_issue",
                                "arguments": {"project_id": str(self.project.id), "name": "Must not exist"},
                            }
                        ),
                    },
                }
            ],
        }

        def revoke(*args, **kwargs):
            Connection.objects.filter(pk=self.connection.pk).update(enabled=False)
            return call, {}

        with patch.object(ChatCompletions, "complete", side_effect=revoke):
            run_generation(run.id)
        run.refresh_from_db()
        self.assertEqual(run.status, "failed")
        self.assertFalse(Issue.objects.filter(name="Must not exist").exists())

    def test_removed_page_association_does_not_leak_via_another_active_link(self):
        page = Page.objects.create(workspace=self.workspace, owned_by=self.member, name="Removed decision")
        link = ProjectPage.objects.create(workspace=self.workspace, project=self.project, page=page)
        ProjectPage.objects.create(workspace=self.workspace, project=self.private, page=page)
        link.delete()
        self.assertFalse(self.access.pages().filter(pk=page.id).exists())

    def test_sse_uses_async_iterator_for_planes_asgi_server(self):
        run = self.new_run()
        run.status = "completed"
        run.save()
        response = self.client.get(self.path + f"runs/{run.id}/events/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.is_async)
        self.assertEqual(response["Cache-Control"], "no-store")

    def test_idempotent_result_also_requires_owner_authorization(self):
        action = self.action("create_issue", {"name": "Owner only"})
        execute(self.access, action)
        with self.assertRaises(PermissionDenied):
            execute(Access(self.member, self.workspace.slug), action)

    def test_required_hentis_fields_are_validated_and_saved_atomically(self):
        from plane.custom_fields.models import Field
        from plane.custom_fields.services import values_for

        field = Field.objects.create(project=self.project, name="Customer", kind="text", required=True)
        with self.assertRaises(ValidationError):
            execute(self.access, self.action("create_issue", {"name": "Missing required value"}))
        result = execute(
            self.access,
            self.action(
                "create_issue", {"name": "With required value", "custom_fields": {str(field.id): "Real customer"}}
            ),
        )
        issue = Issue.objects.get(pk=result["id"])
        self.assertEqual(values_for([issue])[str(issue.id)][str(field.id)], "Real customer")

    def test_cross_workspace_ids_do_not_grant_access(self):
        other = Workspace.objects.create(owner=self.admin, name="Other tenant", slug="ai-other")
        WorkspaceMember.objects.create(workspace=other, member=self.admin, role=20)
        run = self.new_run()
        path = "/api/workspaces/ai-other/ai/"
        self.assertEqual(self.client.get(path + f"connections/{self.connection.id}/").status_code, 404)
        self.assertEqual(self.client.get(path + f"runs/{run.id}/").status_code, 404)

    def test_ambiguous_people_require_explicit_real_id(self):
        User.objects.filter(pk__in=[self.admin.id, self.member.id]).update(display_name="Alex")
        action = self.action("update_issue", {"issue_id": str(self.issue.id), "assignee_ids": [str(self.member.id)]})
        with self.assertRaises(ValidationError):
            execute(self.access, action)
        action.run.prompt = f"Atribua para o usuário {self.member.id}"
        action.run.save()
        execute(self.access, action)
        self.assertTrue(self.issue.assignees.filter(pk=self.member.id).exists())

    def test_ambiguous_task_titles_require_identifier(self):
        twin = Issue.objects.create(workspace=self.workspace, project=self.project, name=self.issue.name)
        action = self.action("update_issue", {"issue_id": str(self.issue.id), "name": "Unambiguous update"})
        with self.assertRaises(ValidationError):
            execute(self.access, action)
        action.run.prompt = f"Altere AI-{self.issue.sequence_id}"
        action.run.save()
        execute(self.access, action)
        twin.refresh_from_db()
        self.assertEqual(twin.name, self.issue.name)

    def test_native_activity_and_notifications_are_dispatched_once_after_commit(self):
        action = self.action("create_issue", {"name": "Native pipeline"})
        with patch("plane.ai.tools.issue_activity.delay") as publish:
            with self.captureOnCommitCallbacks(execute=True):
                execute(self.access, action)
                execute(self.access, action)
        self.assertEqual(publish.call_count, 1)
        self.assertEqual(publish.call_args.kwargs["type"], "issue.activity.created")
        self.assertTrue(publish.call_args.kwargs["notification"])

    def test_confirmation_reports_partial_failure_without_rolling_back_successful_action(self):
        page = Page.objects.create(
            workspace=self.workspace, owned_by=self.admin, name="Collaborative", description_binary=b"existing-yjs"
        )
        ProjectPage.objects.create(workspace=self.workspace, project=self.project, page=page)
        run = self.new_run(allow_actions=True)
        run.status = "awaiting_confirmation"
        run.save()
        self.action("create_issue", {"name": "Successful half"}, run, 1)
        self.action("update_page", {"page_id": str(page.id), "text": "Unsafe replacement"}, run, 2)
        response = self.client.post(self.path + f"runs/{run.id}/approve/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        actions = response.data["actions"]
        self.assertEqual(actions[0]["status"], "done")
        self.assertEqual(actions[1]["status"], "failed")
        self.assertIn("Página colaborativa", actions[1]["result"]["error"])
        self.assertTrue(Issue.objects.filter(name="Successful half").exists())
        page.refresh_from_db()
        self.assertEqual(bytes(page.description_binary), b"existing-yjs")

    def test_comment_search_and_native_issue_identifiers_resolve_real_items(self):
        from plane.db.models import IssueComment

        comment = IssueComment.objects.create(
            workspace=self.workspace,
            project=self.project,
            issue=self.issue,
            actor=self.admin,
            comment_html="<p>quartz-decision-keyword</p>",
        )
        context, sources = retrieve(
            self.access, {"kind": "project", "id": str(self.project.id)}, "quartz-decision-keyword"
        )
        self.assertEqual(context["metrics"]["matching"], 1)
        self.assertTrue(any(s["kind"] == "comment" and s["id"] == str(comment.id) for s in sources))
        context, _ = retrieve(self.access, {"kind": "workspace"}, f"AI-{self.issue.sequence_id}")
        self.assertEqual(context["issues"][0]["id"], str(self.issue.id))

    def test_comment_deletion_hides_stored_answer(self):
        from plane.db.models import IssueComment

        Project.objects.filter(pk=self.project.id).update(guest_view_all_features=True)
        Connection.objects.filter(pk=self.connection.id).update(allowed_roles=[5, 15, 20])
        comment = IssueComment.objects.create(
            workspace=self.workspace,
            project=self.project,
            issue=self.issue,
            actor=self.admin,
            access="EXTERNAL",
            comment_html="<p>Now restricted comment</p>",
        )
        access = Access(self.guest, self.workspace.slug)
        _, sources = retrieve(access, {"kind": "project", "id": str(self.project.id)})
        run = self.new_run()
        run.conversation.owner = self.guest
        run.conversation.save()
        run.sources, run.status, run.response = sources, "completed", "Now restricted comment"
        run.save()
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.client.get(self.path + f"runs/{run.id}/").status_code, 200)
        comment.delete()
        self.assertEqual(self.client.get(self.path + f"runs/{run.id}/").status_code, 403)

    def test_memory_visibility_revocation_hides_stored_answer(self):
        memory = Memory.objects.create(workspace=self.workspace, kind="workspace", text="Shared then personal")
        access = Access(self.member, self.workspace.slug)
        _, sources = retrieve(access, {"kind": "project", "id": str(self.project.id)})
        run = self.new_run()
        run.conversation.owner = self.member
        run.conversation.save()
        run.sources, run.status, run.response = sources, "completed", "Shared then personal"
        run.save()
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.get(self.path + f"runs/{run.id}/").status_code, 200)
        memory.kind, memory.owner = "personal", self.admin
        memory.save()
        self.assertEqual(self.client.get(self.path + f"runs/{run.id}/").status_code, 403)

    def test_followup_keeps_failed_request_and_real_results_for_clarification(self):
        from .orchestrator import bounded_messages

        previous = self.new_run("Pedido original que precisa de esclarecimento")
        previous.status, previous.error = "failed", "Há pessoas com o mesmo nome."
        previous.save()
        current = Run.objects.create(
            workspace=self.workspace,
            conversation=previous.conversation,
            connection=self.connection,
            model="first",
            prompt=str(self.member.id),
            request_key=uuid4(),
        )
        context, _ = retrieve(self.access, current.conversation.scope)
        messages, _ = bounded_messages(current, context, self.policy, [])
        self.assertTrue(any(message["content"] == previous.prompt for message in messages))
        self.assertTrue(any("Há pessoas com o mesmo nome" in message["content"] for message in messages))

    def test_weekly_changes_include_real_activity_even_without_parent_timestamp_change(self):
        from plane.db.models import IssueActivity

        Issue.objects.filter(pk=self.issue.id).update(updated_at=timezone.now() - timedelta(days=14))
        IssueActivity.objects.create(
            workspace=self.workspace,
            project=self.project,
            issue=self.issue,
            actor=self.admin,
            field="modules",
            verb="updated",
        )
        context, _ = retrieve(self.access, {"kind": "project", "id": str(self.project.id)}, report="changed")
        self.assertTrue(any(issue["id"] == str(self.issue.id) for issue in context["issues"]))
        self.assertTrue(any(activity["field"] == "modules" for activity in context["activities"]))
