"""Authorized List query operations, reusing Field/Value and the native filter stack."""

import csv
import io
import json
from uuid import UUID, uuid4

from django.core.cache import cache
from django.db import transaction
from django.db.models import Count, Sum, Avg, Min, Max
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError, PermissionDenied, APIException
from rest_framework.response import Response
from rest_framework.views import APIView

from plane.authentication.session import BaseSessionAuthentication
from plane.db.models import ProjectMember, WorkspaceMember
from .models import SavedView, Value
from .native import NativeContext
from .services import fields_for, normalize, value_of, save_values, validate_values, values_for
from .query import normalize_query, native_scope_queryset, apply_standard, apply_query


class Conflict(APIException):
    status_code = 409
    default_detail = "Os dados mudaram. Atualize a visualização antes de repetir."


def validate_preset(context, config):
    if config.get("view_id"):
        try:
            identifier = UUID(str(config["view_id"]))
        except (ValueError, TypeError):
            raise ValidationError("View inválida.")
        view = get_object_or_404(SavedView, pk=identifier, project_id__in=context.project_ids)
        if not view.shared and view.owner_id != context.user.id:
            raise PermissionDenied("View privada.")


def context_query(request, slug):
    context = NativeContext(request.user, slug, request.data.get("context"))
    if context.layout != "list":
        raise ValidationError("Operação exclusiva da Lista.")
    config = normalize_query(context.project_ids, request.data.get("query", {}))
    validate_preset(context, config)
    standard = request.data.get("standard", {})
    query = apply_standard(native_scope_queryset(context), standard)
    query = apply_query(
        query, context.project_ids, config, visible=context.metadata()["preference"]["visible"], hierarchy=True
    )
    if not config["sorts"]:
        from .query import apply_manual
        from plane.utils.order_queryset import order_issue_queryset

        query = (
            apply_manual(query, config, standard.get("group_by"))
            if config.get("manual")
            else order_issue_queryset(query, standard.get("order_by", "-created_at"))[0]
        )
    return context, config, query.distinct()


def check_expected(issue, prepared, expected):
    if expected is None:
        return
    if not isinstance(expected, dict) or set(expected) != {str(field.id) for field, _ in prepared}:
        raise ValidationError("Informe o valor anterior de cada campo alterado.")
    for field, _ in prepared:
        row = Value.objects.filter(issue=issue, field=field).select_related("field").first()
        before = normalize(field, value_of(row) if row else None)
        if before != normalize(field, expected[str(field.id)]):
            raise Conflict("Este campo foi alterado em outra edição. O valor atual foi preservado; atualize a célula.")


def creation_defaults(tree, fields=None):
    result, ambiguous = {}, set()

    def collect(node):
        if node.get("op") == "and":
            for child in node["children"]:
                collect(child)
        elif (
            "op" not in node
            and node.get("operator", "eq") == "eq"
            and not isinstance(node.get("value"), list)
            and (not fields or fields[node["field"]].kind != "multiselect")
        ):
            field, value = node["field"], node.get("value")
            if field in result and result[field] != value:
                ambiguous.add(field)
            result[field] = value

    collect(tree)
    return {field: value for field, value in result.items() if field not in ambiguous}


