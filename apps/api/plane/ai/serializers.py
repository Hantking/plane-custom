from rest_framework import serializers
from .models import Connection, Policy, Memory, Automation
from .security import encrypt, provider_address

CAPABILITIES = {"streaming", "tools", "structured", "system", "embeddings", "multimodal"}
PARAMETERS = {"temperature", "top_p", "frequency_penalty", "presence_penalty", "seed", "stop", "reasoning_effort"}


class CatalogSerializer(serializers.Serializer):
    connection_id = serializers.UUIDField(required=False)
    base_url = serializers.URLField(required=False, max_length=2000)
    api_key = serializers.CharField(required=False, allow_blank=True, max_length=10000, write_only=True)
    purpose = serializers.ChoiceField(choices=["chat", "embedding"], default="chat")


class ConnectionSerializer(serializers.ModelSerializer):
    api_key = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=10000)
    has_api_key = serializers.SerializerMethodField()

    class Meta:
        model = Connection
        fields = [
            "id",
            "name",
            "base_url",
            "api_key",
            "has_api_key",
            "protocol",
            "purpose",
            "models",
            "default_model",
            "context_tokens",
            "output_tokens",
            "timeout_seconds",
            "allowed_roles",
            "enabled",
        ]
        read_only_fields = ["id", "has_api_key"]

    def get_has_api_key(self, instance):
        return bool(instance.encrypted_key)

    def validate(self, attrs):
        current = self.instance

        def get(key, default=None):
            return attrs.get(key, getattr(current, key, default))

        provider_address(get("base_url"))
        if get("protocol", "chat_completions") != "chat_completions":
            raise serializers.ValidationError("Somente Chat Completions está implementado nesta versão.")
        if get("purpose", "chat") not in {"chat", "embedding"}:
            raise serializers.ValidationError("Finalidade inválida.")
        models = get("models", [])
        if not isinstance(models, list) or not 1 <= len(models) <= 30:
            raise serializers.ValidationError("Cadastre de 1 a 30 modelos.")
        ids = set()
        for model in models:
            if not isinstance(model, dict) or not isinstance(model.get("id"), str) or not 1 <= len(model["id"]) <= 255:
                raise serializers.ValidationError("Identificador de modelo inválido.")
            if set(model) - {"id", "capabilities", "parameters", "output_parameter"}:
                raise serializers.ValidationError("Configuração de modelo desconhecida.")
            if model["id"] in ids:
                raise serializers.ValidationError("Modelo duplicado.")
            ids.add(model["id"])
            caps = model.get("capabilities", {})
            if (
                not isinstance(caps, dict)
                or set(caps) - CAPABILITIES
                or any(type(v) is not bool for v in caps.values())
            ):
                raise serializers.ValidationError("Capacidades inválidas.")
            model["capabilities"] = {key: caps.get(key, False) for key in CAPABILITIES}
            params = model.get("parameters", {})
            if not isinstance(params, dict) or set(params) - PARAMETERS or len(str(params)) > 2000:
                raise serializers.ValidationError("Parâmetros de geração não permitidos.")
            if model.get("output_parameter", "max_tokens") not in {"max_tokens", "max_completion_tokens", "none"}:
                raise serializers.ValidationError("Parâmetro de limite de saída inválido.")
        if get("default_model") not in ids:
            raise serializers.ValidationError("O modelo padrão deve constar da lista autorizada.")
        for key, low, high, default in [
            ("context_tokens", 2000, 128000, 8000),
            ("output_tokens", 32, 16000, 1000),
            ("timeout_seconds", 5, 180, 60),
        ]:
            if not low <= get(key, default) <= high:
                raise serializers.ValidationError(f"{key}: limite permitido {low}–{high}.")
        if get("output_tokens", 1000) >= get("context_tokens", 8000):
            raise serializers.ValidationError("A saída deve ser menor que a janela de contexto.")
        roles = get("allowed_roles", [15, 20])
        if (
            not isinstance(roles, list)
            or not roles
            or any(type(role) is not int or role not in [5, 15, 20] for role in roles)
        ):
            raise serializers.ValidationError("Papéis autorizados inválidos.")
        attrs.setdefault("allowed_roles", roles)
        return attrs

    def create(self, validated_data):
        key = validated_data.pop("api_key", "")
        return super().create({**validated_data, "encrypted_key": encrypt(key)})

    def update(self, instance, validated_data):
        if "api_key" in validated_data:
            validated_data["encrypted_key"] = encrypt(validated_data.pop("api_key"))
        return super().update(instance, validated_data)


class PolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = Policy
        fields = ["enabled", "instructions", "user_daily_limit", "workspace_daily_limit", "retention_days"]
        extra_kwargs = {
            "instructions": {"max_length": 6000},
            "user_daily_limit": {"min_value": 1, "max_value": 10000},
            "workspace_daily_limit": {"min_value": 1, "max_value": 100000},
            "retention_days": {"min_value": 1, "max_value": 365},
        }


class MemorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Memory
        fields = ["id", "kind", "project", "text"]
        read_only_fields = ["id"]
        extra_kwargs = {"text": {"max_length": 4000}}


class AutomationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Automation
        fields = [
            "id",
            "name",
            "connection",
            "model",
            "instruction",
            "scope",
            "interval_hours",
            "max_runs",
            "execution_count",
            "enabled",
            "next_run_at",
            "last_run",
            "action_policy",
        ]
        read_only_fields = ["id", "execution_count", "next_run_at", "last_run"]
        extra_kwargs = {
            "instruction": {"max_length": 6000},
            "interval_hours": {"min_value": 1, "max_value": 8760},
            "max_runs": {"min_value": 1, "max_value": 1000},
        }

    def validate_action_policy(self, value):
        if value not in {"read_only", "limited_writes"}:
            raise serializers.ValidationError("Política inválida: read_only ou limited_writes.")
        return value
