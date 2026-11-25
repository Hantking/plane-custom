# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from itertools import batched

from django.db import migrations, models


def copy_links(apps, schema_editor):
    todo = apps.get_model("db", "PersonalTodo")
    through = todo.linked_issues.through
    alias = schema_editor.connection.alias
    rows = todo.objects.using(alias).exclude(linked_issue_id=None).values_list("pk", "linked_issue_id")
    for batch in batched(rows.iterator(chunk_size=1000), 1000):
        through.objects.using(alias).bulk_create(
            [through(personaltodo_id=todo_id, issue_id=issue_id) for todo_id, issue_id in batch],
            ignore_conflicts=True,
        )


def restore_first_link(apps, schema_editor):
    todo = apps.get_model("db", "PersonalTodo")
    through = todo.linked_issues.through
    alias = schema_editor.connection.alias
    first_links = (
        through.objects.using(alias)
        .order_by("personaltodo_id", "id")
        .distinct("personaltodo_id")
        .values_list("personaltodo_id", "issue_id")
    )
    for batch in batched(first_links.iterator(chunk_size=1000), 1000):
        todo.objects.using(alias).bulk_update(
            [todo(pk=todo_id, linked_issue_id=issue_id) for todo_id, issue_id in batch], ["linked_issue"]
        )


class Migration(migrations.Migration):
    dependencies = [("db", "0125_personal_todo_linked_issue")]

    operations = [
        migrations.AddField(
            model_name="personaltodo",
            name="linked_issues",
            field=models.ManyToManyField(blank=True, related_name="linked_personal_todos", to="db.issue"),
        ),
        migrations.RunPython(copy_links, restore_first_link),
    ]
