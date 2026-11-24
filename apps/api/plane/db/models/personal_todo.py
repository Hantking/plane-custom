# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.conf import settings
from django.db import models

from .base import BaseModel


class PersonalTodo(BaseModel):
    class Priority(models.TextChoices):
        NONE = "none", "None"
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"
        URGENT = "urgent", "Urgent"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="personal_todos")
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="personal_todos")
    linked_issue = models.ForeignKey("db.Issue", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    title = models.CharField(max_length=255)
    due_date = models.DateField(blank=True, null=True)
    priority = models.CharField(max_length=6, choices=Priority.choices, default=Priority.NONE)
    is_completed = models.BooleanField(default=False)

    class Meta:
        db_table = "personal_todos"
        indexes = [
            models.Index(fields=["workspace", "owner", "is_completed", "due_date"], name="todo_owner_status_due_idx"),
        ]
