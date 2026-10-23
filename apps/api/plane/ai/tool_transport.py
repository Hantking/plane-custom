"""Normalize a provider's assistant-only tool envelope into typed tool calls."""

import json
import re
from html import unescape
from uuid import uuid4


class ToolEnvelopeError(ValueError):
    pass


BLOCK = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>", re.S)
FUNCTION = re.compile(r"<function=([A-Za-z_][\w]*)>(.*?)</function>", re.S)
PARAMETER = re.compile(r"<parameter=([A-Za-z_][\w]*)>(.*?)</parameter>", re.S)


def visible_assistant_text(text):
    """Do not stream internal tool envelopes, including a fragmented opening tag."""
    for marker in ["<tool_call", "<function="]:
        index = text.find(marker)
        if index >= 0:
            return text[:index].rstrip()
        for length in range(1, len(marker)):
            if text.endswith(marker[:length]):
                return text[:-length]
    return text


def normalize_tool_message(message, schemas):
    text = message.get("content") or ""
    if "<tool_call" not in text and "<function=" not in text:
        return message
    allowed = {schema["function"]["name"]: schema["function"] for schema in schemas or []}
    blocks = list(BLOCK.finditer(text))
    if not allowed or not blocks or len(blocks) > 6 or BLOCK.sub("", text).strip() or message.get("tool_calls"):
        raise ToolEnvelopeError("O provedor retornou uma chamada textual de ferramenta incompatível.")
    calls = []
    for block in blocks:
        body = block[1].strip()
        function = FUNCTION.fullmatch(body)
        if function:
            name, parameters = function.groups()
            if name not in allowed:
                raise ToolEnvelopeError("O modelo solicitou uma ferramenta não disponibilizada nesta mensagem.")
            entries = list(PARAMETER.finditer(parameters))
            if PARAMETER.sub("", parameters).strip():
                raise ToolEnvelopeError("Parâmetros textuais de ferramenta inválidos.")
            arguments = {}
            properties = allowed[name]["parameters"].get("properties", {})
            for entry in entries:
                key, value = entry.groups()
                if key in arguments or key not in properties:
                    raise ToolEnvelopeError("Parâmetro desconhecido ou repetido na chamada de ferramenta.")
                value = unescape(value.strip())
                if properties[key].get("type") in {"object", "array", "number", "integer", "boolean"}:
                    try:
                        value = json.loads(value)
                    except ValueError:
                        raise ToolEnvelopeError("Parâmetro tipado de ferramenta inválido.") from None
                arguments[key] = value
        else:
            try:
                data = json.loads(body)
                name, arguments = data["name"], data["arguments"]
                if isinstance(arguments, str):
                    arguments = json.loads(arguments)
            except (ValueError, TypeError, KeyError):
                raise ToolEnvelopeError("Envelope de ferramenta inválido.") from None
        if name not in allowed or not isinstance(arguments, dict):
            raise ToolEnvelopeError("Ferramenta não autorizada ou argumentos inválidos.")
        calls.append(
            {
                "id": "call_" + uuid4().hex,
                "type": "function",
                "function": {"name": name, "arguments": json.dumps(arguments)},
            }
        )
    return {"role": "assistant", "content": "", "tool_calls": calls}
