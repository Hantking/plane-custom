from uuid import uuid4

from django.conf import settings
from django.db import models
from django.db.models.functions import Lower


class Field(models.Model):
    TYPES = [(kind, kind) for kind in ("text", "number", "date", "boolean", "select", "url")]
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    kind = models.CharField(max_length=12, choices=TYPES)
    description = models.CharField(max_length=500, blank=True)
    required = models.BooleanField(default=False)
    active = models.BooleanField(default=True)
    options = models.JSONField(default=list, blank=True)
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "hentis_custom_fields"
        ordering = ["position", "created_at"]
        constraints = [models.UniqueConstraint(Lower("name"), "project", name="hentis_field_project_name")]


class Value(models.Model):
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="hentis_field_values")
    field = models.ForeignKey(Field, on_delete=models.CASCADE, related_name="values")
    text_value = models.TextField(null=True)
    number_value = models.DecimalField(max_digits=20, decimal_places=6, null=True, db_index=True)
    date_value = models.DateField(null=True, db_index=True)
    boolean_value = models.BooleanField(null=True, db_index=True)
    option_value = models.CharField(max_length=36, null=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "hentis_custom_field_values"
        constraints = [models.UniqueConstraint(fields=["issue", "field"], name="hentis_issue_field_unique")]
        indexes = [models.Index(fields=["field", "issue"], name="hentis_field_issue_idx")]


class Change(models.Model):
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE)
    field = models.ForeignKey(Field, on_delete=models.CASCADE)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    old_value = models.JSONField(null=True)
    new_value = models.JSONField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "hentis_custom_field_changes"
        ordering = ["-created_at", "-id"]


class SavedView(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    shared = models.BooleanField(default=False)
    config = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "hentis_custom_field_views"
        ordering = ["name", "id"]
