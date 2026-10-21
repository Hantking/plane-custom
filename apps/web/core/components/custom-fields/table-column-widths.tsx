import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { useNativeFieldsContext } from "./native-context";
import { nativeDisplayService } from "./native-service";
import { fieldError } from "./service";
import {
  clampColumnWidth,
  columnWidthVariable,
  defaultColumnWidth,
  MAX_COLUMN_WIDTH,
  minimumColumnWidth,
  resizedColumnWidth,
  savedColumnWidth,
} from "./column-width-helpers";

type WidthsContext = {
  enabled: boolean;
  saving: boolean;
  width: (key: string) => number;
  preview: (key: string, width: number | null) => void;
  save: (key: string, width: number | null) => Promise<void>;
};
const ColumnWidthsContext = createContext<WidthsContext | null>(null);

export function TableColumnWidthsProvider({ columns, children }: { columns: string[]; children: ReactNode }) {
  const native = useNativeFieldsContext();
  return (
    <ColumnWidthsState key={native?.display.identity ?? "unsupported"} native={native} columns={columns}>
      {children}
    </ColumnWidthsState>
  );
}

function ColumnWidthsState({
  native,
  columns,
  children,
}: {
  native: ReturnType<typeof useNativeFieldsContext>;
  columns: string[];
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  const previews = useRef<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const widths = native?.display.data?.preference.widths;
  const enabled = !!native?.display.request && !!native.display.data && native.layout === "spreadsheet";
  const width = useCallback((key: string) => previews.current[key] ?? savedColumnWidth(key, widths), [widths]);
  const preview = useCallback(
    (key: string, value: number | null) => {
      if (value === null) delete previews.current[key];
      else previews.current[key] = clampColumnWidth(key, value);
      root.current?.style.setProperty(columnWidthVariable(key), `${width(key)}px`);
      root.current?.style.setProperty(
        "--hentis-table-width",
        `${columns.reduce((sum, property) => sum + width(property), 0)}px`
      );
    },
    [columns, width]
  );
  const save = useCallback(
    async (key: string, value: number | null) => {
      if (!enabled || !native?.display.request) return;
      preview(key, value === null ? defaultColumnWidth(key) : value);
      setSaving(true);
      setError("");
      try {
        const data = await nativeDisplayService.resizeColumn(
          native.display.workspace,
          native.display.request,
          key,
          value === null ? null : clampColumnWidth(key, value)
        );
        await native.display.mutate(data, { revalidate: false });
      } catch (failure) {
        setError(fieldError(failure));
      } finally {
        delete previews.current[key];
        setSaving(false);
      }
    },
    [enabled, native, preview]
  );
  const context = useMemo(() => ({ enabled, saving, width, preview, save }), [enabled, saving, width, preview, save]);
  const variables: Record<string, string> = {
    "--hentis-table-width": `${columns.reduce((sum, key) => sum + width(key), 0)}px`,
  };
  for (const key of columns) variables[columnWidthVariable(key)] = `${width(key)}px`;
  return (
    <ColumnWidthsContext.Provider value={context}>
      <div ref={root} className="contents" style={variables as CSSProperties}>
        {error && (
          <p role="alert" className="text-red-600 p-2 text-13">
            Não foi possível salvar a largura: {error}
          </p>
        )}
        {children}
      </div>
    </ColumnWidthsContext.Provider>
  );
}

export function useTableColumnStyle(key: string): CSSProperties | undefined {
  const context = useContext(ColumnWidthsContext);
  if (!context?.enabled) return undefined;
  const size = `var(${columnWidthVariable(key)}, ${defaultColumnWidth(key)}px)`;
  return { width: size, minWidth: size, maxWidth: size, overflow: "hidden" };
}

type Drag = { pointer: number; x: number; initial: number; current: number; cursor: string; selection: string };

export function ColumnResizeHandle({ columnKey, label }: { columnKey: string; label: string }) {
  const context = useContext(ColumnWidthsContext);
  const drag = useRef<Drag | null>(null);
  useEffect(
    () => () => {
      if (drag.current) {
        document.body.style.cursor = drag.current.cursor;
        document.body.style.userSelect = drag.current.selection;
      }
    },
    []
  );
  if (!context?.enabled) return null;
  const restore = () => {
    if (drag.current) {
      document.body.style.cursor = drag.current.cursor;
      document.body.style.userSelect = drag.current.selection;
    }
    drag.current = null;
  };
  const cancel = () => {
    if (drag.current) {
      context.preview(columnKey, null);
      restore();
    }
  };
  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (context.saving || event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    event.stopPropagation();
    const initial = clampColumnWidth(
      columnKey,
      event.currentTarget.closest("th")?.getBoundingClientRect().width ?? context.width(columnKey)
    );
    drag.current = {
      pointer: event.pointerId,
      x: event.clientX,
      initial,
      current: initial,
      cursor: document.body.style.cursor,
      selection: document.body.style.userSelect,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    active.current = resizedColumnWidth(columnKey, active.initial, active.x, event.clientX);
    context.preview(columnKey, active.current);
    event.currentTarget.setAttribute("aria-valuenow", String(active.current));
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    const value = active.current;
    restore();
    if (value !== active.initial) void context.save(columnKey, value);
    else context.preview(columnKey, null);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Largura da coluna ${label}`}
      aria-valuemin={minimumColumnWidth(columnKey)}
      aria-valuemax={MAX_COLUMN_WIDTH}
      aria-valuenow={context.width(columnKey)}
      aria-disabled={context.saving}
      tabIndex={context.saving ? -1 : 0}
      className="absolute inset-y-0 right-0 z-20 w-2.5 cursor-col-resize touch-none border-r-2 border-transparent select-none hover:border-accent-strong focus:border-accent-strong focus:outline-none"
      title={`Arraste para ajustar ${label}. Setas ajustam a largura; clique duplo restaura o tamanho padrão.`}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!context.saving) void context.save(columnKey, null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          cancel();
          return;
        }
        if (context.saving || !["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const delta = (event.shiftKey ? 50 : 10) * (event.key === "ArrowLeft" ? -1 : 1);
        void context.save(columnKey, event.key === "Home" ? null : context.width(columnKey) + delta);
      }}
    />
  );
}

export function TableWidthGroup({ columns }: { columns: string[] }) {
  const context = useContext(ColumnWidthsContext);
  if (!context?.enabled) return null;
  return (
    <colgroup>
      {columns.map((key) => (
        <col key={key} style={{ width: `var(${columnWidthVariable(key)}, ${defaultColumnWidth(key)}px)` }} />
      ))}
    </colgroup>
  );
}

export function useNativeTableWidthStyle(): CSSProperties | undefined {
  const context = useContext(ColumnWidthsContext);
  return context?.enabled ? { tableLayout: "fixed", width: "var(--hentis-table-width)" } : undefined;
}
