# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.app.serializers.personal_todo import PersonalTodoSerializer


@pytest.mark.unit
def test_personal_todo_serializer_trims_title_and_accepts_optional_fields():
    serializer = PersonalTodoSerializer(data={"title": "  Prepare estimate  ", "due_date": None})

    assert serializer.is_valid(), serializer.errors
    assert serializer.validated_data == {"title": "Prepare estimate", "due_date": None}


@pytest.mark.unit
@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"title": "   "}, "title"),
        ({"title": "a" * 256}, "title"),
        ({"title": "Example", "due_date": "2026-02-30"}, "due_date"),
        ({"title": "Example", "priority": "critical"}, "priority"),
    ],
)
def test_personal_todo_serializer_rejects_invalid_fields(payload, field):
    serializer = PersonalTodoSerializer(data=payload)

    assert not serializer.is_valid()
    assert field in serializer.errors
