"""Private AI records. Credentials never participate in serializers or audit records."""

import uuid
from django.conf import settings
from django.db import models


class Record(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Policy(Record):
    workspace = models.OneToOneField("db.Workspace", on_delete=models.CASCADE)
    enabled = models.BooleanField(default=False)
    instructions = models.TextField(blank=True)
    user_daily_limit = models.PositiveIntegerField(default=50)
    workspace_daily_limit = models.PositiveIntegerField(default=500)
    retention_days = models.PositiveIntegerField(default=30)


class Connection(Record):
    name = models.CharField(max_length=120)
    base_url = models.URLField(max_length=1000)
    encrypted_key = models.TextField(blank=True)
    protocol = models.CharField(max_length=32, default="chat_completions")
    purpose = models.CharField(max_length=16, default="chat")
    default_model = models.CharField(max_length=255)
    context_tokens = models.PositiveIntegerField(default=8000)
    output_tokens = models.PositiveIntegerField(default=1000)
    timeout_seconds = models.PositiveIntegerField(default=60)
    allowed_roles = models.JSONField(default=list)
    enabled = models.BooleanField(default=True)
    models = models.JSONField(default=list)


class Conversation(Record):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    title = models.CharField(max_length=160, default="Plane AI")
    scope = models.JSONField(default=dict)


class Run(Record):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="runs")
    connection = models.ForeignKey(Connection, on_delete=models.PROTECT)
    model = models.CharField(max_length=255)
    request_key = models.UUIDField()
    prompt = models.TextField()
    response = models.TextField(blank=True)
    status = models.CharField(max_length=32, default="queued")
    allow_actions = models.BooleanField(default=False)
    cancelled = models.BooleanField(default=False)
    sources = models.JSONField(default=list)
    context_summary = models.JSONField(default=dict)
    error = models.CharField(max_length=300, blank=True)
    usage = models.JSONField(default=dict)
    latency_ms = models.PositiveIntegerField(default=0)
    attempts = models.PositiveIntegerField(default=1)
    automation_policy = models.JSONField(default=dict)
    tool_messages = models.JSONField(default=list)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["conversation", "request_key"], name="ai_run_request_unique")]


class Action(Record):
    run = models.ForeignKey(Run, on_delete=models.CASCADE, related_name="actions")
    ordinal = models.PositiveIntegerField()
    operation = models.CharField(max_length=40)
    arguments = models.JSONField(default=dict)
    result = models.JSONField(default=dict)
    status = models.CharField(max_length=24, default="proposed")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["run", "ordinal"], name="ai_action_ordinal_unique")]


class Memory(Record):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True)
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, null=True, blank=True)
    kind = models.CharField(max_length=16, default="personal")
    text = models.TextField()


class Automation(Record):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    connection = models.ForeignKey(Connection, on_delete=models.PROTECT)
    model = models.CharField(max_length=255)
    name = models.CharField(max_length=120)
    instruction = models.TextField()
    scope = models.JSONField(default=dict)
    interval_hours = models.PositiveIntegerField(default=24)
    max_runs = models.PositiveIntegerField(default=30)
    execution_count = models.PositiveIntegerField(default=0)
    enabled = models.BooleanField(default=True)
    next_run_at = models.DateTimeField()
    last_run = models.ForeignKey(Run, on_delete=models.SET_NULL, null=True, blank=True)
    # Initial automation policy is deliberately read-only; never implicitly inherits chat consent.
    action_policy = models.CharField(max_length=16, default="read_only")
