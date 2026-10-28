"""One query contract for saved custom views and the native List. No value mirror."""

import json
import re
from types import SimpleNamespace

from django.db.models import Case, When, Value as Literal, IntegerField, F, Q, Exists, OuterRef, TextField
from django.db.models.functions import Cast
from rest_framework.exceptions import ValidationError, PermissionDenied

from plane.db.models import Issue, IssueSubscriber
from .models import Value
from .services import fields_for, field_annotation, filter_items, filter_tree, COLUMNS

STANDARD_SORTS = {
    "name": "name",
    "created_at": "created_at",
    "updated_at": "updated_at",
    "sequence_id": "sequence_id",
    "sort_order": "sort_order",
    "start_date": "start_date",
    "due_date": "target_date",
    "target_date": "target_date",
    "created_on": "created_at",
    "updated_on": "updated_at",
    "state": "state__name",
    "priority": "priority",
}
QUERY_KEYS = {
    "schema_version",
    "filters",
    "match",
    "filter_tree",
    "sorts",
    "order_by",
    "group_by",
    "layout",
    "columns",
    "search",
    "priority",
    "search_hidden",
    "subtasks",
    "collapsed_groups",
    "view_id",
    "calculations",
    "manual",
    "manual_order",
    "native_group",
}


def normalize_query(project_ids, config):
    if not isinstance(config, dict) or len(json.dumps(config)) > 30000 or set(config) - QUERY_KEYS:
        raise ValidationError("Configuração de consulta inválida (máximo 30 KB).")
    version = config.get("schema_version", 1)
    if type(version) is not int or version not in (1, 2):
        raise ValidationError("Versão de configuração não suportada.")
    fields = fields_for(project_ids)
    all_fields = fields_for(project_ids, active=False)
    columns = config.get("columns", [])
    if (
        not isinstance(columns, list)
        or len(columns) > 100
        or any(not isinstance(c, str) or c not in all_fields for c in columns)
    ):
        raise ValidationError("Colunas inválidas.")
    tree = filter_tree(config.get("filter_tree", config.get("filters", [])), config.get("match", "all"))
    filter_items(Issue.issue_objects.none(), project_ids, tree)
    group = config.get("group_by") or ""
    if not isinstance(group, str) or (
        group and (group not in fields or fields[group].kind not in {"select", "multiselect", "boolean"})
    ):
        raise ValidationError("Agrupamento disponível para seleção única/múltipla e sim/não.")
    search = config.get("search", "")
    if not isinstance(search, str) or len(search) > 255 or type(config.get("search_hidden", False)) is not bool:
        raise ValidationError("Busca inválida.")
    priority = config.get("priority", "")
    if priority not in ("", "none", "low", "medium", "high", "urgent"):
        raise ValidationError("Prioridade inválida.")
    if config.get("layout", "list") not in {"list", "table", "kanban"}:
        raise ValidationError("Layout inválido.")
    if config.get("subtasks", "collapsed") not in {"collapsed", "expanded", "separate"}:
        raise ValidationError("Modo de subtarefas inválido.")
    if config.get("native_group", "inherit") not in {
        "inherit",
        "none",
        "state",
        "priority",
        "assignees",
        "labels",
        "cycle",
        "module",
        "project",
        "created_by",
    }:
        raise ValidationError("Agrupamento nativo inválido.")
    collapsed = config.get("collapsed_groups")
    if collapsed is not None and (
        not isinstance(collapsed, list)
        or len(collapsed) > 1000
        or any(not isinstance(c, str) or len(c) > 100 for c in collapsed)
    ):
        raise ValidationError("Grupos recolhidos inválidos.")
    manual = config.get("manual_order", {})
    if type(config.get("manual", False)) is not bool or not isinstance(manual, dict) or len(manual) > 100:
        raise ValidationError("Ordem manual inválida.")
    from uuid import UUID

    total = 0
    for key, ids in manual.items():
        if (
            not isinstance(key, str)
            or len(key) > 160
            or not isinstance(ids, list)
            or len(ids) != len(set(map(str, ids)))
        ):
            raise ValidationError("Ordem manual inválida.")
        total += len(ids)
        try:
            for identifier in ids:
                UUID(str(identifier))
        except (ValueError, TypeError):
            raise ValidationError("Identificador da ordem manual inválido.")
    if total > 500:
        raise ValidationError("Máximo de 500 posições pessoais neste contexto; carregue/reordene um conjunto menor.")
    legacy = config.get("order_by", "-created_at")
    if not isinstance(legacy, str):
        raise ValidationError("Ordenação inválida.")
    sorts = config.get("sorts")
    if sorts is None:
        sorts = [
            {"field": legacy.lstrip("-"), "direction": "desc" if legacy.startswith("-") else "asc", "nulls": "last"}
        ]
    if not isinstance(sorts, list) or len(sorts) > 5:
        raise ValidationError("Máximo de cinco critérios de ordenação.")
    normalized, used = [], set()
    for sort in sorts:
        if not isinstance(sort, dict) or set(sort) - {"field", "direction", "nulls"}:
            raise ValidationError("Critério de ordenação inválido.")
        key = sort.get("field")
        if not isinstance(key, str):
            raise ValidationError("Campo de ordenação inválido.")
        bare = key.removeprefix("custom:").removeprefix("standard:")
        if (
            bare in used
            or bare not in {*STANDARD_SORTS, *fields}
            or (bare in fields and fields[bare].kind == "multiselect")
        ):
            raise ValidationError("Campo inexistente/duplicado ou sem comparador escalar (multiselect).")
        if sort.get("direction", "asc") not in {"asc", "desc"} or sort.get("nulls", "last") not in {"first", "last"}:
            raise ValidationError("Direção ou política de nulos inválida.")
        used.add(bare)
        normalized.append(
            {"field": bare, "direction": sort.get("direction", "asc"), "nulls": sort.get("nulls", "last")}
        )
    calculations = config.get("calculations", [])
    if not isinstance(calculations, list) or len(calculations) > 10:
        raise ValidationError("Máximo de dez cálculos.")
    for calculation in calculations:
        if not isinstance(calculation, dict) or set(calculation) != {"field", "operation"}:
            raise ValidationError("Cálculo inválido.")
        key, op = calculation["field"], calculation["operation"]
        if not isinstance(key, str) or key not in fields or op not in {"count", "sum", "avg", "min", "max"}:
            raise ValidationError("Campo/operação de cálculo inválido.")
        if op != "count" and fields[key].kind != "number":
            raise ValidationError("Sum/avg/min/max exigem campo numérico.")
    return {
        **config,
        "schema_version": 2,
        "filter_tree": tree,
        "sorts": normalized,
        "group_by": group,
        "columns": [key for key in dict.fromkeys(columns) if key in fields],
        "search": search,
        "priority": priority,
    }


