import json
import asyncio
from asgiref.sync import sync_to_async
from datetime import timedelta
from uuid import UUID
from django.db import transaction
from django.db.models import Q, Count, Avg
from django.http import StreamingHttpResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError, Throttled, APIException
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.renderers import JSONRenderer
from rest_framework.views import APIView
from plane.authentication.session import BaseSessionAuthentication
from .models import Policy, Connection, Conversation, Run, Memory, Automation
from .serializers import (
    CatalogSerializer,
    ConnectionSerializer,
    PolicySerializer,
    MemorySerializer,
    AutomationSerializer,
)
from .security import Access, enabled
from .orchestrator import ensure_connection, get_access
from .providers import adapter, model_config, ProviderError
from . import tools
from .models import Action


def identifier(value):
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError):
        raise ValidationError("Identificador UUID inválido.")


def dispatch_run(run):
    from .tasks import generate

    transaction.on_commit(lambda: generate.delay(str(run.id)))


def public_run(access, run):
    get_access(run)
    return {
        "id": str(run.id),
        "conversation_id": str(run.conversation_id),
        "prompt": run.prompt,
        "response": run.response,
        "status": run.status,
        "error": run.error,
        "sources": run.sources,
        "context": run.context_summary,
        "model": run.model,
        "usage": run.usage,
        "latency_ms": run.latency_ms,
        "actions": list(run.actions.order_by("ordinal").values("id", "operation", "arguments", "status", "result")),
    }


def create_run(
    access, conversation, connection, model, prompt, request_key, allow_actions=False, automation_policy=None
):
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 24000:
        raise ValidationError("Informe uma mensagem de até 24000 caracteres.")
    try:
        request_key = UUID(str(request_key))
    except (ValueError, TypeError):
        raise ValidationError("Chave de idempotência UUID obrigatória.")
    with transaction.atomic():
        policy = ensure_connection(access, connection, model)
        policy = Policy.objects.select_for_update().get(pk=policy.pk)
        old = conversation.runs.filter(request_key=request_key).first()
        if old:
            if old.prompt != prompt or old.connection_id != connection.id or old.model != model:
                raise ValidationError("Chave de idempotência já usada com outra mensagem.")
            return old
        if conversation.runs.count() >= 100:
            raise ValidationError("Esta conversa atingiu 100 mensagens. Inicie uma nova conversa.")
        midnight = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
        daily = Run.objects.filter(workspace=access.workspace, created_at__gte=midnight)
        if (
            daily.count() >= policy.workspace_daily_limit
            or daily.filter(conversation__owner=access.user).count() >= policy.user_daily_limit
        ):
            raise Throttled(detail="Limite diário de Plane AI atingido (janela UTC).")
        if (
            Run.objects.filter(
                conversation__owner=access.user,
                workspace=access.workspace,
                status__in=["queued", "running", "cancelling"],
            ).count()
            >= 2
        ):
            raise Throttled(detail="Aguarde as gerações em andamento ou cancele uma delas.")
        access.scope(conversation.scope)
        for previous in conversation.runs.all():
            if not access.sources_allowed(previous.sources):
                raise PermissionDenied("Contexto anterior revogado. Inicie uma nova conversa.")
        if allow_actions and not model_config(connection, model)["capabilities"]["tools"]:
            raise ValidationError("Este modelo não oferece tool calling. Use consultas/escrita sem execução.")
        run = Run.objects.create(
            workspace=access.workspace,
            conversation=conversation,
            connection=connection,
            model=model,
            prompt=prompt,
            request_key=request_key,
            allow_actions=allow_actions,
            automation_policy=automation_policy or {},
        )
        Conversation.objects.filter(pk=conversation.pk).update(updated_at=timezone.now())
        dispatch_run(run)
        return run


class EventStreamRenderer(JSONRenderer):
    media_type = "text/event-stream"
    format = "event-stream"


