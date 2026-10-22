import { useRef, useState, useEffect } from "react";
import { observer } from "mobx-react";
import { Pencil, ArrowUp, ArrowDown } from "lucide-react";
import type { IIssueDisplayProperties, TIssue } from "@plane/types";
import { SPREADSHEET_COLUMNS } from "@/components/issues/issue-layouts/utils";
import { NativeCustomCell } from "./native-layout";
import { ColumnResizeHandle, useTableColumnStyle } from "./table-column-widths";
import { useNativeList } from "./native-list-context";
import { fieldError } from "./service";
import { listGridStyle } from "./native-list-model";
import { ISSUE_DISPLAY_PROPERTIES } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { useNativeFieldsContext } from "./native-context";

export const NativeListHeaders = observer(function NativeListHeaders() {
  const list = useNativeList();
  const context = useNativeFieldsContext();
  const { t } = useTranslation();
  if (!list?.enabled) return null;
  const label = (key: string) => {
    if (key === "title") return "Tarefa";
    const field = context?.display.data?.fields.find((f) => "custom:" + f.id === key);
    if (field)
      return context?.display.request?.scope.startsWith("workspace")
        ? `${field.project_identifier} · ${field.name}`
        : field.name;
    const item = ISSUE_DISPLAY_PROPERTIES.find((p) => "standard:" + p.key === key);
    return item
      ? t(item.titleTranslationKey)
      : ({ "standard:created_on": "Criado em", "standard:updated_on": "Atualizado em" }[key] ?? key.slice(9));
  };
  return (
    <div
      role="row"
      className="sticky top-0 z-20 border-b border-subtle bg-layer-1 text-13"
      style={listGridStyle(list.columns)}
    >
      {list.columns.map((key) => (
        <div
          key={key}
          role="columnheader"
          className="relative min-w-0 truncate border-r border-subtle px-3 py-3 pr-4 font-medium"
          title={label(key)}
        >
          {label(key)}
          <ColumnResizeHandle columnKey={key} label={label(key)} />
        </div>
      ))}
    </div>
  );
});

const StandardCell = observer(function StandardCell({
  property,
  issue,
  disabled,
}: {
  property: keyof IIssueDisplayProperties;
  issue: TIssue;
  disabled: boolean;
}) {
  const list = useNativeList();
  const ref = useRef<HTMLDivElement>(null);
  const style = useTableColumnStyle("standard:" + property);
  const [error, setError] = useState("");
  const Column = SPREADSHEET_COLUMNS[property];
  if (!Column || !list) return null;
  return (
    <div
      role="gridcell"
      ref={ref}
      tabIndex={0}
      data-list-column={"standard:" + property}
      style={style}
      className="relative h-11 min-w-0 border-r border-subtle text-13"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) event.stopPropagation();
      }}
    >
      <Column
        issue={issue}
        disabled={disabled}
        onClose={() => ref.current?.focus()}
        onChange={async (_, data) => {
          setError("");
          try {
            await list.updateIssue(issue.project_id, issue.id, data);
          } catch (failure) {
            setError(fieldError(failure));
          }
        }}
      />
      {error && (
        <span
          role="alert"
          className="absolute inset-x-0 bottom-0 z-10 bg-surface-1 text-11 text-danger-primary"
          title={error}
        >
          {error}
        </span>
      )}
    </div>
  );
});

export const NativeListCells = observer(function NativeListCells({
  issue,
  disabled,
}: {
  issue: TIssue;
  disabled: boolean;
}) {
  const list = useNativeList();
  if (!list?.enabled) return null;
  return (
    <>
      {list.columns
        .filter((key) => key !== "title")
        .map((key) =>
          key.startsWith("custom:") ? (
            <NativeCustomCell key={key} as="div" issueId={issue.id} fieldId={key.slice(7)} disabled={disabled} />
          ) : (
            <StandardCell
              key={key}
              property={key.slice(9) as keyof IIssueDisplayProperties}
              issue={issue}
              disabled={disabled}
            />
          )
        )}
    </>
  );
});

export function NativeListRename({ issue, group }: { issue: TIssue; group: string }) {
  const list = useNativeList();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(issue.name);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);
  const save = async () => {
    if (busy.current || !list) return;
    if (!draft.trim() || draft.trim() === issue.name) {
      setEditing(false);
      return;
    }
    busy.current = true;
    setError("");
    try {
      await list.updateIssue(issue.project_id, issue.id, { name: draft.trim() });
      setEditing(false);
    } catch (failure) {
      setError(fieldError(failure));
    } finally {
      busy.current = false;
    }
  };
  return (
    <span className="flex shrink-0 items-center gap-1">
      {editing ? (
        <input
          aria-label="Renomear tarefa"
          className="w-40 rounded border border-subtle bg-surface-1 px-1"
          ref={inputRef}
          maxLength={255}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
              setDraft(issue.name);
            }
          }}
        />
      ) : (
        <button
          aria-label={`Renomear ${issue.name}`}
          type="button"
          onClick={() => {
            setDraft(issue.name);
            setEditing(true);
          }}
        >
          <Pencil size={12} />
        </button>
      )}
      {list?.canReorder && (
        <>
          <button
            type="button"
            aria-label={`Mover ${issue.name} para cima`}
            onClick={() => list.moveRow(group, issue.id, -1)}
          >
            <ArrowUp size={12} />
          </button>
          <button
            type="button"
            aria-label={`Mover ${issue.name} para baixo`}
            onClick={() => list.moveRow(group, issue.id, 1)}
          >
            <ArrowDown size={12} />
          </button>
        </>
      )}
      {error && (
        <span role="alert" className="text-11 text-danger-primary" title={error}>
          Falha
        </span>
      )}
    </span>
  );
}