def apply_sort(query, project_ids, sorts):
    fields = fields_for(project_ids)
    ordering = []
    for index, sort in enumerate(sorts):
        key, alias = sort["field"], f"_hentis_sort_{index}"
        if key in fields:
            field = fields[key]
            _, expression = field_annotation(field.project_id, key)
            if field.kind == "select":
                # Product decision: option metadata order, NOT UUID lexical order.
                query = query.annotate(**{alias + "_value": expression})
                expression = Case(
                    *[
                        When(**{alias + "_value": str(option["id"])}, then=Literal(i))
                        for i, option in enumerate(field.options)
                    ],
                    output_field=IntegerField(),
                )
        elif key == "priority":
            expression = Case(
                *[When(priority=p, then=Literal(i)) for i, p in enumerate(["urgent", "high", "medium", "low", "none"])],
                output_field=IntegerField(),
            )
        else:
            expression = F(STANDARD_SORTS[key])
        query = query.annotate(**{alias: expression})
        direction = F(alias).desc if sort["direction"] == "desc" else F(alias).asc
        ordering.append(direction(**{"nulls_first" if sort["nulls"] == "first" else "nulls_last": True}))
    ordering.append(F("id").asc())
    query = query.order_by(*ordering)
    query.query.hentis_order = ordering
    return query


