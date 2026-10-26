"""A source-linked customer dossier; suggestions never overwrite business records."""

import hashlib
import math
import re
import unicodedata
from datetime import date


def fold(value):
    return "".join(c for c in unicodedata.normalize("NFKD", str(value).lower()) if not unicodedata.combining(c))


def estimated_tokens(value):
    """Tokenizer-independent estimate with explicit margin, not an exact model token count."""
    text = value if isinstance(value, str) else str(value)
    pieces = re.findall(r"\w+|[^\w\s]", text, re.UNICODE)
    lexical = sum(max(1, math.ceil(len(piece.encode("utf-8")) / 4)) for piece in pieces)
    return max(math.ceil(len(text.encode("utf-8")) / 3), lexical)


def date_mentions(text):
    result = []
    for match in re.finditer(r"(?<!\d)(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})/(\d{1,2})(?:/(\d{4}|\d{2}))?)(?!\d)", text):
        year, month, day = (match[1], match[2], match[3]) if match[1] else (match[6], match[5], match[4])
        iso = None
        if year and len(year) == 4:
            try:
                iso = date(int(year), int(month), int(day)).isoformat()
            except ValueError:
                continue
        elif not (1 <= int(month) <= 12 and 1 <= int(day) <= 31):
            continue
        excerpt = text[max(0, match.start() - 110) : min(len(text), match.end() + 150)]
        boundaries = [text.rfind(separator, 0, match.start()) for separator in [". ", ";", "\n"]]
        start = max(boundaries) + 1
        ends = [value for separator in [". ", ";", "\n"] if (value := text.find(separator, match.end())) >= 0]
        clause = text[start : min(ends) if ends else len(text)]
        normalized = fold(clause)
        kind = "mentioned_date"
        if any(word in normalized for word in ["proximo contato", "previsto", "agendad", "vencimento", "prazo"]):
            kind = "planned_date"
        elif any(word in normalized for word in ["migrad", "importad", "migracao", "importacao"]):
            kind = "import_date"
        result.append(
            {
                "raw": match[0],
                "iso": iso,
                "precision": "full_date" if iso else "day_month_or_short_year",
                "kind": kind,
                "offset": match.start(),
                "excerpt": excerpt,
            }
        )
    return result


def claim_kind(text):
    value = fold(text)
    if "?" in value or re.search(r"\b(verificar|confirmar|checar)\s+se\b", value):
        return "question_or_verification"
    if re.search(r"\b(aguardando|previsto|devera|vai entrar|a realizar|pendente)\b", value):
        return "pending_or_planned"
    if re.search(
        r"\b(realizad[oa]s?|concluid[oa]s?|finalizad[oa]s?|encerrad[oa]s?|enviad[oa]s?|assumiu|protocolad[oa]s?)\b",
        value,
    ):
        if re.search(r"\b(nao|ainda nao)\s+(?:foi\s+)?(?:realizad|concluid|finalizad|encerrad)", value):
            return "not_completed"
        return "assertion_to_verify"
    return "recorded_information"


BUSINESS_KEYS = {
    "proximo contato": "next_contact",
    "etapa atual": "onboarding_stage",
    "etapa do onboarding": "onboarding_stage",
    "etapa": "onboarding_stage",
    "situacao do onboarding": "onboarding_health",
    "status do onboarding": "onboarding_health",
    "cs responsavel": "customer_success_owner",
    "inicio dos servicos": "service_start",
    "codigo do cliente": "customer_code",
}


def business_key(label):
    return BUSINESS_KEYS.get(fold(label).strip(" :"))


