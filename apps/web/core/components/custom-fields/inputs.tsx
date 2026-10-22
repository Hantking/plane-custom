import { useEffect, useState } from "react";
import { CustomSearchSelect, CustomSelect } from "@plane/ui";
import type { CustomField, FieldValue, SelectOption } from "./service";
import { fieldInputClass } from "./service";
import { optionBadgeStyle } from "./option-colors";
import { selectionValues } from "./selection-values";
import { RelativeDate } from "@/components/dates/relative-date";
import { DateDropdown } from "@/components/dropdowns/date";
import { renderFormattedPayloadDate } from "@plane/utils";

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
  if (field.kind === "date" && typeof value === "string" && value) return <RelativeDate value={value} />;
  if (field.kind === "multiselect") {
    const selected = selectionValues(field, value);
    return selected.length ? (
      <span className="inline-flex flex-wrap gap-1">
        {field.options
          .filter((item) => selected.includes(item.id))
          .map((option) => (
            <OptionBadge key={option.id} option={option} />
          ))}
      </span>
    ) : (
      <>—</>
    );
  }
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
  if (field.kind === "multiselect") {
    const selected = selectionValues(field, value);
    return (
      <CustomSearchSelect
        multiple
        className="w-full"
        buttonClassName={`${fieldInputClass} min-h-8 w-full`}
        optionsClassName="z-[100]"
        value={selected}
        disabled={disabled}
        onChange={(keys: string[]) => onChange(selectionValues(field, keys))}
        options={field.options.map((option) => ({
          value: option.id,
          query: option.label,
          content: <OptionBadge option={option} />,
        }))}
        noResultsMessage="Nenhuma opção encontrada"
        label={
          <span className="flex flex-wrap gap-1">
            <span className="sr-only">{field.name}: </span>
            {selected.length ? (
              <FieldDisplay field={field} value={selected} />
            ) : (
              <span className="text-secondary">Selecionar opções</span>
            )}
          </span>
        }
        footerOption={
          <button
            type="button"
            disabled={disabled || !selected.length}
            className="mx-2 mt-2 text-13"
            onClick={() => onChange([])}
          >
            Limpar seleção
          </button>
        }
      />
    );
  }
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
  if (field.kind === "date") {
    return (
      <DateDropdown
        ariaLabel={field.name}
        value={typeof value === "string" ? value : null}
        onChange={(date) => onChange(date ? (renderFormattedPayloadDate(date) ?? null) : null)}
        disabled={disabled}
        placeholder={field.name}
        buttonVariant="transparent-with-text"
        buttonContainerClassName="w-full"
        buttonClassName={`${fieldInputClass} min-h-8 w-full`}
        optionsClassName="z-[100]"
        showTooltip
      />
    );
  }
  return (
    <input
      aria-label={field.name}
      className={`${fieldInputClass} w-full`}
      disabled={disabled}
      type={field.kind === "number" ? "number" : field.kind === "url" ? "url" : "text"}
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
  if (field.kind === "multiselect") {
    const selected = selectionValues(field, value);
    return (
      field.options
        .filter((option) => selected.includes(option.id))
        .map((option) => option.label)
        .join(", ") || "—"
    );
  }
  return String(value);
}
