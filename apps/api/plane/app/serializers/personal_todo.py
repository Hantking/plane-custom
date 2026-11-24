# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework import serializers

from plane.db.models import Issue, PersonalTodo


class PersonalTodoWorkItemSerializer(serializers.ModelSerializer):
    project_id = serializers.UUIDField(read_only=True)
    project_identifier = serializers.CharField(source="project.identifier")

    class Meta:
        model = Issue
        fields = ["id", "name", "project_id", "project_identifier", "sequence_id"]


class PersonalTodoSerializer(serializers.ModelSerializer):
    linked_issue_id = serializers.UUIDField(write_only=True, required=False, allow_null=True)
    linked_issue = serializers.SerializerMethodField()

    class Meta:
        model = PersonalTodo
        fields = ["id", "title", "due_date", "priority", "is_completed", "linked_issue_id", "linked_issue"]
        read_only_fields = ["id"]

    def validate_linked_issue_id(self, value):
        if value is not None and not self.context["linkable_issues"].filter(pk=value).exists():
            raise serializers.ValidationError("This work item is unavailable.", code="unavailable")
        return value

    def get_linked_issue(self, instance):
        if instance.linked_issue_id is None:
            return None

        page_issues = self.context.get("page_issues")
        if page_issues is None:
            issue = self.context["linkable_issues"].filter(pk=instance.linked_issue_id).first()
        else:
            issue = page_issues.get(instance.linked_issue_id)
        return PersonalTodoWorkItemSerializer(issue).data if issue else None

    def update(self, instance, validated_data):
        # Persist only the requested fields so editing a title does not undo a concurrent completion.
        if validated_data:
            for field, value in validated_data.items():
                setattr(instance, field, value)
            instance.save(update_fields=[*validated_data, "updated_at", "updated_by"])
        return instance