def build_dossier(context):
    sources, fields, mentions, claims = [], [], [], []

    def register(kind, identifier, title, text, recorded_at=None, external_source=None, original_chars=None, url=None):
        source_id = f"{kind}:{identifier}"
        entry = {
            "source_id": source_id,
            "kind": kind,
            "id": identifier,
            "title": title,
            "text": text,
            "recorded_at": recorded_at,
            "external_source": external_source,
            "url": url,
            "original_chars": original_chars if original_chars is not None else len(text),
        }
        sources.append(entry)
        dates = date_mentions(text)
        mentions.extend({**item, "source_id": source_id} for item in dates)
        for sentence in re.split(r"\n+|(?<=[.!?])\s+", text):
            if len(sentence.strip()) < 8:
                continue
            claim = {"text": sentence.strip(), "kind": claim_kind(sentence), "source_id": source_id}
            if claim["kind"] != "recorded_information" or date_mentions(sentence):
                claims.append(claim)
        for match in re.finditer(
            r"(?im)(pr[oó]ximo contato|etapa(?: atual| do onboarding)?|situa[cç][aã]o do onboarding|"
            r"status do onboarding|cs respons[aá]vel|in[ií]cio dos servi[cç]os|c[oó]digo do cliente)"
            r"\s*[:\-]\s*([^\n;]+)",
            text,
        ):
            fields.append(
                {
                    "key": business_key(match[1]),
                    "label": match[1],
                    "value": match[2].strip(),
                    "source_id": source_id,
                    "basis": "text_statement",
                    "assertion_kind": claim_kind(match[0]),
                    "recorded_at": recorded_at,
                    "recorded_at_meaning": "technical source/import timestamp, not necessarily the event date",
                }
            )

    operational = []
    for issue in context["issues"]:
        register(
            "issue",
            issue["id"],
            issue["title"],
            issue.get("description", ""),
            issue.get("updated_at"),
            issue.get("external_source"),
            issue.get("description_original_chars"),
            issue.get("url"),
        )
        for field in issue.get("named_fields", []):
            fields.append(
                {
                    "key": business_key(field["name"]),
                    "label": field["name"],
                    "value": field["display_value"],
                    "source_id": f"issue:{issue['id']}",
                    "basis": "structured_field",
                    "assertion_kind": "stored_field_not_event",
                    "field_id": field["id"],
                    "recorded_at": issue.get("updated_at"),
                    "recorded_at_meaning": "task update time; individual field change time is unknown",
                }
            )
        operational.append(
            {
                "source_id": f"issue:{issue['id']}",
                "state": issue["state"],
                "state_group": issue.get("state_group"),
                "due": issue["due"],
                "native_assignees": issue["assignees"],
                "labels": issue["labels"],
                "record_created_at": issue.get("created_at"),
                "external_source": issue.get("external_source"),
            }
        )
    for comment in context["comments"]:
        register(
            "comment",
            comment["id"],
            f"Comentário · {comment.get('actor__display_name') or 'autor não informado'} "
            f"· registro em {str(comment['created_at'])[:10]}",
            comment["comment_stripped"],
            comment["created_at"],
            comment.get("external_source"),
            comment.get("original_chars"),
            next((issue["url"] for issue in context["issues"] if issue["id"] == str(comment["issue_id"])), None),
        )
    for page in context["pages"]:
        register(
            "page",
            page["id"],
            page["title"],
            "" if context.get("final_report") and page.get("evidence_role") == "derived_report" else page["text"],
            page.get("updated_at"),
            page.get("external_source"),
            page.get("original_chars"),
            page.get("url"),
        )
        if context.get("final_report") and page.get("evidence_role") == "derived_report":
            sources[-1]["evidence_role"] = "derived_report"
    conflicts = []
    for item in fields:
        dates = date_mentions(str(item["value"])) if item["key"] in {"next_contact", "service_start"} else []
        item["normalized_value"] = dates[0]["iso"] if dates and dates[0]["iso"] else fold(item["value"])
    for key in sorted({item["key"] for item in fields if item["key"]}):
        candidates = [item for item in fields if item["key"] == key and item["value"] not in (None, "", [])]
        if len({item["normalized_value"] for item in candidates}) > 1:
            conflicts.append(
                {
                    "field": key,
                    "candidates": candidates,
                    "resolution": "Compare the evidence and original business dates; do not silently select a value.",
                }
            )
    completion_claims = [
        item
        for item in claims
        if item["kind"] == "assertion_to_verify"
        and re.search(r"\b(implantacao|onboarding|entrada(?: do cliente)?)\b", fold(item["text"]))
    ]
    if completion_claims and any(item["state_group"] and item["state_group"] != "completed" for item in operational):
        conflicts.append(
            {
                "field": "business_completion_vs_task_state",
                "claims": completion_claims,
                "resolution": (
                    "Task state and business completion are separate. "
                    "A certification being completed alone does not prove onboarding completion."
                ),
            }
        )
    chunks = []
    for source in sources:
        if source.get("evidence_role") == "derived_report":
            continue
        text = source["text"]
        for offset in range(0, len(text), 1300):
            excerpt = text[offset : offset + 1450]
            normalized = fold(excerpt)
            score = sum(
                word in normalized
                for word in [
                    "finaliz",
                    "conclu",
                    "pendenc",
                    "certific",
                    "contrat",
                    "proximo contato",
                    "departamento",
                    "servico",
                    "cnpj",
                    "reuniao",
                ]
            )
            chunks.append(
                {
                    "id": f"{source['source_id']}:{offset}",
                    "source_id": source["source_id"],
                    "offset": offset,
                    "text": excerpt,
                    "priority": score + (3 if date_mentions(excerpt) else 0) + (2 if offset == 0 else 0),
                }
            )
            if offset + 1450 >= len(text):
                break
    return {
        "customer": context.get("focus", {}).get("subject"),
        "business_fields": fields,
        "date_mentions": mentions,
        "claims": claims,
        "conflicts": conflicts,
        "operational_records": operational,
        "evidence": chunks,
        "source_inventory": [{key: value for key, value in source.items() if key != "text"} for source in sources],
        "rules": [
            "Import/creation timestamps are technical dates, not the onboarding period.",
            "Newer questions do not prove completion. Reconcile explicit assertions with original event dates.",
            "Native assignees and labels do not define the CS owner or departmental role without evidence.",
            "Operational task completion percent is not business onboarding completion percent.",
            "A native task start_date is not automatically the service start or the onboarding start; "
            "use explicit business labels and milestones.",
        ],
    }


