import type { CustomField } from "./service";
import type { ViewConfig } from "./service";

export type NativeLayout = "list" | "kanban" | "spreadsheet" | "calendar" | "gantt_chart";
export type NativeScope =
  | "project"
  | "module"
  | "cycle"
  | "project_view"
  | "workspace_view"
  | "workspace_builtin"
  | "archive";
export type NativeRequest = { scope: NativeScope; target: string; project_id?: string; layout: NativeLayout };
export type NativePreference = {
  order: string[];
  visible: string[];
  widths?: Record<string, number>;
  query?: Partial<ViewConfig>;
  schema_version?: number;
};
export type NativeField = CustomField & { project_id: string; project_name: string; project_identifier: string };
export const STANDARD_PROPERTY_ORDER = [
  "state",
  "priority",
  "assignee",
  "labels",
  "modules",
  "cycle",
  "start_date",
  "due_date",
  "estimate",
  "created_on",
  "updated_on",
  "link",
  "attachment_count",
  "sub_issue_count",
  "issue_type",
];
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const builtins: Record<string, string> = {
  "all-issues": "00000000-0000-0000-0000-000000000001",
  assigned: "00000000-0000-0000-0000-000000000002",
  created: "00000000-0000-0000-0000-000000000003",
  subscribed: "00000000-0000-0000-0000-000000000004",
};

export function isWorkspaceNativeScope(scope: NativeScope | undefined) {
  return scope === "workspace_view" || scope === "workspace_builtin";
}

export function normalizeNativeLayout(layout: string): NativeLayout {
  if (layout === "gantt") return "gantt_chart";
  return ["list", "kanban", "spreadsheet", "calendar", "gantt_chart"].includes(layout)
    ? (layout as NativeLayout)
    : "list";
}

export function nativeRequest(
  params: Record<string, string | string[] | undefined>,
  layout: string,
  pathname = ""
): NativeRequest | null {
  const value = (key: string) => {
    const item = params[key];
    return Array.isArray(item) ? item[0] : item;
  };
  if (value("userId") || value("teamspaceId") || value("epicId")) return null;
  const builtinView = value("globalViewId");
  if (builtinView && Object.hasOwn(builtins, builtinView))
    return { scope: "workspace_builtin", target: builtins[builtinView], layout: normalizeNativeLayout(layout) };
  const project = value("projectId");
  const scope: NativeScope = value("globalViewId")
    ? "workspace_view"
    : value("viewId")
      ? "project_view"
      : value("moduleId")
        ? "module"
        : value("cycleId")
          ? "cycle"
          : pathname.includes("/archives/")
            ? "archive"
            : "project";
  const target = value("globalViewId") || value("viewId") || value("moduleId") || value("cycleId") || project;
  if (!target || !uuid.test(target) || (scope !== "workspace_view" && (!project || !uuid.test(project)))) return null;
  return { scope, target, layout: normalizeNativeLayout(layout), ...(project ? { project_id: project } : {}) };
}

export function flattenNativeIssueIds(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || typeof value !== "object") return [];
  const values = Array.isArray(value) ? value : Object.values(value);
  return [
    ...new Set(
      values.flatMap((entry) =>
        typeof entry === "string" ? (uuid.test(entry) ? [entry] : []) : flattenNativeIssueIds(entry, depth + 1)
      )
    ),
  ];
}

export function orderedNativeProperties(
  standard: readonly string[],
  fields: readonly Pick<CustomField, "id">[],
  preference: NativePreference
): string[] {
  const visible = new Set(preference.visible);
  const available = [
    ...standard.filter((key) => key !== "key").map((key) => "standard:" + key),
    ...fields.filter((field) => visible.has(field.id)).map((field) => "custom:" + field.id),
  ];
  const known = new Set(available);
  return [...new Set([...preference.order.filter((key) => known.has(key)), ...available])];
}

export function moveNativeProperty(order: readonly string[], source: string, target: string): string[] {
  if (source === target || !order.includes(source) || !order.includes(target)) return [...order];
  const next = order.filter((key) => key !== source);
  next.splice(order.indexOf(target), 0, source);
  return next;
}

export function nativePropertyRank(order: readonly string[], property: string | readonly string[]): number {
  const keys: readonly string[] = typeof property === "string" ? [property] : property;
  return Math.min(
    ...keys.map((key) => {
      const index = order.indexOf(key.includes(":") ? key : "standard:" + key);
      return index < 0 ? order.length : index;
    })
  );
}