def apply_query(query, project_ids, config, *, visible=None, hierarchy=False):
    query = filter_items(query, project_ids, config["filter_tree"])
    if config.get("priority"):
        query = query.filter(priority=config["priority"])
    if config.get("group_by"):
        query = query.filter(project_id=fields_for(project_ids)[config["group_by"]].project_id)
    if hierarchy and config.get("subtasks", "collapsed") != "separate":
        query = query.filter(parent__isnull=True)
    if config.get("search"):
        term = config["search"].strip()
        text = Q(name__icontains=term) | Q(description_stripped__icontains=term)
        match = re.fullmatch(r"(.+)-(\d+)", term)
        if match and len(match[2]) <= 10:
            text |= Q(project__identifier__iexact=match[1], sequence_id=int(match[2]))
        from uuid import UUID

        try:
            text |= Q(id=UUID(term))
        except ValueError:
            pass
        fields = fields_for(project_ids)
        search_fields = (
            list(fields)
            if config.get("search_hidden")
            else (visible if visible is not None else config.get("columns", []))
        )
        allowed = [key for key in search_fields if key in fields]
        condition = Q(
            field_id__in=[key for key in allowed if fields[key].kind in {"text", "long_text", "site", "url"}],
            text_value__icontains=term,
        )
        phone_term = re.sub(r"\D", "", term)
        if phone_term:
            condition |= Q(
                field_id__in=[key for key in allowed if fields[key].kind == "phone"], text_value__icontains=phone_term
            )
        for key in allowed:
            field = fields[key]
            if field.kind in {"select", "multiselect"}:
                options = [
                    str(option["id"]) for option in field.options if term.casefold() in option["label"].casefold()
                ]
                if field.kind == "select":
                    condition |= Q(field_id=key, option_value__in=options)
                else:
                    for option in options:
                        condition |= Q(field_id=key, option_values__contains=[option])
            elif field.kind == "boolean" and term.casefold() in {"sim", "true", "não", "nao", "false"}:
                condition |= Q(field_id=key, boolean_value=term.casefold() in {"sim", "true"})
        condition |= Q(
            field_id__in=[key for key in allowed if fields[key].kind == "number"],
            _number_text__icontains=term.replace(",", "."),
        )
        condition |= Q(field_id__in=[key for key in allowed if fields[key].kind == "date"], _date_text__icontains=term)
        rows = (
            Value.objects.filter(issue_id=OuterRef("pk"), field__project_id=OuterRef("project_id"))
            .alias(_number_text=Cast("number_value", TextField()), _date_text=Cast("date_value", TextField()))
            .filter(condition)
        )
        query = query.alias(_hentis_search=Exists(rows)).filter(text | Q(_hentis_search=True))
    if config["sorts"]:
        query = apply_sort(query, project_ids, config["sorts"])
    elif not config.get("manual"):
        query = query.order_by("-created_at", "id")
    return query


def apply_manual(query, config, group_by=None, group_key=None):
    if config.get("sorts") or not config.get("manual"):
        return query
    whens = []
    native_names = {
        "state_id": "state",
        "priority": "priority",
        "project_id": "project",
        "created_by": "created_by",
        "cycle_id": "cycle",
        "assignees__id": "assignees",
        "labels__id": "labels",
        "issue_module__module_id": "module",
    }
    fields = {value: key for key, value in native_names.items()}
    name = config.get("native_group", "inherit")
    name = native_names.get(group_by, "none") if name == "inherit" else name
    group_by = fields.get(name)
    spec = "custom:" + config["group_by"] if config.get("group_by") else "native:" + name
    prefix = (config.get("view_id") or "__current__") + "|" + spec + "|"
    for stored_key, identifiers in config.get("manual_order", {}).items():
        if stored_key.startswith(prefix):
            key = stored_key[len(prefix) :]
        elif "|" not in stored_key and "/" not in stored_key and not config.get("view_id"):
            key = stored_key
        else:
            continue
        if group_key is not None and key != group_key:
            continue
        if group_key is None and group_by not in {None, False, "", "state_id", "priority"}:
            continue
        for index, identifier in enumerate(identifiers):
            condition = Q(pk=identifier)
            if group_key is None and group_by:
                condition &= Q(**{group_by: key})
            whens.append(When(condition, then=Literal(index)))
    query = query.annotate(_hentis_manual=Case(*whens, default=Literal(1000000), output_field=IntegerField()))
    order = [F("_hentis_manual").asc(), F("sort_order").asc(nulls_last=True), F("id").asc()]
    query = query.order_by(*order)
    query.query.hentis_order = order
    return query


