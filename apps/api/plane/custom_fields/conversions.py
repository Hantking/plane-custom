"""Lossless definition changes: validate the complete conversion before writing values."""

import copy

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import NativeLayoutPreference, SavedView
from .services import COLUMNS, OPERATORS, SELECTION_KINDS, json_value, normalize, value_columns, value_of


def convert_value(old, new, value):
    if value is None:
        return None
    if old.kind == new.kind:
        return normalize(new, value)
    if old.kind in SELECTION_KINDS and new.kind in SELECTION_KINDS:
        keys = value if isinstance(value, list) else [value]
        if new.kind == "select":
            if len(keys) > 1:
                raise ValidationError("Há tarefas com mais de uma opção; reduza-as antes de usar seleção única.")
            return normalize(new, keys[0] if keys else None)
        return normalize(new, keys)
    if old.kind in SELECTION_KINDS:
        keys = value if isinstance(value, list) else [value]
        labels = {str(option["id"]): option["label"] for option in old.options}
        value = ", ".join(labels[key] for key in keys)
    elif isinstance(value, bool):
        if new.kind == "number":
            return normalize(new, "1" if value else "0")
        value = "Sim" if value else "Não"
    else:
        value = str(json_value(value))
    if new.kind in SELECTION_KINDS:
        matches = [
            str(option["id"])
            for option in new.options
            if str(option["id"]) == value or option["label"].casefold() == value.strip().casefold()
        ]
        if len(matches) != 1:
            raise ValidationError("O valor existente não corresponde a uma opção do novo tipo.")
        return normalize(new, matches if new.kind == "multiselect" else matches[0])
    if new.kind == "boolean":
        mapping = {
            "true": True,
            "false": False,
            "sim": True,
            "não": False,
            "nao": False,
            "1": True,
            "0": False,
            "1.000000": True,
            "0.000000": False,
        }
        if value.strip().casefold() not in mapping:
            raise ValidationError("O valor existente não pode ser convertido para sim/não.")
        return mapping[value.strip().casefold()]
    return normalize(new, value)


def rewrite_views(field, *, previous=None, deleting=False, native_delete=False):
    key = str(field.id)
    if native_delete:
        for preference in NativeLayoutPreference.objects.select_for_update().filter(
            workspace_id=field.project.workspace_id
        ):
            order = [item for item in preference.property_order if item != "custom:" + key]
            visible = [item for item in preference.visible if item != key]
            if order != preference.property_order or visible != preference.visible:
                preference.property_order, preference.visible = order, visible
                preference.save(update_fields=["property_order", "visible", "updated_at"])
    for view in SavedView.objects.select_for_update().filter(project_id=field.project_id):
        config = copy.deepcopy(view.config)
        if not isinstance(config, dict):
            continue
        conditions = []
        for condition in config.get("filters", []):
            if condition.get("field") != key:
                conditions.append(condition)
                continue
            if deleting:
                continue
            op = condition.get("operator", "eq")
            try:
                if previous.kind == "multiselect" and field.kind == "select" and op in ("contains_any", "contains_all"):
                    op = "eq"
                if previous.kind == "select" and field.kind == "multiselect" and op == "eq":
                    op = "contains_any"
                if op not in OPERATORS[field.kind]:
                    continue
                condition["operator"] = op
                if op not in ("empty", "not_empty"):
                    raw = condition.get("value")
                    if previous.kind == "multiselect" and isinstance(raw, str):
                        raw = [raw]
                    condition["value"] = json_value(convert_value(previous, field, raw))
                conditions.append(condition)
            except (ValidationError, KeyError, TypeError, ValueError):
                continue
        config["filters"] = conditions
        if deleting:
            config["columns"] = [column for column in config.get("columns", []) if column != key]
        if config.get("group_by") == key and (deleting or field.kind not in {"select", "multiselect", "boolean"}):
            config["group_by"] = ""
        if str(config.get("order_by", "")).lstrip("-") == key and (deleting or field.kind == "multiselect"):
            config["order_by"] = "-created_at"
        if config != view.config:
            view.config = config
            view.save(update_fields=["config"])


@transaction.atomic
def update_definition(instance, validated_data):
    # Caller holds the definition row lock. No task-row locks/FK inserts are taken here,
    # keeping lock order compatible with native task updates (task -> definition).
    previous = copy.copy(instance)
    target = copy.copy(instance)
    for key, value in validated_data.items():
        setattr(target, key, value)
    changing_kind = target.kind != previous.kind
    if changing_kind:
        failures = []
        incompatible = 0
        for row in instance.values.select_related("field").order_by("pk").iterator(chunk_size=500):
            try:
                value = convert_value(previous, target, value_of(row))
                if target.required and value is None:
                    raise ValidationError("O novo campo é obrigatório.")
            except (ValidationError, KeyError, TypeError, ValueError):
                incompatible += 1
                if len(failures) < 10:
                    failures.append(str(row.issue_id))
        if incompatible:
            raise ValidationError(
                {
                    "kind": "Alteração cancelada: existem valores incompatíveis. Corrija-os antes de trocar o tipo.",
                    "incompatible_count": incompatible,
                    "issue_ids": failures,
                }
            )
        batch = []
        columns = [*set(COLUMNS.values()), "updated_at"]
        for row in instance.values.select_related("field").order_by("pk").iterator(chunk_size=500):
            value = convert_value(previous, target, value_of(row))
            if value is None:
                type(row).objects.filter(pk=row.pk).delete()
                continue
            for key, raw in value_columns(target.kind, value).items():
                setattr(row, key, raw)
            row.updated_at = timezone.now()
            batch.append(row)
            if len(batch) == 500:
                type(row).objects.bulk_update(batch, columns)
                batch.clear()
        if batch:
            type(batch[0]).objects.bulk_update(batch, columns)
    for key, value in validated_data.items():
        setattr(instance, key, value)
    instance.save()
    if not instance.active and previous.active:
        rewrite_views(instance, deleting=True)
    elif changing_kind:
        rewrite_views(instance, previous=previous)
    return instance
