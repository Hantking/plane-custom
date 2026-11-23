# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import django
from django.apps import apps
from django.db.migrations.loader import MigrationLoader
from django.urls import resolve


def main():
    django.setup()

    # Test the installed URL configuration, not the checkout on the runner.
    collection = resolve("/api/workspaces/image-check/to-do/")
    detail = resolve(
        "/api/workspaces/image-check/to-do/00000000-0000-0000-0000-000000000000/"
    )
    assert collection.url_name == "workspace-personal-todos"
    assert collection.func.actions == {"get": "list", "post": "create"}
    assert detail.url_name == "workspace-personal-todo"
    assert detail.func.actions == {"patch": "partial_update"}

    assert apps.get_model("db", "PersonalTodo")._meta.db_table == "personal_todos"
    preference = apps.get_model("db", "WorkspaceUserPreference")
    assert preference.UserPreferenceKeys.TODO.value == "todo"

    migration = MigrationLoader(None).get_migration("db", "0124_personal_todo")
    assert any(
        getattr(operation, "name", None) == "PersonalTodo"
        for operation in migration.operations
    )

    print(
        "The backend image includes the personal To-do routes, model, preferences and migration."
    )


if __name__ == "__main__":
    main()
