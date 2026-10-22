from datetime import timedelta
from uuid import uuid4
from celery import shared_task
from django.db import transaction
from django.utils import timezone
from .models import Automation, Conversation, Policy, Run
from .orchestrator import run_generation
from .security import Access, enabled


@shared_task(name="plane.ai.generate", soft_time_limit=950, time_limit=980)
def generate(identifier):
    run_generation(identifier)


@shared_task(name="plane.ai.schedule")
def schedule():
    if not enabled():
        return
    from .views import create_run

    for identifier in Automation.objects.filter(enabled=True, next_run_at__lte=timezone.now()).values_list(
        "id", flat=True
    )[:100]:
        with transaction.atomic():
            automation = (
                Automation.objects.select_for_update()
                .select_related("workspace", "owner", "connection")
                .filter(pk=identifier)
                .first()
            )
            if automation is None:
                continue
            if not automation.enabled or automation.next_run_at > timezone.now():
                continue
            if automation.execution_count >= automation.max_runs:
                automation.enabled = False
                automation.save()
                continue
            try:
                access = Access(automation.owner, automation.workspace.slug)
                access.scope(automation.scope)
                write_policy = {"automation_id": str(automation.id), "operations": []}
                if automation.action_policy == "limited_writes":
                    access.admin()
                    if automation.scope.get("kind") != "project":
                        raise ValueError("Automatic writes need a project scope")
                    write_policy = {
                        "automation_id": str(automation.id),
                        "operations": ["add_comment", "update_issue"],
                        "max_actions": 1,
                        "fields": ["priority", "state_id", "assignee_ids"],
                    }
                conversation = Conversation.objects.create(
                    workspace=automation.workspace,
                    owner=automation.owner,
                    scope=automation.scope,
                    title="Automação: " + automation.name[:130],
                )
                run = create_run(
                    access,
                    conversation,
                    automation.connection,
                    automation.model,
                    automation.instruction,
                    uuid4(),
                    automation.action_policy == "limited_writes",
                    write_policy,
                )
                automation.last_run = run
                automation.execution_count += 1
            except Exception:
                # Access revocation or invalid configuration stops future execution; no provider fallback.
                automation.enabled = False
            automation.next_run_at = timezone.now() + timedelta(hours=automation.interval_hours)
            automation.save()
    for policy in Policy.objects.all():
        Conversation.objects.filter(
            workspace=policy.workspace, updated_at__lt=timezone.now() - timedelta(days=policy.retention_days)
        ).exclude(runs__status__in=["queued", "running", "cancelling"]).delete()
    # A lost worker is never automatically replayed after the lease window.
    Run.objects.filter(
        status__in=["queued", "running", "cancelling"], updated_at__lt=timezone.now() - timedelta(minutes=20)
    ).update(
        status="failed",
        error="Execução interrompida ou worker indisponível. Revise as ações antes de tentar novamente.",
    )