def group_options(field):
    if field.kind in {"select", "multiselect"}:
        options = [(str(option["id"]), option["label"]) for option in field.options]
    else:
        options = [("true", "Sim"), ("false", "Não")]
    return options + [("__empty__", "Sem valor")]


def compatible_group(tree, field, key):
    def truth(node):
        if "op" in node:
            values = [truth(child) for child in node["children"]]
            if not values:
                return True
            if node["op"] == "not":
                return None if values[0] is None else not values[0]
            if node["op"] == "and":
                return False if False in values else True if all(value is True for value in values) else None
            return True if True in values else False if all(value is False for value in values) else None
        if node["field"] != str(field.id):
            return None
        op = node.get("operator", "eq")
        if op == "empty":
            return key == "__empty__"
        if op == "not_empty":
            return key != "__empty__"
        raw = node.get("value")
        values = raw if isinstance(raw, list) else [str(raw).lower() if field.kind == "boolean" else str(raw)]
        return key not in values if op == "ne" else key in values

    return truth(tree) is not False


def group_query(query, project_ids, config, field, key):
    query = query.filter(project_id=field.project_id)
    rows = Value.objects.filter(issue_id=OuterRef("pk"), field=field)
    if key == "__empty__":
        if field.kind == "multiselect":
            rows = rows.exclude(option_values=[])
        selected = query.filter(~Exists(rows))
    else:
        rows = (
            rows.filter(option_values__contains=[key])
            if field.kind == "multiselect"
            else rows.filter(**{COLUMNS[field.kind]: key == "true" if field.kind == "boolean" else key})
        )
        selected = query.filter(Exists(rows))
    return filter_items(selected, project_ids, config["filter_tree"], occurrence=(str(field.id), key))


def native_scope_queryset(context):
    query = context.issues_all()
    if context.scope == "module":
        query = query.filter(issue_module__module_id=context.target, issue_module__deleted_at__isnull=True)
    elif context.scope == "cycle":
        query = query.filter(issue_cycle__cycle_id=context.target, issue_cycle__deleted_at__isnull=True)
    elif context.scope == "workspace_builtin":
        target = str(context.target)
        if target.endswith("0002"):
            query = query.filter(assignees=context.user)
        elif target.endswith("0003"):
            query = query.filter(created_by=context.user)
        elif target.endswith("0004"):
            query = query.filter(pk__in=IssueSubscriber.objects.filter(subscriber=context.user).values("issue_id"))
    return query.distinct()


def apply_standard(query, params):
    """Reuse both native evaluators. No list of client-provided SQL field expressions."""
    from plane.utils.issue_filters import issue_filters
    from plane.utils.filters import ComplexFilterBackend, IssueFilterSet
    from django.http import QueryDict

    if not isinstance(params, dict) or len(json.dumps(params)) > 30000:
        raise ValidationError("Filtros nativos inválidos.")
    qd = QueryDict(mutable=True)
    for key, value in params.items():
        if value is not None and not isinstance(value, (str, bool, int)):
            raise ValidationError("Parâmetros nativos devem usar valores escalares serializados.")
        if isinstance(value, (str, bool, int)) and key not in {
            "cursor",
            "per_page",
            "group_by",
            "sub_group_by",
            "order_by",
            "hentis_query",
        }:
            qd[key] = str(value).lower() if isinstance(value, bool) else str(value)
    if qd.get("filters"):
        query = ComplexFilterBackend().filter_queryset(
            None, query, SimpleNamespace(filterset_class=IssueFilterSet), filter_data=qd["filters"]
        )
    return query.filter(**issue_filters(qd, "GET"))


