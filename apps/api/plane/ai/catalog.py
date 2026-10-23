"""Provider model discovery: real IDs, metadata when available, editable compatibility profiles."""

import re
from urllib.parse import urlsplit


def describe_model(item, connection):
    identifier = item.get("id")
    if not isinstance(identifier, str) or not 1 <= len(identifier) <= 255:
        return None
    lower = identifier.lower()
    embedding = "embed" in lower or "embedding" in lower
    architecture = item.get("architecture") or {}
    output = architecture.get("output_modalities") if isinstance(architecture, dict) else None
    if connection.purpose == "embedding":
        if not embedding:
            return None
    elif embedding or re.search(r"(?:^|[/\-])(whisper|tts|dall-e|image|moderation|rerank)(?:[/\-]|$)", lower):
        return None
    elif isinstance(output, list) and "text" not in output:
        return None
    parameters = item.get("supported_parameters")
    metadata = isinstance(parameters, list)
    known = any(
        name in lower
        for name in ["gpt-", "claude", "gemini", "llama-3", "llama-4", "qwen3", "qwen2.5", "mistral", "deepseek"]
    ) or bool(re.search(r"(?:^|/)o[134](?:-|$)", lower))
    legacy_reasoning = lower.endswith(("o1-mini", "o1-preview"))
    caps = {
        "streaming": known and not embedding,
        "tools": ("tools" in parameters if metadata else known) and not embedding and not legacy_reasoning,
        "system": not legacy_reasoning,
        "structured": metadata and "response_format" in parameters,
        "embeddings": embedding,
        "multimodal": False,
    }
    native_reasoning = urlsplit(connection.base_url).hostname == "api.openai.com" and (
        lower.startswith(("o1", "o3", "o4", "gpt-5"))
    )
    context = item.get("context_length")
    return {
        "id": identifier,
        "name": str(item.get("name") or identifier)[:160],
        "description": str(item.get("description") or "")[:280],
        "context_tokens": context if type(context) is int and context > 0 else None,
        "capability_source": "provider" if metadata else "profile" if known or embedding else "unknown",
        "configuration": {
            "id": identifier,
            "capabilities": caps,
            "parameters": {},
            "output_parameter": "max_completion_tokens" if native_reasoning else "max_tokens",
        },
    }