class NativeListOperations(APIView):
    authentication_classes = [BaseSessionAuthentication]

    def post(self, request, slug, operation):
        context, config, query = context_query(request, slug)
        fields = fields_for(context.project_ids)
        if operation == "summary":
            calculations = []
            for spec in config.get("calculations", []):
                field = fields[spec["field"]]
                rows = Value.objects.filter(field=field, issue_id__in=query.values("id"))
                aggregate = {
                    "count": Count("issue_id", distinct=True),
                    "sum": Sum("number_value"),
                    "avg": Avg("number_value"),
                    "min": Min("number_value"),
                    "max": Max("number_value"),
                }[spec["operation"]]
                calculations.append({**spec, "value": rows.aggregate(value=aggregate)["value"]})
            return Response(
                {
                    "count": query.count(),
                    "calculations": calculations,
                    "creation_defaults": creation_defaults(config["filter_tree"], fields),
                    "subtasks": config.get("subtasks", "collapsed"),
                    "counts": "unique_entities_before_pagination",
                }
            )
        if operation == "children":
            raw = request.data.get("ids", [])
            if not isinstance(raw, list) or len(raw) > 100:
                raise ValidationError("Máximo de 100 pais por lote.")
            try:
                ids = [UUID(str(key)) for key in raw]
            except (ValueError, TypeError):
                raise ValidationError("Identificador inválido.")
            from .native_serialization import authorized_issues

            authorized = authorized_issues(context.user.id, context.workspace.id)
            parents = list(authorized.filter(pk__in=ids))
            # Expanded descendants are authorized contextual rows, not additional filtered totals.
            from .native_serialization import native_items

            children = authorized.filter(parent_id__in=[p.id for p in parents]).order_by("sort_order", "id")
            if children.count() > 2000:
                raise ValidationError("Expansão muito grande. Expanda os pais individualmente.")
            writable = ProjectMember.objects.filter(
                workspace=context.workspace, member=context.user, is_active=True, role__gte=15
            ).values_list("project_id", flat=True)
            return Response(
                {
                    "results": native_items(children, user_id=context.user.id, workspace_id=context.workspace.id),
                    "parents": [str(p.id) for p in parents],
                    "editable_project_ids": [str(key) for key in writable],
                }
            )
        if operation == "selection":
            requested = request.data.get("ids")
            if requested is not None:
                if not isinstance(requested, list) or len(requested) > 2000:
                    raise ValidationError("Seleção carregada inválida.")
                try:
                    requested = list({UUID(str(key)) for key in requested})
                except (ValueError, TypeError):
                    raise ValidationError("Identificador inválido.")
                query = query.filter(pk__in=requested)
            ids = list(query.order_by("id").values_list("id", flat=True)[:2001])
            if len(ids) > 2000:
                raise ValidationError(
                    "Seleção global acima de 2000 itens; refine os filtros. Nenhuma página foi truncada."
                )
            token = str(uuid4())
            cache.set(
                self.key(context, token),
                {
                    "ids": [str(key) for key in ids],
                    "context": context.key_string(),
                    "query": config,
                    "standard": request.data.get("standard", {}),
                    "result": None,
                },
                300,
            )
            return Response({"token": token, "count": len(ids), "expires_in": 300})
        if operation == "bulk":
            return self.bulk(request, context, config)
        if operation == "export":
            return self.export(request, context, config, query, fields)
        raise ValidationError("Operação desconhecida.")

    def key(self, context, token):
        return f"hentis-list-selection:{context.workspace.id}:{context.user.id}:{token}"

    def bulk(self, request, context, config):
        token = request.data.get("token")
        try:
            token = str(UUID(str(token)))
        except (ValueError, TypeError):
            raise ValidationError("Token de seleção inválido.")
        snapshot = cache.get(self.key(context, token)) if isinstance(token, str) else None
        if (
            snapshot is None
            or snapshot["context"] != context.key_string()
            or snapshot["query"] != config
            or snapshot["standard"] != request.data.get("standard", {})
        ):
            raise Conflict("Seleção expirada ou consulta alterada. Selecione os resultados novamente.")
        values = request.data.get("values")
        if not isinstance(values, dict) or not values or len(values) > 5:
            raise ValidationError("Informe campos/valores para a operação.")
        signature = json.dumps(values, sort_keys=True)
        if snapshot["result"] is not None:
            if snapshot.get("signature") != signature:
                raise Conflict("Token já usado por outra operação.")
            return Response(snapshot["result"])
        lock = self.key(context, token) + ":lock"
        if not cache.add(lock, True, 300):
            raise Conflict("Esta operação já está em andamento.")
        results = []
        try:
            allowed = {m.project_id for m in context.memberships if m.role >= 15 or context.workspace_member.role == 20}
            prepared_projects = {}
            for identifier in dict.fromkeys(snapshot["ids"]):
                try:
                    with transaction.atomic():
                        issue = get_object_or_404(
                            context.issues_all().select_for_update(of=("self",)), pk=identifier, project_id__in=allowed
                        )
                        membership = ProjectMember.objects.filter(
                            workspace=context.workspace,
                            project_id=issue.project_id,
                            member=context.user,
                            is_active=True,
                        ).first()
                        workspace_member = WorkspaceMember.objects.filter(
                            workspace=context.workspace, member=context.user, is_active=True, role__in=[5, 15, 20]
                        ).first()
                        if (
                            not membership
                            or not workspace_member
                            or (membership.role < 15 and workspace_member.role != 20)
                            or not type(context.user).objects.filter(pk=context.user.pk, is_active=True).exists()
                        ):
                            raise PermissionDenied("Permissão revogada durante a operação.")
                        if issue.archived_at or issue.project.archived_at:
                            raise ValidationError("Não é possível editar uma tarefa/projeto arquivado.")
                        if issue.project_id not in prepared_projects:
                            prepared_projects[issue.project_id] = validate_values(issue.project_id, values)
                        prepared = prepared_projects[issue.project_id]
                        save_values(issue, prepared, context.user.id)
                    results.append({"id": identifier, "ok": True})
                except Exception as failure:
                    detail = (
                        str(failure.detail)
                        if isinstance(failure, APIException)
                        else "Item indisponível ou sem permissão."
                    )
                    results.append({"id": identifier, "ok": False, "error": detail[:500]})
            response = {"results": results, "succeeded": sum(row["ok"] for row in results), "count": len(results)}
            snapshot.update(result=response, signature=signature)
            cache.set(self.key(context, token), snapshot, 300)
            return Response(response)
        finally:
            cache.delete(lock)

    def export(self, request, context, config, query, fields):
        mode = request.data.get("mode", "presentation")
        if mode not in {"presentation", "all"}:
            raise ValidationError("Modo de exportação inválido.")
        if query.count() > 10000:
            raise ValidationError("Exportação acima de 10000 itens; refine os filtros.")
        preference = context.metadata()["preference"]
        ids = (
            list(fields)
            if mode == "all"
            else [
                key[7:] for key in preference["order"] if key.startswith("custom:") and key[7:] in preference["visible"]
            ]
        )
        buffer = io.StringIO()
        writer = csv.writer(buffer, delimiter=";")
        writer.writerow(["ID", "Título", "Estado", "Prioridade", "Início", "Prazo"] + [fields[key].name for key in ids])

        def safe(value):
            text = "" if value is None else str(value)
            return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text

        batch = []

        def write(items):
            values = values_for(items)
            for issue in items:
                row = [
                    f"{issue.project.identifier}-{issue.sequence_id}",
                    issue.name,
                    issue.state.name if issue.state else "",
                    issue.priority,
                    issue.start_date,
                    issue.target_date,
                ]
                custom = []
                for key in ids:
                    value, field = values[str(issue.id)].get(key), fields[key]
                    if field.kind in {"select", "multiselect"}:
                        chosen = value if isinstance(value, list) else [value]
                        value = ", ".join(option["label"] for option in field.options if option["id"] in chosen)
                    custom.append(str(value) if field.kind == "number" and value is not None else safe(value))
                writer.writerow([safe(value) for value in row] + custom)
                if buffer.tell() > 10_000_000:
                    raise ValidationError("CSV excede 10 MB; reduza o escopo/colunas.")

        for issue in query.select_related("project", "state").iterator(chunk_size=100):
            batch.append(issue)
            if len(batch) == 100:
                write(batch)
                batch = []
        write(batch)
        response = HttpResponse("\ufeff" + buffer.getvalue(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="plane-lista.csv"'
        response["Cache-Control"] = "no-store"
        return response