def evidence_manifest(dossier, supplied):
    supplied_ids = {item["id"] for item in supplied}
    entries = []
    for source in dossier["source_inventory"]:
        chunks = [item for item in dossier["evidence"] if item["source_id"] == source["source_id"]]
        selected = [item for item in chunks if item["id"] in supplied_ids]
        covered = 0
        for item in sorted(selected, key=lambda entry: entry["offset"]):
            if item["offset"] > covered:
                break
            covered = max(covered, item["offset"] + len(item["text"]))
        entries.append(
            {
                **source,
                "retrieved_chunks": len(chunks),
                "supplied_chunks": len(selected),
                "supplied_ranges": [
                    {
                        "start": item["offset"],
                        "end": item["offset"] + len(item["text"]),
                        "sha256": hashlib.sha256(item["text"].encode()).hexdigest(),
                    }
                    for item in selected
                ],
                "complete": covered >= source["original_chars"],
                "excluded_reason": "previous_ai_report_not_primary_evidence"
                if source.get("evidence_role") == "derived_report"
                else None,
            }
        )
    return entries


def supplied_sources(run):
    manifest = run.context_summary.get("evidence_audit", {}).get("sources", [])
    if not manifest:
        return run.sources
    indexed = {item["source_id"]: item for item in manifest}
    result = []
    for source in run.sources:
        item = indexed.get(f"{source['kind']}:{source['id']}")
        if item:
            if item.get("excluded_reason"):
                continue
            result.append(
                {
                    **source,
                    "title": item["title"] if source["kind"] == "comment" else source["title"],
                    "coverage": {"complete": item["complete"], "supplied_chunks": item["supplied_chunks"]},
                }
            )
        elif source["kind"] == "project":
            result.append(source)
    return result
