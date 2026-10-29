import { useEffect, useRef, useState } from "react";
import { CustomSearchSelect, CustomSelect } from "@plane/ui";
import type { CustomField, FieldValue, SelectOption } from "./service";
import { fieldInputClass } from "./service";
import { optionBadgeStyle } from "./option-colors";
import { selectionValues } from "./selection-values";
import { RelativeDate } from "@/components/dates/relative-date";
import { DateDropdown } from "@/components/dropdowns/date";
import { renderFormattedPayloadDate } from "@plane/utils";
import { LongTextInput } from "./long-text-input";
import { phoneDisplay, plainNumber, safeSite } from "./text-values";
import { DateTimeFieldInput } from "./date-time-input";
import { dateTimeParts } from "./date-time-value";

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
  if (field.kind === "datetime" && typeof value === "string" && value) {
    const { date, time } = dateTimeParts(value);
    return (
      <span>
        <RelativeDate value={date} />
        {time && <span className="ml-1 tabular-nums">· {time}</span>}
      </span>
    );
  }
  if (field.kind === "site" && safeSite(value))
    return (
      <a
        href={safeSite(value)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent-primary underline"
        onClick={(event) => event.stopPropagation()}
      >
        {String(value)}
      </a>
    );
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
  appearance = "form",
}: {
  field: CustomField;
  value: FieldValue | undefined;
  onChange: (value: FieldValue) => void;
  disabled?: boolean;
  immediate?: boolean;
  appearance?: "form" | "inline";
}) {
  const inline = appearance === "inline";
  const inputClass = inline
    ? "min-h-11 min-w-0 rounded border-0 bg-transparent px-1.5 py-1 text-base text-primary shadow-none outline-none placeholder:text-tertiary hover:bg-transparent focus:bg-transparent focus-visible:ring-1 focus-visible:ring-accent-strong disabled:cursor-default disabled:opacity-50 md:min-h-0 md:text-13"
    : fieldInputClass;
  const textValue =
    field.kind === "number"
      ? plainNumber(value)
      : field.kind === "phone" && value
        ? phoneDisplay(String(value))
        : value == null
          ? ""
          : String(value);
  const [draft, setDraft] = useState(textValue);
  const [siteEditing, setSiteEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (siteEditing) inputRef.current?.focus();
  }, [siteEditing]);
  useEffect(() => {
    setDraft(textValue);
  }, [textValue]);
  if (field.kind === "long_text")
    return (
      <LongTextInput
        name={field.name}
        value={value}
        disabled={disabled}
        immediate={immediate}
        inline={inline}
        inputClass={inputClass}
        onChange={onChange}
      />
    );
  if (field.kind === "site" && inline && !siteEditing)
    return (
      <div className="flex w-full min-w-0 items-center gap-2">
        {safeSite(value) ? (
          <a
            href={safeSite(value)}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 truncate text-accent-primary underline"
            onClick={(event) => event.stopPropagation()}
          >
            {String(value)}
          </a>
        ) : (
          <span className="truncate">{textValue || "—"}</span>
        )}
        {!disabled && (
          <button
            type="button"
            aria-label={`Editar ${field.name}`}
            className="min-h-11 shrink-0 px-2 text-13 text-secondary md:min-h-0 md:px-0 md:text-11"
            onClick={() => setSiteEditing(true)}
          >
            Editar
          </button>
        )}
      </div>
    );
  if (field.kind === "multiselect") {
    const selected = selectionValues(field, value);
    return (
      <CustomSearchSelect
        multiple
        className="w-full"
        buttonClassName={`${inputClass} min-h-11 w-full md:min-h-8`}
        noChevron={inline}
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
          <span className={`flex min-w-0 gap-1 ${inline ? "items-center overflow-hidden" : "flex-wrap"}`}>
            <span className="sr-only">{field.name}: </span>
            {selected.length ? (
              <FieldDisplay field={field} value={selected} />
            ) : (
              <span className="text-tertiary">{inline ? "—" : "Selecionar opções"}</span>
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
        buttonClassName={`${inputClass} min-h-11 w-full md:min-h-8`}
        noChevron={inline}
        optionsClassName="z-[100]"
        value={value ?? ""}
        disabled={disabled}
        onChange={(next: string) => onChange(next || null)}
        label={
          <>
            <span className="sr-only">{field.name}: </span>
            {selected ? (
              <OptionBadge option={selected} />
            ) : (
              <span className="text-tertiary">{inline ? "—" : "Sem valor"}</span>
            )}
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
    if (inline)
      return (
        <CustomSelect
          className="w-full"
          buttonClassName={`${inputClass} min-h-11 w-full md:min-h-8`}
          optionsClassName="z-[100]"
          noChevron
          disabled={disabled}
          value={value == null ? "" : String(value)}
          onChange={(next: string) => onChange(next === "" ? null : next === "true")}
          label={
            <>
              <span className="sr-only">{field.name}: </span>
              <span className={value == null ? "text-tertiary" : ""}>{displayValue(field, value)}</span>
            </>
          }
        >
          <CustomSelect.Option value="">Sem valor</CustomSelect.Option>
          <CustomSelect.Option value="true">Sim</CustomSelect.Option>
          <CustomSelect.Option value="false">Não</CustomSelect.Option>
        </CustomSelect>
      );
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
  if (field.kind === "datetime")
    return (
      <DateTimeFieldInput
        name={field.name}
        value={value}
        disabled={disabled}
        immediate={immediate}
        inline={inline}
        inputClass={inputClass}
        onChange={onChange}
      />
    );
  if (field.kind === "date") {
    return (
      <DateDropdown
        ariaLabel={field.name}
        value={typeof value === "string" ? value : null}
        onChange={(date) => onChange(date ? (renderFormattedPayloadDate(date) ?? null) : null)}
        disabled={disabled}
        placeholder={inline ? "—" : field.name}
        buttonVariant="transparent-with-text"
        buttonContainerClassName="w-full"
        buttonClassName={`${inputClass} min-h-8 w-full`}
        optionsClassName="z-[100]"
        showTooltip
      />
    );
  }
  const input = (
    <input
      aria-label={field.name}
      className={`${inputClass} w-full`}
      placeholder={inline ? "—" : undefined}
      disabled={disabled}
      ref={inputRef}
      type={field.kind === "phone" ? "tel" : field.kind === "url" ? "url" : "text"}
      inputMode={field.kind === "number" ? "decimal" : undefined}
      maxLength={field.kind === "site" ? 2000 : 10000}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (immediate) onChange(e.target.value || null);
      }}
      onBlur={() => {
        if (field.kind === "phone") setDraft(phoneDisplay(draft));
        if (!immediate && draft !== textValue) onChange(draft || null);
        if (field.kind === "site") setSiteEditing(false);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          setDraft(textValue);
        }
      }}
    />
  );
  if (field.kind === "site")
    return (
      <div className="flex min-w-0 items-center gap-1">
        {safeSite(value) && (
          <a
            href={safeSite(value)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Abrir ${field.name} em nova aba`}
            title={String(value)}
            className="shrink-0 text-accent-primary underline"
            onClick={(event) => event.stopPropagation()}
          >
            Abrir ↗
          </a>
        )}
        {input}
      </div>
    );
  return input;
}

export function displayValue(field: CustomField, value: FieldValue | undefined) {
  if (value === null || value === undefined) return "—";
  if (field.kind === "boolean") return value ? "Sim" : "Não";
  if (field.kind === "number") return plainNumber(value);
  if (field.kind === "phone") return phoneDisplay(String(value));
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
