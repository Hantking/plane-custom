import { useEffect, useState } from "react";
import type { CustomField, FieldValue } from "./service";
import { fieldInputClass } from "./service";

export function FieldInput({
  field,
  value,
  onChange,
  disabled = false,
  immediate = false,
}: {
  field: CustomField;
  value: FieldValue | undefined;
  onChange: (value: FieldValue) => void;
  disabled?: boolean;
  immediate?: boolean;
}) {
  const [draft, setDraft] = useState(value === null || value === undefined ? "" : String(value));
  useEffect(() => {
    setDraft(value === null || value === undefined ? "" : String(value));
  }, [value]);
  if (field.kind === "boolean" || field.kind === "select") {
    return (
      <select
        aria-label={field.name}
        className={`${fieldInputClass} w-full`}
        disabled={disabled}
        value={value == null ? "" : String(value)}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : field.kind === "boolean" ? e.target.value === "true" : e.target.value)
        }
      >
        <option value="">Sem valor</option>
        {field.kind === "boolean" ? (
          <>
            <option value="true">Sim</option>
            <option value="false">Não</option>
          </>
        ) : (
          field.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))
        )}
      </select>
    );
  }
  return (
    <input
      aria-label={field.name}
      className={`${fieldInputClass} w-full`}
      disabled={disabled}
      type={field.kind === "date" ? "date" : field.kind === "number" ? "number" : field.kind === "url" ? "url" : "text"}
      step={field.kind === "number" ? "0.000001" : undefined}
      maxLength={10000}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (immediate) onChange(e.target.value || null);
      }}
      onBlur={() => {
        if (!immediate && draft !== (value == null ? "" : String(value))) onChange(draft || null);
      }}
    />
  );
}

export function displayValue(field: CustomField, value: FieldValue | undefined) {
  if (value === null || value === undefined) return "—";
  if (field.kind === "boolean") return value ? "Sim" : "Não";
  if (field.kind === "select") return field.options.find((option) => option.id === value)?.label ?? "—";
  return String(value);
}
