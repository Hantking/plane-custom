# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework import serializers

from plane.db.models import PersonalTodo


class PersonalTodoSerializer(serializers.ModelSerializer):
    class Meta:
        model = PersonalTodo
        fields = ["id", "title", "due_date", "priority", "is_completed"]
        read_only_fields = ["id"]

    def update(self, instance, validated_data):
        # Persist only the requested fields so editing a title does not undo a concurrent completion.
        if validated_data:
            for field, value in validated_data.items():
                setattr(instance, field, value)
            instance.save(update_fields=[*validated_data, "updated_at", "updated_by"])
        return instance
