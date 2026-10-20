from datetime import date
from decimal import Decimal, InvalidOperation
from uuid import UUID

from django.core.validators import URLValidator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Exists, F, OuterRef, Q, Subquery
from rest_framework.exceptions import ValidationError

from .models import Change, Field, Value

COLUMNS = {
    "text": "text_value",
    "url": "text_value",
    "number": "number_value",
    "date": "date_value",
    "boolean": "boolean_value",
    "select": "option_value",
    "multiselect": "option_values",
}
OPERATORS = {
    "text": {"eq", "ne", "contains", "empty", "not_empty"},
    "url": {"eq", "ne", "contains", "empty", "not_empty"},
    "number": {"eq", "ne", "gt", "gte", "lt", "lte", "empty", "not_empty"},
    "date": {"eq", "ne", "gt", "gte", "lt", "lte", "empty", "not_empty"},
    "boolean": {"eq", "ne", "empty", "not_empty"},
    "select": {"eq", "ne", "empty", "not_empty"},
    "multiselect": {"eq", "ne", "contains_any", "contains_all", "empty", "not_empty"},
}

SELECTION_KINDS = {"select", "multiselect"}


def value_columns(kind, value):
    columns = {column: None for column in set(COLUMNS.values())}
    columns["option_values"] = []
    columns[COLUMNS[kind]] = value
    return columns


def normalize(field, raw):
    if raw is None or raw == "":
        return None
    if field.kind in ("text", "url") and isinstance(raw, str) and not raw.strip():
        return None
    try:
        if field.kind == "multiselect":
            if not isinstance(raw, list) or len(raw) > 50 or any(not isinstance(item, str) for item in raw):
                raise ValueError()
            known = [str(option["id"]) for option in field.options]
            if set(raw) - set(known):
                raise ValueError()
            # Selection order is metadata-defined, not click order; this also deduplicates.
            return [key for key in known if key in raw] or None
        if field.kind == "boolean":
            if type(raw) is not bool:
                raise ValueError()
            return raw
        if field.kind == "number":
            if isinstance(raw, bool):
                raise ValueError()
            value = Decimal(str(raw))
            if not value.is_finite() or abs(value) >= Decimal("1e14") or value.as_tuple().exponent < -6:
                raise ValueError()
            return value
        if field.kind == "date":
            return date.fromisoformat(str(raw))
        if not isinstance(raw, str) or len(raw) > 10000:
            raise ValueError()
        if field.kind == "select" and raw not in {str(o["id"]) for o in field.options}:
            raise ValueError()
        if field.kind == "url":
            URLValidator(schemes=["https", "http"])(raw)
        return raw
    except (ValueError, TypeError, InvalidOperation, DjangoValidationError):
        raise ValidationError({str(field.id): f"Valor inválido para {field.name} ({field.kind})."})


def json_value(value):
    if isinstance(value, Decimal):
        return format(value, ".6f")
    if isinstance(value, date):
        return str(value)
    return value


def value_of(row):
    return json_value(getattr(row, COLUMNS[row.field.kind]))


def values_for(issues):
    result = {str(issue.id): {} for issue in issues}
    for row in Value.objects.filter(issue_id__in=result, field__project_id=F("issue__project_id")).select_related(
        "field"
    ):
        if row.field.active:
            result[str(row.issue_id)][str(row.field_id)] = value_of(row)
    return result


def validate_values(project_id, payload, *, creating=False):
    if not isinstance(payload, dict) or len(payload) > 100:
        raise ValidationError({"custom_fields": "Informe um objeto de campos (máximo 100)."})
    fields = {str(f.id): f for f in Field.objects.filter(project_id=project_id, active=True)}
    prepared = []
    for key, raw in payload.items():
        if key not in fields:
            raise ValidationError({"custom_fields": f"Campo inexistente ou de outro projeto: {key}"})
        field = fields[key]
        value = normalize(field, raw)
        if field.required and value is None:
            raise ValidationError({"custom_fields": {key: f"{field.name} é obrigatório."}})
        prepared.append((field, value))
    if creating:
        for key, field in fields.items():
            if field.required and (key not in payload or normalize(field, payload[key]) is None):
                raise ValidationError({"custom_fields": {key: f"{field.name} é obrigatório."}})
    return prepared


