import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { observer } from "mobx-react";
import { useParams, usePathname } from "next/navigation";
import useSWR from "swr";
import { useUser } from "@/hooks/store/user/user-user";
import { FieldDisplay, FieldInput, displayValue } from "./inputs";
import { fieldError, fieldsService } from "./service";
import type { FieldValue } from "./service";
import { nativeDisplayService } from "./native-service";
import { NativeFieldsContext, useNativeFieldsContext } from "./native-context";
import type { Registration } from "./native-context";
import { ColumnResizeHandle, useTableColumnStyle } from "./table-column-widths";
export { useNativeFieldsContext } from "./native-context";
import {
  isWorkspaceNativeScope,
  nativeRequest,
  nativePropertyRank,
  orderedNativeProperties,
} from "./native-display-helpers";
import type { NativeLayout } from "./native-display-helpers";

export function useNativeDisplay(layout: string) {
  const params = useParams();
  const pathname = usePathname();
  const workspace = params.workspaceSlug?.toString() ?? "";
  const { data: user } = useUser();
  const request = nativeRequest(params, layout, pathname ?? "");
  const key =
    request && user?.id
      ? [
          "hentis-native-display",
          user.id,
          workspace,
          request.scope,
          request.target,
          request.project_id ?? "",
          request.layout,
        ]
      : null;
  const response = useSWR(key, () => nativeDisplayService.metadata(workspace, request!));
  return { ...response, request, workspace, userId: user?.id, identity: key?.join("/") ?? "unsupported" };
}

