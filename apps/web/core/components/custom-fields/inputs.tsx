import { useEffect, useState } from "react";
import { CustomSelect } from "@plane/ui";
import type { CustomField, FieldValue, SelectOption } from "./service";
import { fieldInputClass } from "./service";
import { optionBadgeStyle } from "./option-colors";

export function OptionBadge({ option }: { option: SelectOption }) {
  return (
    <span
      className="inline-flex max-w-full items-center rounded px-2 py-0.5 text-12 font-medium"
      style={optionBadgeStyle(option)}
      title={option.label}
    >
      <span className="truncate">{option.label}</span>
    </span>
  );
}

export function FieldDisplay({ field, value }: { field: CustomField; value: FieldValue | undefined }) {
  const option = field.kind === "select" ? field.options.find((item) => item.id === value) : undefined;
  return option ? <OptionBadge option={option} /> : <>{displayValue(field, value)}</>;
}

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
  if (field.kind === "select") {
    const selected = field.options.find((option) => option.id === value);
    return (
      <CustomSelect
        className="w-full"
        buttonClassName={`${fieldInputClass} min-h-8 w-full`}
        optionsClassName="z-[100]"
        value={value ?? ""}
        disabled={disabled}
        onChange={(next: string) => onChange(next || null)}
        label={
          <>
            <span className="sr-only">{field.name}: </span>
            {selected ? <OptionBadge option={selected} /> : <span className="text-secondary">Sem valor</span>}
          </>
        }
      >
        <CustomSelect.Option value="">Sem valor</CustomSelect.Option>
        {field.options.map((option) => (
          <CustomSelect.Option key={option.id} value={option.id}>
            <OptionBadge option={option} />
          </CustomSelect.Option>
        ))}
      </CustomSelect>
    );
  }
  if (field.kind === "boolean") {
    return (
      <select
        aria-label={field.name}
        className={`${fieldInputClass} w-full`}
        disabled={disabled}
        value={value == null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "true")}
      >
        <option value="">Sem valor</option>
        <option value="true">Sim</option>
        <option value="false">Não</option>
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
