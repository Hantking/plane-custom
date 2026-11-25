# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import transaction
from rest_framework import serializers

from plane.db.models import Issue, PersonalTodo


class PersonalTodoWorkItemSerializer(serializers.ModelSerializer):
    project_id = serializers.UUIDField(read_only=True)
    project_identifier = serializers.CharField(source="project.identifier")

    class Meta:
        model = Issue
        fields = ["id", "name", "project_id", "project_identifier", "sequence_id"]


class TodoLinkChangesSerializer(serializers.Serializer):
    add = serializers.ListField(child=serializers.UUIDField(), required=False)
    remove = serializers.ListField(child=serializers.UUIDField(), required=False)

    def validate(self, attrs):
        if set(attrs.get("add", ())) & set(attrs.get("remove", ())):
            raise serializers.ValidationError("A work item cannot be both added and removed.")
        return attrs


class PersonalTodoSerializer(serializers.ModelSerializer):
    linked_issue_id = serializers.UUIDField(write_only=True, required=False, allow_null=True)
    link_changes = TodoLinkChangesSerializer(write_only=True, required=False)
    linked_issues = serializers.SerializerMethodField()

    class Meta:
        model = PersonalTodo
        fields = [
            "id",
            "title",
            "due_date",
            "priority",
            "is_completed",
            "linked_issue_id",
            "link_changes",
            "linked_issues",
        ]
        read_only_fields = ["id"]

    def validate(self, attrs):
        if "linked_issue_id" in attrs and "link_changes" in attrs:
            raise serializers.ValidationError({"link_changes": "Use one link format per request."})
        legacy_id = attrs.get("linked_issue_id")
        added = {legacy_id} if legacy_id is not None else set(attrs.get("link_changes", {}).get("add", ()))
        if added and self.context["linkable_issues"].filter(pk__in=added).count() != len(added):
            field = "linked_issue_id" if legacy_id is not None else "link_changes"
            raise serializers.ValidationError({field: "One or more work items are unavailable."}, code="unavailable")
        return attrs

    def visible_links(self, instance):
        return self.context["linkable_issues"].filter(linked_personal_todos=instance)

    def get_linked_issues(self, instance):
        issues = getattr(instance, "visible_linked_issues", None)
        if issues is None:
            issues = self.visible_links(instance)
        return PersonalTodoWorkItemSerializer(issues, many=True).data

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["linked_issue"] = next(iter(data["linked_issues"]), None)
        return data

    @transaction.atomic
    def create(self, validated_data):
        legacy_id = validated_data.pop("linked_issue_id", None)
        changes = validated_data.pop("link_changes", {})
        instance = super().create(validated_data)
        added = changes.get("add", ())
        if legacy_id is not None:
            added = (legacy_id,)
        if added:
            instance.linked_issues.add(*added)
        return instance

    @transaction.atomic
    def update(self, instance, validated_data):
        legacy_change = "linked_issue_id" in validated_data
        legacy_id = validated_data.pop("linked_issue_id", None)
        changes = validated_data.pop("link_changes", {})

        # The row lock serializes link edits with other writes to the same To-do.
        instance = PersonalTodo.objects.select_for_update().get(pk=instance.pk)
        if legacy_change:
            first = self.visible_links(instance).values_list("pk", flat=True).first()
            if first != legacy_id:
                changes = {"add": [legacy_id] if legacy_id else [], "remove": [first] if first else []}

        added = changes.get("add", ())
        removed = changes.get("remove", ())
        if removed:
            visible = self.visible_links(instance).filter(pk__in=removed).values_list("pk", flat=True)
            instance.linked_issues.remove(*visible)
        if added:
            instance.linked_issues.add(*added)
        if validated_data or added or removed:
            for field, value in validated_data.items():
                setattr(instance, field, value)
            instance.save(update_fields=[*validated_data, "updated_at", "updated_by"])
        return instance