@transaction.atomic
def save_values(issue, prepared, actor_id):
    # Serialize concurrent edits with native task updates and keep audit atomically.
    for field, value in prepared:
        expected_kind = field.kind
        field = Field.objects.select_for_update().filter(pk=field.pk, project_id=issue.project_id, active=True).first()
        if field is None:
            raise ValidationError("O campo foi arquivado ou pertence a outro projeto.")
        if field.kind != expected_kind:
            raise ValidationError("O tipo do campo mudou. Atualize a página antes de salvar novamente.")
        value = normalize(field, json_value(value))
        if field.required and value is None:
            raise ValidationError(f"{field.name} é obrigatório.")
        existing = Value.objects.filter(issue=issue, field=field).select_related("field").first()
        before = value_of(existing) if existing else None
        after = json_value(value)
        if before == after:
            continue
        if value is None:
            Value.objects.filter(issue=issue, field=field).delete()
        else:
            defaults = value_columns(field.kind, value)
            Value.objects.update_or_create(issue=issue, field=field, defaults=defaults)
        Change.objects.create(issue=issue, field=field, actor_id=actor_id, old_value=before, new_value=after)


def filter_items(queryset, project_id, filters, match="all"):
    if not isinstance(filters, list) or len(filters) > 30 or match not in ("all", "any"):
        raise ValidationError("Filtro inválido: máximo 30 condições e match all/any.")
    fields = {str(f.id): f for f in Field.objects.filter(project_id=project_id, active=True)}
    combined = Q()
    for index, item in enumerate(filters):
        if not isinstance(item, dict) or not isinstance(item.get("field"), str) or item.get("field") not in fields:
            raise ValidationError("Campo do filtro inexistente ou de outro projeto.")
        field = fields[item["field"]]
        op = item.get("operator", "eq")
        if not isinstance(op, str) or op not in OPERATORS[field.kind]:
            raise ValidationError("Operador não suportado para este tipo de campo.")
        rows = Value.objects.filter(issue_id=OuterRef("pk"), field=field)
        if op not in ("empty", "not_empty"):
            raw = item.get("value")
            if field.kind == "multiselect" and isinstance(raw, str):
                raw = [raw]  # Backward-compatible saved filters from single selection.
            value = normalize(field, raw)
            if value is None:
                raise ValidationError("Use o operador empty para valores vazios.")
            if field.kind == "multiselect":
                if op == "contains_all":
                    rows = rows.filter(option_values__contains=value)
                else:
                    choices = Q()
                    for key in value:
                        choices |= Q(option_values__contains=[key])
                    rows = rows.filter(choices)
            else:
                lookup = {"eq": "exact", "ne": "exact", "contains": "icontains"}.get(op, op)
                rows = rows.filter(**{COLUMNS[field.kind] + "__" + lookup: value})
        elif field.kind == "multiselect":
            rows = rows.exclude(option_values=[])
        alias = f"_hentis_filter_{index}"
        queryset = queryset.alias(**{alias: Exists(rows)})
        condition = Q(**{alias: op not in ("ne", "empty")})
        combined = combined | condition if match == "any" else combined & condition
    return queryset.filter(combined)


@transaction.atomic
def move_selection(issue, payload, actor_id):
    if not isinstance(payload, dict) or set(payload) != {"field", "from", "to"}:
        raise ValidationError("Movimento de seleção inválido.")
    field, _ = field_annotation(issue.project_id, payload["field"])
    field = Field.objects.select_for_update().get(pk=field.pk)
    if field.kind != "multiselect":
        raise ValidationError("Este movimento é exclusivo da seleção múltipla.")
    allowed = {str(option["id"]) for option in field.options} | {"__empty__"}
    source, target = payload["from"], payload["to"]
    if not isinstance(source, str) or not isinstance(target, str) or source not in allowed or target not in allowed:
        raise ValidationError("Grupo inexistente.")
    row = Value.objects.filter(issue=issue, field=field).first()
    current = list(row.option_values) if row else []
    if (source == "__empty__" and current) or (source != "__empty__" and source not in current):
        raise ValidationError("Os rótulos da tarefa mudaram. Atualize o quadro e tente novamente.")
    if source != target:
        current = [] if target == "__empty__" else [key for key in current if key != source] + [target]
    prepared = validate_values(issue.project_id, {str(field.id): current})
    save_values(issue, prepared, actor_id)


def field_annotation(project_id, field_id):
    try:
        key = UUID(str(field_id))
    except ValueError:
        raise ValidationError("Identificador de campo inválido.")
    field = Field.objects.filter(pk=key, project_id=project_id, active=True).first()
    if field is None:
        raise ValidationError("Campo inexistente ou de outro projeto.")
    query = Value.objects.filter(issue_id=OuterRef("pk"), field=field).values(COLUMNS[field.kind])[:1]
    return field, Subquery(query)