def native_query_from_request(request, queryset, view):
    raw = request.query_params.get("hentis_query")
    if not raw:
        return queryset
    from .native import NativeContext

    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        raise ValidationError("Consulta da Lista inválida.")
    if not isinstance(data, dict) or len(raw) > 40000:
        raise ValidationError("Consulta da Lista inválida.")
    context = NativeContext(request.user, view.kwargs["slug"], data.get("context"))
    if queryset.model is not Issue:
        raise ValidationError("Consulta da Lista exige um queryset de tarefas.")
    if context.layout != "list":
        raise ValidationError("Consulta avançada exclusiva da Lista.")
    project = view.kwargs.get("project_id")
    if project and (not context.project or str(context.project.id) != str(project)):
        raise PermissionDenied("Contexto não corresponde ao endpoint.")
    config = normalize_query(context.project_ids, data.get("query", {}))
    from .list_api import validate_preset

    validate_preset(context, config)
    visible = context.metadata()["preference"]["visible"]
    queryset = queryset.filter(pk__in=native_scope_queryset(context).values("id"))
    queryset = apply_query(queryset, context.project_ids, config, visible=visible, hierarchy=True)
    queryset.query.hentis_list = {
        "config": config,
        "project_ids": context.project_ids,
        "native_group": request.query_params.get("hentis_native_group") or request.query_params.get("group_by"),
        "group_key": request.query_params.get("hentis_group"),
        "actor": context.user.id,
        "workspace": context.workspace.id,
    }
    return queryset


def native_group_response(request, query, on_results):
    """Native cursor envelope + full native serializers, with 25 rows per custom group."""
    from rest_framework.response import Response

    hint = getattr(query.query, "hentis_list", None)
    if not hint or not hint["config"].get("group_by"):
        return None
    config, projects = hint["config"], hint["project_ids"]
    field = fields_for(projects)[config["group_by"]]
    base = query.filter(project_id=field.project_id)
    try:
        cursor = request.GET.get("cursor", "25:0:0").split(":")
        page = int(cursor[1])
    except (ValueError, IndexError):
        raise ValidationError("Cursor inválido.")
    if page < 0 or page > 100000:
        raise ValidationError("Cursor inválido.")
    selected_key = request.GET.get("hentis_group")
    results, more = {}, False
    options = group_options(field)
    if selected_key is not None and selected_key not in dict(options):
        raise ValidationError("Grupo inválido.")
    for key, _ in options:
        if not compatible_group(config["filter_tree"], field, key):
            continue
        if selected_key is not None and selected_key != key:
            continue
        selected = apply_manual(group_query(base, projects, config, field, key), config, group_key=key)
        count = selected.count()
        rows = selected[page * 25 : (page + 1) * 25]
        results[key] = {"results": on_results(rows) if on_results else rows, "total_results": count}
        more = more or count > (page + 1) * 25
    total = base.count()
    if selected_key is not None:
        if selected_key not in results:
            raise ValidationError("Grupo incompatível com os filtros.")
        group = results[selected_key]
        results, total = group["results"], group["total_results"]
    return Response(
        {
            "grouped_by": "hentis_custom" if selected_key is None else None,
            "hentis_server_order": True,
            "sub_grouped_by": None,
            "total_count": total,
            "total_results": total,
            "next_cursor": f"25:{page + 1}:0",
            "prev_cursor": f"25:{max(0, page - 1)}:1",
            "next_page_results": more,
            "prev_page_results": page > 0,
            "count": len(results),
            "total_pages": (total + 24) // 25,
            "extra_stats": None,
            "results": results,
        }
    )