function NativeDataProvider({
  display,
  layout,
  issueIds,
  children,
}: {
  display: ReturnType<typeof useNativeDisplay>;
  layout: NativeLayout;
  issueIds: string[];
  children: ReactNode;
}) {
  const [registered, setRegistered] = useState<Record<string, number>>({});
  const [ids, setIds] = useState<string[]>(issueIds);
  const register = useCallback<Registration>((id) => {
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) return () => {};
    setRegistered((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
    return () =>
      setRegistered((current) => {
        const next = { ...current };
        if (next[id] > 1) next[id]--;
        else delete next[id];
        return next;
      });
  }, []);
  const combined = [...new Set([...issueIds, ...Object.keys(registered)])];
  const idKey = combined.join(",");
  useEffect(() => {
    const timer = setTimeout(() => setIds(idKey ? idKey.split(",") : []), 40);
    return () => clearTimeout(timer);
  }, [idKey]);
  const enabled = !!display.request && !!display.data?.preference.visible.length;
  const { data, mutate } = useSWR(
    enabled && ids.length ? ["hentis-native-batch", display.identity, ids.join(",")] : null,
    () => nativeDisplayService.batch(display.workspace, display.request!, ids)
  );
  const context = useMemo(
    () => ({ display, layout, register, values: data?.values ?? {}, projects: data?.projects ?? {}, refresh: mutate }),
    [display, layout, register, data, mutate]
  );
  return <NativeFieldsContext.Provider value={context}>{children}</NativeFieldsContext.Provider>;
}

export const NativeLayoutProvider = observer(function NativeLayoutProvider({
  layout,
  issueIds,
  children,
}: {
  layout: NativeLayout;
  issueIds: string[];
  children: ReactNode;
}) {
  const display = useNativeDisplay(layout);
  return (
    <NativeDataProvider key={display.identity} display={display} layout={layout} issueIds={issueIds}>
      {children}
    </NativeDataProvider>
  );
});

export function useNativeIssueRegistration(issueId: string) {
  const context = useNativeFieldsContext();
  const register = context?.register;
  useEffect(() => register?.(issueId), [register, issueId]);
  return context;
}

export function useNativeColumns(standard: readonly string[]): string[] {
  const context = useNativeFieldsContext();
  return orderedNativeProperties(
    standard,
    context?.display.data?.fields ?? [],
    context?.display.data?.preference ?? { order: [], visible: [] }
  );
}

export function useNativePropertyPlacement(property: string | readonly string[]) {
  const context = useNativeFieldsContext();
  return context && context.layout !== "spreadsheet"
    ? nativePropertyRank(context.display.data?.preference.order ?? [], property)
    : undefined;
}

export function useNativeDateRangeMerge() {
  const context = useNativeFieldsContext();
  const metadata = context?.display.data;
  if (!metadata) return true;
  const visibleOrder = metadata.preference.order.filter(
    (key) => !key.startsWith("custom:") || metadata.preference.visible.includes(key.slice(7))
  );
  const start = visibleOrder.indexOf("standard:start_date");
  return start >= 0 && visibleOrder.indexOf("standard:due_date") === start + 1;
}

export function NativeCardFields({
  issueId,
  projectId,
  compact = false,
  className,
}: {
  issueId: string;
  projectId: string | null | undefined;
  compact?: boolean;
  className?: string;
}) {
  const context = useNativeIssueRegistration(issueId);
  const metadata = context?.display.data;
  if (!context || !metadata || !context.values[issueId]) return null;
  const properties = orderedNativeProperties([], metadata.fields, metadata.preference);
  const fields = properties
    .map((key) => metadata.fields.find((field) => field.id === key.slice(7)))
    .filter((field) => field?.project_id === projectId);
  if (!fields.length) return null;
  const content = (
    <>
      {fields.map(
        (field) =>
          field && (
            <span
              key={field.id}
              className={
                compact
                  ? "inline-flex max-w-52 min-w-0 shrink-0 items-center gap-1 rounded border border-subtle px-1 py-0.5 text-11"
                  : "inline-flex max-w-72 min-w-0 items-center gap-1 rounded border border-subtle px-1.5 py-0.5 text-11"
              }
              style={{ order: nativePropertyRank(metadata.preference.order, "custom:" + field.id) }}
              title={`${field.name}: ${displayValue(field, context.values[issueId][field.id])}`}
            >
              <span className="shrink-0 text-secondary">{field.name}:</span>
              <span className="min-w-0 truncate">
                <FieldDisplay field={field} value={context.values[issueId][field.id]} />
              </span>
            </span>
          )
      )}
    </>
  );
  return className ? <div className={className}>{content}</div> : content;
}

export function NativeCustomHeader({ fieldId }: { fieldId: string }) {
  const context = useNativeFieldsContext();
  const columnStyle = useTableColumnStyle("custom:" + fieldId);
  const field = context?.display.data?.fields.find((item) => item.id === fieldId);
  if (!field) return null;
  const label = isWorkspaceNativeScope(context?.display.request?.scope)
    ? `${field.project_identifier} · ${field.name}`
    : field.name;
  return (
    <th
      className="relative min-w-44 border-r border-subtle bg-layer-1 px-2 py-2 pr-3 text-left text-13 font-medium"
      style={columnStyle}
      title={label}
    >
      {label}
      <ColumnResizeHandle columnKey={"custom:" + fieldId} label={label} />
    </th>
  );
}

export function NativeCustomCell({
  issueId,
  fieldId,
  disabled,
}: {
  issueId: string;
  fieldId: string;
  disabled: boolean;
}) {
  const context = useNativeFieldsContext();
  const field = context?.display.data?.fields.find((item) => item.id === fieldId);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const columnStyle = useTableColumnStyle("custom:" + fieldId);
  if (!context || !field) return null;
  const project = context.projects[issueId];
  const save = async (value: FieldValue) => {
    if (!project) return;
    setSaving(true);
    setError("");
    try {
      await fieldsService.save(context.display.workspace, project, issueId, { [fieldId]: value });
    } catch (e) {
      setError(fieldError(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <td
      className="min-w-44 border-r border-subtle px-2 text-13"
      style={columnStyle}
      onClick={(event) => event.stopPropagation()}
    >
      {project !== field.project_id ? (
        <span className="text-secondary">—</span>
      ) : (
        <FieldInput
          field={field}
          value={context.values[issueId]?.[fieldId]}
          disabled={disabled || saving || !context.display.data?.editable_project_ids.includes(project)}
          onChange={(value) => void save(value)}
        />
      )}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
    </td>
  );
}
