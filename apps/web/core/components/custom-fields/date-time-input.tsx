import { useEffect, useRef, useState } from "react";
import { renderFormattedPayloadDate } from "@plane/utils";
import { DateDropdown } from "@/components/dropdowns/date";
import type { FieldValue } from "./service";
import { dateTimeParts, dateTimeValue } from "./date-time-value";

export function DateTimeFieldInput({
  name,
  value,
  disabled,
  immediate,
  inline,
  inputClass,
  onChange,
}: {
  name: string;
  value: FieldValue | undefined;
  disabled: boolean;
  immediate: boolean;
  inline: boolean;
  inputClass: string;
  onChange: (value: FieldValue) => void;
}) {
  const saved = typeof value === "string" ? value : null;
  const [draft, setDraft] = useState(saved);
  const latest = useRef(saved);
  const submitted = useRef(saved);
  useEffect(() => {
    setDraft(saved);
    latest.current = saved;
    submitted.current = saved;
  }, [saved]);
  const commit = (next: string | null) => {
    if (!disabled && next !== submitted.current) {
      submitted.current = next;
      onChange(next);
    }
  };
  const change = (next: string | null) => {
    latest.current = next;
    setDraft(next);
    if (immediate) commit(next);
  };
  const parts = dateTimeParts(draft);
  return (
    <DateDropdown
      ariaLabel={name}
      value={parts.date || null}
      timeValue={parts.time || null}
      showTimeZone={false}
      timeAriaLabel={`Horário de ${name}`}
      onChange={(date) => {
        const day = date ? (renderFormattedPayloadDate(date) ?? "") : "";
        const next = dateTimeValue(day, dateTimeParts(latest.current).time);
        change(next);
        if (!date) commit(null);
      }}
      onTimeChange={(time) => {
        const next = dateTimeValue(dateTimeParts(latest.current).date, time ?? "");
        change(next);
        commit(next);
      }}
      onClose={() => commit(latest.current)}
      disabled={disabled}
      placeholder={inline ? "—" : name}
      buttonVariant="transparent-with-text"
      buttonContainerClassName="w-full"
      buttonClassName={`${inputClass} min-h-8 w-full`}
      optionsClassName="z-[100]"
      showTooltip
    />
  );
}
