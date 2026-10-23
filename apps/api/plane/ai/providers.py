"""Protocol adapters. No provider names, default models, redirects or implicit fallbacks."""

import http.client
import json
import socket
import ssl
import time
from contextlib import contextmanager

from rest_framework.exceptions import ValidationError
from .security import decrypt, provider_address


class ProviderError(Exception):
    pass


class Cancelled(Exception):
    pass


def safe_usage(value):
    if not isinstance(value, dict):
        return {}
    return {
        key: count
        for key, count in value.items()
        if key in {"prompt_tokens", "completion_tokens", "total_tokens"} and type(count) is int and count >= 0
    }


def model_config(connection, identifier):
    for model in connection.models:
        if model["id"] == identifier:
            return model
    raise ValidationError("Modelo não autorizado nesta conexão.")


@contextmanager
def request(connection, method, suffix, payload=None):
    parsed, address, port = provider_address(connection.base_url)
    client = http.client.HTTPConnection(parsed.hostname, port, timeout=connection.timeout_seconds)
    try:
        sock = socket.create_connection((address, port), timeout=connection.timeout_seconds)
        if parsed.scheme == "https":
            sock = ssl.create_default_context().wrap_socket(sock, server_hostname=parsed.hostname)
        client.sock = sock
        key = decrypt(connection.encrypted_key)
        headers = {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "Plane-AI"}
        if key:
            headers["Authorization"] = "Bearer " + key
        path = parsed.path.rstrip("/") + "/" + suffix
        client.request(
            method, path, body=json.dumps(payload).encode() if payload is not None else None, headers=headers
        )
        response = client.getresponse()
        if response.status >= 300:
            messages = {
                401: "Credencial recusada pelo provedor.",
                403: "Conexão não autorizada pelo provedor.",
                404: "Modelo ou endpoint inexistente.",
                429: "Limite de uso do provedor atingido.",
                400: "Provedor recusou o formato ou capacidades configuradas para este modelo.",
            }
            # Provider bodies can contain secrets or echoed prompts; never log or return them.
            raise ProviderError(messages.get(response.status, "Provedor indisponível. Tente novamente mais tarde."))
        yield response
    except (OSError, ssl.SSLError, http.client.HTTPException):
        raise ProviderError("Falha de rede ou tempo de resposta do provedor excedido.") from None
    finally:
        client.close()


class ChatCompletions:
    def __init__(self, connection):
        self.connection = connection

    def models(self):
        return [item["id"] for item in self.catalog()]

    def catalog(self):
        from .catalog import describe_model

        with request(self.connection, "GET", "models") as response:
            raw = response.read(1_000_001)
        if len(raw) > 1_000_000:
            raise ProviderError("Lista de modelos excede o limite.")
        try:
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError()
            items = data.get("data", [])
            if not isinstance(items, list):
                raise ValueError()
            result, seen = [], set()
            for item in items[:1000]:
                if not isinstance(item, dict):
                    continue
                model = describe_model(item, self.connection)
                if model and model["id"] not in seen:
                    seen.add(model["id"])
                    result.append(model)
            return result
        except (ValueError, KeyError, TypeError):
            raise ProviderError("Formato de listagem de modelos incompatível.") from None

    def payload(self, model, messages, tools=None):
        config = model_config(self.connection, model)
        caps = config["capabilities"]
        messages = [dict(message) for message in messages]
        if not caps["system"]:
            messages = [{**message, "role": "user"} if message["role"] == "system" else message for message in messages]
        payload = {"model": model, "messages": messages, **config.get("parameters", {})}
        token_parameter = config.get("output_parameter", "max_tokens")
        if token_parameter != "none":
            payload[token_parameter] = self.connection.output_tokens
        if caps["streaming"]:
            payload["stream"] = True
        if tools and caps["tools"]:
            payload["tools"] = tools
        # Structured/multimodal/embeddings are declared independently, never implicitly sent.
        return payload

    def complete(self, model, messages, tools=None, on_delta=None, cancelled=lambda: False):
        payload = self.payload(model, messages, tools)
        started = time.monotonic()
        with request(self.connection, "POST", "chat/completions", payload) as response:
            if not payload.get("stream"):
                raw = response.read(2_000_001)
                if len(raw) > 2_000_000:
                    raise ProviderError("Resposta excedeu o limite de tamanho.")
                try:
                    data = json.loads(raw)
                    message = data["choices"][0]["message"]
                    if not isinstance(message.get("content") or "", str):
                        raise ValueError()
                    if cancelled():
                        raise Cancelled()
                    return message, safe_usage(data.get("usage", {}))
                except (ValueError, KeyError, IndexError, TypeError):
                    raise ProviderError("Resposta Chat Completions incompatível.") from None
            content, calls, usage, size = "", {}, {}, 0
            while True:
                if cancelled():
                    raise Cancelled()
                if time.monotonic() - started > self.connection.timeout_seconds:
                    raise ProviderError("Tempo total de geração excedido.")
                line = response.readline(262145)
                size += len(line)
                if size > 2_000_000 or len(line) > 262144:
                    raise ProviderError("Resposta excedeu o limite de tamanho.")
                if not line:
                    raise ProviderError("Stream interrompido antes da conclusão.")
                if not line.startswith(b"data:"):
                    continue
                value = line[5:].strip()
                if value == b"[DONE]":
                    break
                try:
                    chunk = json.loads(value)
                    usage = chunk.get("usage") or usage
                    if chunk.get("error"):
                        raise ProviderError("O provedor interrompeu a geração.")
                    choices = chunk.get("choices", [])
                    delta = choices[0].get("delta", {}) if choices else {}
                    if delta.get("content"):
                        content += delta["content"]
                        if on_delta:
                            on_delta(content)
                    for tool in delta.get("tool_calls", []):
                        index = tool["index"]
                        call = calls.setdefault(
                            index, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}}
                        )
                        if tool.get("id"):
                            call["id"] = tool["id"]
                        for key in ("name", "arguments"):
                            call["function"][key] += tool.get("function", {}).get(key, "")
                except (ValueError, KeyError, TypeError, IndexError):
                    raise ProviderError("Stream Chat Completions incompatível.") from None
        message = {"role": "assistant", "content": content}
        if calls:
            message["tool_calls"] = [calls[key] for key in sorted(calls)]
        return message, safe_usage(usage)


ADAPTERS = {"chat_completions": ChatCompletions}


class Embeddings(ChatCompletions):
    def embed(self, model, text):
        if not model_config(self.connection, model)["capabilities"]["embeddings"]:
            raise ValidationError("Este modelo não declara suporte a embeddings.")
        with request(self.connection, "POST", "embeddings", {"model": model, "input": text[:4000]}) as response:
            raw = response.read(1_000_001)
        try:
            vector = json.loads(raw)["data"][0]["embedding"]
            if (
                len(raw) > 1_000_000
                or not isinstance(vector, list)
                or not 1 <= len(vector) <= 65536
                or any(type(n) not in {int, float} for n in vector)
            ):
                raise ValueError()
            return vector
        except (ValueError, KeyError, IndexError, TypeError):
            raise ProviderError("Resposta de embeddings incompatível.") from None


def adapter(connection):
    if connection.protocol not in ADAPTERS or connection.purpose not in {"chat", "embedding"}:
        raise ValidationError("Protocolo/finalidade não disponível para conversa.")
    if connection.purpose == "embedding":
        return Embeddings(connection)
    return ADAPTERS[connection.protocol](connection)
