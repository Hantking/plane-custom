"""Completion bounds and structural checks for final executive reports."""

import json
import re
import unicodedata
import time

from .evidence import estimated_tokens
from .providers import ProviderError, ToolProtocolError, Cancelled

SECTIONS = [
    ("Resumo executivo", ["resumo executivo"]),
    ("Dados do cliente", ["dados do cliente", "perfil do cliente"]),
    (
        "Serviços e condições comerciais",
        ["servicos e condicoes comerciais", "condicoes comerciais", "servicos contratados"],
    ),
    ("Estrutura de atendimento", ["estrutura de atendimento", "equipe e responsabilidades"]),
    ("Linha do tempo", ["linha do tempo", "cronologia da implantacao"]),
    ("Entregas concluídas", ["entregas concluidas"]),
    ("Situação por responsável/departamento", ["situacao por responsavel", "situacao por departamento"]),
    ("Pendências e próximos passos", ["pendencias e proximos passos"]),
    ("Conclusão e divergências cadastrais", ["conclusao e divergencias", "conclusao"]),
]


def is_final_report(prompt, focus):
    text = fold(prompt)
    return bool(focus and re.search(r"\b(resumo final|relatorio final|final report)\b", text))


def fold(text):
    return "".join(c for c in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(c))


def executive_instructions():
    headings = "\n".join(f"## {index + 1}. {name}" for index, (name, _) in enumerate(SECTIONS))
    return (
        "\nFINAL EXECUTIVE REPORT: use the following nine Markdown sections in Portuguese, with content in each. "
        "If a field is not documented, write 'Não informado nas fontes'. Cite source URLs. "
        "Start with the client's business outcome, deliveries and outstanding actions. "
        "Do not start with SQL metrics, technical scope, import timestamps or task percentages. "
        "Task state/overdue and business onboarding completion are different dimensions. "
        "A task remaining open does not mean 0% of onboarding completed. "
        "Do not call native assignees the CS owner without a business-field/source explicitly saying so. "
        "Reconcile conflicting candidates using explicit assertions and business event dates; "
        "a later question or an import timestamp never proves completion. "
        "Do not silently override unresolved fields. Describe the discrepancy and cite both sources.\n" + headings
    )


def executive_problems(text):
    headings = list(re.finditer(r"(?m)^#{1,6}\s+(.+?)\s*$", text))
    missing = []
    for name, aliases in SECTIONS:
        valid = False
        for index, heading in enumerate(headings):
            label = fold(re.sub(r"^\d+[.)]?\s*", "", heading[1])).strip()
            end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
            if any(label.startswith(alias) for alias in aliases) and text[heading.end() : end].strip():
                valid = True
                break
        if not valid:
            missing.append(name)
    if text.count("```") % 2:
        missing.append("bloco de código não concluído")
    last = text.rstrip().splitlines()[-1] if text.strip() else ""
    if last.lstrip().startswith("|") and not last.rstrip().endswith("|"):
        missing.append("linha de tabela interrompida")
    ending = re.sub(r"[*_`]+$", "", last.rstrip())
    if ending and ending[-1] not in ".!?)]|":
        missing.append("conclusão sem término de frase")
    return missing


def join_continuation(prefix, suffix):
    last_line = prefix.rsplit("\n", 1)[-1]
    restarted = suffix.lstrip("\n")
    if last_line.startswith("|") and not last_line.endswith("|") and restarted.startswith(last_line):
        return prefix[: -len(last_line)] + restarted
    for length in range(min(len(prefix), len(suffix), 3000), 19, -1):
        if prefix[-length:] == suffix[:length]:
            return prefix + suffix[length:]
    return prefix + suffix


def request_tokens(messages, schemas=None):
    # The model receives message contents, not the HTTP JSON's double-escaped strings.
    total = 8 + estimated_tokens(json.dumps(schemas or [], ensure_ascii=False))
    for message in messages:
        total += 8 + estimated_tokens(message.get("content") or "")
        if message.get("tool_calls"):
            total += estimated_tokens(json.dumps(message["tool_calls"], ensure_ascii=False))
    return total


class GenerationSession:
    def __init__(self, run, revalidate, cancelled, on_delta):
        self.run, self.revalidate, self.cancelled, self.on_delta = run, revalidate, cancelled, on_delta
        self.audit = {"complete": False, "calls": 0, "continuations": 0, "segments": [], "token_estimate_exact": False}
        self.started = time.monotonic()
        run.context_summary["generation"] = self.audit

    def _request(self, provider, messages, schemas, delta):
        if self.cancelled():
            raise Cancelled()
        self.revalidate()
        if self.audit["calls"] >= 8:
            raise ProviderError("Limite de geração/continuação atingido. Nenhuma página incompleta foi publicada.")
        if time.monotonic() - self.started + self.run.connection.timeout_seconds > 880:
            raise ProviderError(
                "Tempo disponível insuficiente para concluir o relatório. Nenhuma página incompleta foi publicada."
            )
        estimated = request_tokens(messages, schemas)
        if estimated + self.run.connection.output_tokens + 300 > int(self.run.connection.context_tokens * 0.92):
            raise ProviderError(
                "Janela de contexto insuficiente para concluir o relatório. Aumente o contexto ou refine o escopo."
            )
        self.audit["calls"] += 1
        message, usage = provider.complete(self.run.model, messages, schemas, delta, self.cancelled)
        self.revalidate()
        for key, value in usage.items():
            self.run.usage[key] = self.run.usage.get(key, 0) + value
        reason = message.pop("_finish_reason", None)
        self.audit["segments"].append(
            {
                "finish_reason": reason or "not_reported",
                "estimated_input_tokens": estimated,
                "output_limit": self.run.connection.output_tokens,
            }
        )
        self.run.save(update_fields=["context_summary", "usage", "updated_at"])
        if reason in {"content_filter", "refusal"}:
            raise ProviderError("O provedor interrompeu a geração. Nenhum relatório final foi publicado.")
        return message, reason

    def complete(self, provider, messages, schemas=None):
        message, reason = self._request(provider, messages, schemas, self.on_delta)
        text = message.get("content") or ""
        self.run.response = text
        while reason in {"length", "max_tokens", "max_output_tokens"}:
            if message.get("tool_calls") or "<tool_call" in text:
                raise ToolProtocolError("O provedor cortou uma chamada de ferramenta; ela não foi executada.")
            if self.audit["continuations"] >= 3:
                raise ProviderError(
                    "O relatório foi cortado pelo limite de saída. Nenhuma página incompleta foi publicada."
                )
            self.audit["continuations"] += 1
            self.run.context_summary["activity"] = "Continuando o relatório após o limite de saída…"
            self.run.save(update_fields=["context_summary", "updated_at"])
            continuation = [
                *messages,
                {"role": "assistant", "content": text},
                {
                    "role": "user",
                    "content": (
                        "Continue exatamente de onde parou, inclusive tabelas/palavras cortadas. "
                        "Não repita o texto anterior. Conclua todas as seções; "
                        "não execute ferramentas nesta continuação."
                    ),
                },
            ]
            prefix = text
            message, reason = self._request(
                provider, continuation, None, lambda partial: self.on_delta(join_continuation(prefix, partial))
            )
            if message.get("tool_calls"):
                raise ProviderError("A continuação deve concluir o texto, sem executar novas ferramentas.")
            text = join_continuation(text, message.get("content") or "")
            self.run.response = text
            message = {**message, "content": text}
        return message
