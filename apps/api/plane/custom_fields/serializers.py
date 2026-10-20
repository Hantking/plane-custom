from uuid import UUID
import re

from django.db import transaction
from rest_framework import serializers

from .models import Field, SavedView
from .services import save_values, validate_values


class FieldSerializer(serializers.ModelSerializer):
    class Meta:
        model = Field
        fields = ["id", "name", "kind", "description", "required", "active", "options", "position"]
        read_only_fields = ["id"]

    def validate_name(self, value):
        value = value.strip()
        query = Field.objects.filter(project_id=self.context["project_id"], name__iexact=value)
        if self.instance:
            query = query.exclude(pk=self.instance.pk)
        if not value or query.exists():
            raise serializers.ValidationError("Nome vazio ou já utilizado no projeto.")
        return value

    def validate(self, attrs):
        kind = attrs.get("kind", getattr(self.instance, "kind", None))
        options = attrs.get("options", getattr(self.instance, "options", []))
        if self.instance and kind != self.instance.kind:
            raise serializers.ValidationError("O tipo de um campo existente não pode ser alterado.")
        if not isinstance(options, list) or len(options) > 50:
            raise serializers.ValidationError("Máximo de 50 opções.")
        ids, names = set(), set()
        for option in options:
            if (
                not isinstance(option, dict)
                or not {"id", "label"}.issubset(option)
                or set(option) - {"id", "label", "color"}
            ):
                raise serializers.ValidationError("Cada opção precisa de id UUID, label e uma cor opcional.")
            if "color" in option:
                color = option["color"]
                if not isinstance(color, str) or re.fullmatch(r"#[0-9a-fA-F]{6}", color) is None:
                    raise serializers.ValidationError("Cor inválida. Use o formato hexadecimal #RRGGBB.")
                option["color"] = color.lower()
            try:
                key = str(UUID(str(option["id"])))
            except (ValueError, TypeError):
                raise serializers.ValidationError("ID de opção inválido.")
            label = option["label"]
            if (
                not isinstance(label, str)
                or not label.strip()
                or len(label) > 100
                or key in ids
                or label.casefold() in names
            ):
                raise serializers.ValidationError("Opção inválida ou duplicada.")
            option.update(id=key, label=label.strip())
            ids.add(key)
            names.add(label.casefold())
        if kind == "select" and not options:
            raise serializers.ValidationError("Campo de seleção precisa de opções.")
        if kind != "select" and options:
            raise serializers.ValidationError("Este tipo não utiliza opções.")
        if (
            self.instance
            and self.instance.values.exclude(option_value__isnull=True).exclude(option_value__in=ids).exists()
        ):
            raise serializers.ValidationError("Uma opção em uso não pode ser removida. Renomeie-a ou arquive o campo.")
        return attrs


class SavedViewSerializer(serializers.ModelSerializer):
    class Meta:
        model = SavedView
        fields = ["id", "name", "shared", "config", "owner_id"]
        read_only_fields = ["id", "owner_id"]


class CustomFieldsSerializerMixin:
    """Used by the native create/update serializer: task and values commit together."""

    def run_validation(self, data=serializers.empty):
        attrs = super().run_validation(data)
        payload = attrs.get("custom_fields", {})
        project_id = self.instance.project_id if self.instance else self.context.get("project_id")
        self._hentis_prepared = validate_values(project_id, payload, creating=self.instance is None)
        return attrs

    @transaction.atomic
    def save(self, **kwargs):
        creating = self.instance is None
        if not creating:
            type(self.instance).objects.select_for_update().get(pk=self.instance.pk)
        self.validated_data.pop("custom_fields", None)
        issue = super().save(**kwargs)
        save_values(issue, self._hentis_prepared, issue.created_by_id if creating else issue.updated_by_id)
        return issue