class AIEndpoint(APIView):
    authentication_classes = [BaseSessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get_renderers(self):
        if self.kwargs.get("resource") == "runs" and self.kwargs.get("command") == "events":
            return [EventStreamRenderer(), JSONRenderer()]
        return super().get_renderers()

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store"
        return response

    def access(self, request, slug):
        return Access(request.user, slug)

    def conversation(self, access, pk):
        conversation = get_object_or_404(Conversation, pk=pk, workspace=access.workspace, owner=access.user)
        access.scope(conversation.scope)
        for run in conversation.runs.all():
            if not access.sources_allowed(run.sources):
                raise PermissionDenied("Acesso ao contexto revogado. Esta conversa está indisponível.")
        return conversation

    def run(self, access, pk):
        run = get_object_or_404(
            Run.objects.select_related("conversation__owner", "connection", "workspace"),
            pk=pk,
            workspace=access.workspace,
            conversation__owner=access.user,
        )
        get_access(run)
        return run

    def get(self, request, slug, resource="bootstrap", pk=None, command=None):
        if resource == "bootstrap":
            access = Access(request.user, slug, require_enabled=False)
            policy, _ = Policy.objects.get_or_create(workspace=access.workspace)
            connections = Connection.objects.filter(workspace=access.workspace, enabled=True, purpose="chat").order_by(
                "created_at", "id"
            )
            return Response(
                {
                    "enabled": enabled() and policy.enabled,
                    "admin": access.member.role == 20,
                    "connections": [
                        {"id": str(c.id), "name": c.name, "models": c.models, "default_model": c.default_model}
                        for c in connections
                        if access.member.role in c.allowed_roles
                    ],
                    "projects": list(access.projects().values("id", "name")[:100]),
                    "writable_projects": list(
                        access.projects()
                        .filter(pk__in=access.memberships.filter(role__gte=15).values("project_id"))
                        .order_by("name")
                        .values("id", "name")[:100]
                    ),
                }
            )
        access = self.access(request, slug)
        if resource == "settings":
            access.admin()
            policy, _ = Policy.objects.get_or_create(workspace=access.workspace)
            return Response(PolicySerializer(policy).data)
        if resource == "metrics":
            access.admin()
            recent = Run.objects.filter(workspace=access.workspace, created_at__gte=timezone.now() - timedelta(days=30))
            return Response(
                {
                    "period_days": 30,
                    "by_model_status": list(
                        recent.values("model", "status").annotate(count=Count("id"), latency_ms=Avg("latency_ms"))
                    ),
                    "reported_tokens": sum(
                        row.get("total_tokens", 0) for row in recent.values_list("usage", flat=True)
                    ),
                    "notice": "Consumo informado pelo provedor; valores ausentes não são estimados.",
                }
            )
        if resource == "connections":
            access.admin()
            connections = Connection.objects.filter(workspace=access.workspace)
            return Response(
                ConnectionSerializer(get_object_or_404(connections, pk=pk)).data
                if pk
                else ConnectionSerializer(connections, many=True).data
            )
        if resource == "conversations":
            if pk:
                conversation = self.conversation(access, pk)
                return Response(
                    {
                        "id": str(conversation.id),
                        "scope": conversation.scope,
                        "runs": [
                            public_run(access, r)
                            for r in conversation.runs.select_related(
                                "conversation__owner", "connection", "workspace"
                            ).order_by("created_at")[:100]
                        ],
                    }
                )
            conversations = Conversation.objects.filter(workspace=access.workspace, owner=access.user).order_by(
                "-updated_at"
            )[:50]
            visible = []
            for conversation in conversations:
                try:
                    self.conversation(access, conversation.id)
                    visible.append(
                        {"id": str(conversation.id), "title": conversation.title, "scope": conversation.scope}
                    )
                except Exception as exc:
                    from django.http import Http404

                    if not isinstance(exc, (PermissionDenied, Http404)):
                        raise
            return Response(visible)
        if resource == "runs" and pk:
            run = self.run(access, pk)
            if command == "report-document":
                from .report_documents import report_document

                return Response(report_document(run, request.query_params.get("report_id")))
            if command == "events":

                async def stream():
                    from django.db import close_old_connections

                    def snapshot():
                        close_old_connections()
                        current_access = Access(request.user, slug)
                        current = self.run(current_access, pk)
                        return public_run(current_access, current)

                    try:
                        for _ in range(360):
                            data = await sync_to_async(snapshot, thread_sensitive=True)()
                            yield "data: " + json.dumps(data, default=str) + "\n\n"
                            if data["status"] not in {"queued", "running", "cancelling"}:
                                return
                            await asyncio.sleep(0.5)
                    except Exception:
                        yield 'event: error\ndata: {"error":"Acesso revogado ou stream indisponível."}\n\n'
                    finally:
                        await sync_to_async(close_old_connections, thread_sensitive=True)()

                response = StreamingHttpResponse(stream(), content_type="text/event-stream")
                response["Cache-Control"] = "no-cache, no-store"
                response["X-Accel-Buffering"] = "no"
                return response
            return Response(public_run(access, run))
        if resource == "memories":
            records = Memory.objects.filter(workspace=access.workspace).filter(
                Q(kind="personal", owner=access.user)
                | Q(kind="workspace")
                | Q(kind="project", project_id__in=access.memberships.values("project_id"))
            )
            return Response(MemorySerializer(records, many=True).data)
        if resource == "automations":
            records = Automation.objects.filter(workspace=access.workspace, owner=access.user)
            return Response(AutomationSerializer(records, many=True).data)
        raise ValidationError("Recurso desconhecido.")

    def post(self, request, slug, resource, pk=None, command=None):
        access = self.access(request, slug)
        data = request.data
        if resource == "catalog":
            access.admin()
            serializer = CatalogSerializer(data=data)
            serializer.is_valid(raise_exception=True)
            values = serializer.validated_data
            saved = (
                get_object_or_404(Connection, workspace=access.workspace, pk=values["connection_id"])
                if values.get("connection_id")
                else None
            )
            from .security import encrypt

            if (
                saved
                and values.get("base_url", saved.base_url).rstrip("/") != saved.base_url.rstrip("/")
                and "api_key" not in values
            ):
                raise ValidationError(
                    "Ao alterar o endereço do provedor, informe a credencial dessa conexão novamente."
                )
            connection = Connection(
                workspace=access.workspace,
                base_url=values.get("base_url", saved.base_url if saved else ""),
                encrypted_key=encrypt(values["api_key"])
                if "api_key" in values
                else saved.encrypted_key
                if saved
                else "",
                purpose=values["purpose"],
                protocol="chat_completions",
                timeout_seconds=15,
            )
            try:
                models = adapter(connection).catalog()
            except ProviderError as exc:
                raise ValidationError(str(exc))
            return Response({"models": models, "count": len(models)})
        if resource == "connections":
            access.admin()
            if not pk:
                serializer = ConnectionSerializer(data=data)
                serializer.is_valid(raise_exception=True)
                serializer.save(workspace=access.workspace)
                return Response(serializer.data, status=201)
            connection = get_object_or_404(Connection, workspace=access.workspace, pk=pk)
            try:
                if command == "models":
                    return Response(
                        {
                            "models": adapter(connection).models(),
                            "capabilities_detected": False,
                            "notice": "A listagem não informa capacidades; configure e teste cada modelo.",
                        }
                    )
                if command == "test":
                    model = data.get("model", connection.default_model)
                    if connection.purpose == "embedding":
                        vector = adapter(connection).embed(model, "Plane AI connection test.")
                        return Response(
                            {
                                "ok": True,
                                "model": model,
                                "dimensions": len(vector),
                                "notice": "Embeddings compatíveis. A recuperação atual usa busca lexical autorizada.",
                            }
                        )
                    messages = [
                        {"role": "system", "content": "Compatibility check."},
                        {"role": "user", "content": "Reply with OK."},
                    ]
                    caps = model_config(connection, model)["capabilities"]
                    test_tools = (
                        [
                            {
                                "type": "function",
                                "function": {
                                    "name": "compatibility_probe",
                                    "description": "Compatibility check; no side effects.",
                                    "parameters": {"type": "object", "properties": {}},
                                },
                            }
                        ]
                        if caps["tools"]
                        else None
                    )
                    message, usage = adapter(connection).complete(model, messages, test_tools)
                    return Response(
                        {
                            "ok": True,
                            "model": model,
                            "capabilities": caps,
                            "tool_call_observed": bool(message.get("tool_calls")),
                            "notice": (
                                "Protocolo aceito. Capacidades declaradas não são garantia de suporte; "
                                "embeddings/multimodal não são usados por esta versão."
                            ),
                            "usage": usage,
                        }
                    )
            except ProviderError as exc:
                raise ValidationError(str(exc))
        if resource == "conversations":
            scope = access.scope(data.get("scope", {"kind": "workspace"}))
            conversation = Conversation.objects.create(
                workspace=access.workspace,
                owner=access.user,
                scope=scope,
                title=str(data.get("title", "Plane AI"))[:160],
            )
            return Response({"id": str(conversation.id), "scope": scope}, status=201)
        if resource == "runs" and not pk:
            conversation = self.conversation(access, identifier(data.get("conversation_id")))
            connection = get_object_or_404(
                Connection, workspace=access.workspace, pk=identifier(data.get("connection_id"))
            )
            run = create_run(
                access,
                conversation,
                connection,
                data.get("model", connection.default_model),
                data.get("prompt"),
                data.get("request_key"),
                data.get("allow_actions") is True,
            )
            return Response({"id": str(run.id), "status": run.status}, status=202)
        if resource == "runs" and pk:
            run = self.run(access, pk)
            if command == "report-page":
                from .report_documents import publish_report

                return Response(publish_report(access, run, data), status=201)
            if command == "cancel":
                with transaction.atomic():
                    current = Run.objects.select_for_update().get(pk=run.pk)
                    if current.status == "completed":
                        return Response(
                            {"status": "completed", "notice": "A execução já terminou; nenhuma ação foi desfeita."}
                        )
                    current.cancelled = True
                    current.status = "cancelling" if current.status in {"running", "cancelling"} else "cancelled"
                    current.save(update_fields=["cancelled", "status", "updated_at"])
                return Response({"status": current.status})
            if command == "retry":
                with transaction.atomic():
                    run = Run.objects.select_for_update().get(pk=run.pk)
                    if run.status not in {"failed", "cancelled"}:
                        raise ValidationError("Somente gerações com falha/canceladas podem ser repetidas.")
                    if run.actions.filter(status="done").exists():
                        # Avoid a second model plan creating another variant of an already committed task.
                        run.response = (
                            "Ações já executadas. Consulte os resultados reais abaixo; nenhuma alteração foi repetida."
                        )
                        run.status, run.error = "completed", ""
                    else:
                        if run.attempts >= 3:
                            raise ValidationError("Limite de duas novas tentativas atingido para esta mensagem.")
                        run.attempts += 1
                        run.cancelled, run.status, run.error, run.response = False, "queued", "", ""
                        run.actions.filter(status="proposed").update(status="rejected")
                        dispatch_run(run)
                    run.save()
                return Response({"id": str(run.id), "status": run.status})
            if command in {"approve", "reject"}:
                return self.resolve_preview(access, run.id, command)
        if resource in {"memories", "automations"}:
            return self.save_owned(access, resource, data)
        raise ValidationError("Operação desconhecida.")

    def resolve_preview(self, access, identifier, command):
        with transaction.atomic():
            run = (
                Run.objects.select_for_update()
                .select_related("workspace", "conversation__owner", "connection")
                .get(pk=identifier, workspace=access.workspace, conversation__owner=access.user)
            )
            get_access(run)
            if run.status == "completed":
                return Response(public_run(access, run))
            if run.status != "awaiting_confirmation":
                raise ValidationError("Não há prévia pendente para esta execução.")
            if command == "reject":
                run.actions.filter(status="proposed").update(status="rejected")
                run.response = "Prévia descartada. As ações pendentes não foram executadas."
            else:
                for action in run.actions.order_by("ordinal"):
                    if action.status != "proposed":
                        continue
                    try:
                        result = tools.execute(access, action)
                        run.sources.append(result)
                    except Exception as failure:
                        detail = (
                            str(failure.detail)
                            if isinstance(failure, APIException)
                            else (
                                "Registro indisponível ou sem acesso."
                                if isinstance(failure, Http404)
                                else "Operação não concluída."
                            )
                        )
                        Action.objects.filter(pk=action.pk, status="proposed").update(
                            status="failed", result={"error": detail[:1000]}
                        )
                run.response = (
                    "Confirmação processada. Consulte cada resultado; falhas não são informadas como sucesso."
                )
            run.status = "completed"
            run.sources = list({(s["kind"], s["id"]): s for s in run.sources}.values())
            run.save(update_fields=["sources", "status", "response", "updated_at"])
            return Response(public_run(access, run))

    def save_owned(self, access, resource, data, instance=None):
        if resource == "memories":
            serializer = MemorySerializer(instance, data=data, partial=instance is not None)
            serializer.is_valid(raise_exception=True)
            kind = serializer.validated_data.get("kind", getattr(instance, "kind", "personal"))
            project = serializer.validated_data.get("project", getattr(instance, "project", None))
            if kind not in {"personal", "project", "workspace"}:
                raise ValidationError("Tipo de memória inválido.")
            if kind != "personal":
                access.admin()
            if kind == "project":
                if not project:
                    raise ValidationError("Projeto obrigatório.")
                access.project(project.id, write=True)
            elif project:
                raise ValidationError("Memória pessoal/compartilhada não aceita projeto.")
            serializer.save(workspace=access.workspace, owner=access.user if kind == "personal" else None)
        else:
            serializer = AutomationSerializer(instance, data=data, partial=instance is not None)
            serializer.is_valid(raise_exception=True)

            def get(key, default=None):
                return serializer.validated_data.get(key, getattr(instance, key, default))

            connection = get("connection")
            ensure_connection(access, connection, get("model"))
            scope = access.scope(get("scope", {"kind": "workspace"}))
            if get("action_policy", "read_only") == "limited_writes":
                access.admin()
                if scope["kind"] != "project":
                    raise ValidationError("Escrita automática exige um projeto explícito.")
                access.project(scope["id"], write=True)
                if not model_config(connection, get("model"))["capabilities"]["tools"]:
                    raise ValidationError("A política de escrita exige tool calling.")
            serializer.save(
                workspace=access.workspace,
                owner=access.user,
                scope=scope,
                next_run_at=timezone.now() + timedelta(hours=get("interval_hours", 24)),
            )
        return Response(serializer.data, status=200 if instance else 201)

    def patch(self, request, slug, resource, pk=None):
        access = self.access(request, slug)
        if resource == "settings":
            access.admin()
            policy, _ = Policy.objects.get_or_create(workspace=access.workspace)
            serializer = PolicySerializer(policy, data=request.data, partial=True)
        elif resource == "connections":
            access.admin()
            serializer = ConnectionSerializer(
                get_object_or_404(Connection, workspace=access.workspace, pk=pk), data=request.data, partial=True
            )
        elif resource in {"memories", "automations"}:
            model = Memory if resource == "memories" else Automation
            instance = get_object_or_404(model, workspace=access.workspace, pk=pk)
            if instance.owner_id != access.user.id:
                if resource == "automations" or instance.kind == "personal":
                    raise PermissionDenied()
                access.admin()
            return self.save_owned(access, resource, request.data, instance)
        else:
            raise ValidationError("Recurso desconhecido.")
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, slug, resource, pk):
        access = self.access(request, slug)
        if resource == "conversations":
            # Deletion must remain possible after source access is revoked.
            instance = get_object_or_404(Conversation, workspace=access.workspace, owner=access.user, pk=pk)
            if instance.runs.filter(status__in=["running", "cancelling"]).exists():
                raise ValidationError("Cancele a geração e aguarde sua finalização antes de apagar.")
        elif resource == "connections":
            access.admin()
            instance = get_object_or_404(Connection, workspace=access.workspace, pk=pk)
            if instance.run_set.exists() or instance.automation_set.exists():
                raise ValidationError("Conexão em uso: desative-a ou apague primeiro os históricos vinculados.")
        elif resource in {"memories", "automations"}:
            instance = get_object_or_404(
                Memory if resource == "memories" else Automation, workspace=access.workspace, pk=pk
            )
            if instance.owner_id != access.user.id:
                if resource == "automations" or instance.kind == "personal":
                    raise PermissionDenied()
                access.admin()
        else:
            raise ValidationError("Recurso desconhecido.")
        instance.delete()
        return Response(status=204)
