import type { ViewConfig, FilterTree, Condition, CustomField } from "./service";
import { columnWidthVariable, defaultColumnWidth } from "./column-width-helpers";
import type { NativeRequest } from "./native-display-helpers";

export type NativeOrderChange = { workspace: string; context: NativeRequest | null; orderBy: string };

export function nativeOrderQueryChange(
  active: { workspace: string; request: NativeRequest | null },
  change: NativeOrderChange
): Pick<ViewConfig, "sorts" | "manual" | "order_by"> | null {
  const request = active.request,
    context = change.context;
  if (
    !request ||
    !context ||
    request.layout !== "list" ||
    context.layout !== "list" ||
    active.workspace !== change.workspace ||
    request.scope !== context.scope ||
    request.target !== context.target ||
    request.project_id !== context.project_id ||
    !["sort_order", "-created_at", "-updated_at", "start_date", "target_date", "-priority"].includes(change.orderBy)
  )
    return null;
  if (change.orderBy === "sort_order") return { sorts: [], manual: true, order_by: "sort_order" };
  const field = change.orderBy.replace(/^-/, "");
  return {
    sorts: [
      {
        field: field === "target_date" ? "due_date" : field,
        direction: change.orderBy === "-priority" || !change.orderBy.startsWith("-") ? "asc" : "desc",
        nulls: "last",
      },
    ],
    manual: false,
    order_by: change.orderBy,
  };
}

export const listQueryDefaults: ViewConfig = {
  schema_version: 2,
  filters: [],
  match: "all",
  filter_tree: { op: "and", children: [] },
  sorts: [],
  group_by: "",
  native_group: "inherit",
  order_by: "-created_at",
  layout: "list",
  columns: [],
  search: "",
  priority: "",
  subtasks: "collapsed",
  search_hidden: false,
  calculations: [],
  manual: false,
  manual_order: {},
};

function identify(node: FilterTree, path: string): FilterTree {
  if ("op" in node)
    return {
      ...node,
      id: node.id ?? `legacy-${path}`,
      children: node.children.map((child, index) => identify(child, `${path}.${index}`)),
    };
  return { ...node, id: node.id ?? `legacy-${path}` };
}

export function normalizeListQuery(value: Partial<ViewConfig> = {}): ViewConfig {
  const result = { ...listQueryDefaults, ...value };
  if (!value.filter_tree && value.filters)
    result.filter_tree = { op: value.match === "any" ? "or" : "and", children: value.filters };
  if (!value.sorts && value.order_by)
    result.sorts = [
      {
        field: value.order_by.replace(/^-/, ""),
        direction: value.order_by.startsWith("-") ? "desc" : "asc",
        nulls: "last",
      },
    ];
  result.filter_tree = identify(result.filter_tree!, "root");
  return result;
}
export function listGridStyle(columns: readonly string[]) {
  return {
    display: "grid",
    gridTemplateColumns: columns
      .map((key) => `var(${columnWidthVariable(key)}, ${defaultColumnWidth(key)}px)`)
      .join(" "),
    width: "var(--hentis-table-width)",
  };
}
export function moveListRow(ids: readonly string[], source: string, target: string, after = false) {
  if (source === target || !ids.includes(source) || !ids.includes(target)) return [...ids];
  const result = ids.filter((id) => id !== source);
  result.splice(result.indexOf(target) + (after ? 1 : 0), 0, source);
  return result;
}
export function mergeManualOrder(previous: readonly string[], visible: readonly string[]) {
  const selected = new Set(visible),
    merged = [...new Set([...previous, ...visible])];
  let next = 0;
  return merged.map((id) => (selected.has(id) ? visible[next++] : id));
}
export const manualGroupKey = (
  query: Pick<ViewConfig, "view_id" | "group_by" | "native_group">,
  group: string,
  inherited?: string | null
) =>
  `${query.view_id || "__current__"}|${query.group_by ? `custom:${query.group_by}` : `native:${query.native_group && query.native_group !== "inherit" ? query.native_group : inherited || "none"}`}|${group}`;
export function compatibleGroup(tree: FilterTree, field: string, key: string): boolean {
  function truth(node: FilterTree): boolean | null {
    if ("op" in node) {
      if (!node.children.length) return true;
      const values = node.children.map(truth);
      if (node.op === "not") return values[0] === null ? null : !values[0];
      if (node.op === "and")
        return values.includes(false) ? false : values.every((value) => value === true) ? true : null;
      return values.includes(true) ? true : values.every((value) => value === false) ? false : null;
    }
    if (node.field !== field) return null;
    if (node.operator === "empty") return key === "__empty__";
    if (node.operator === "not_empty") return key !== "__empty__";
    const values = Array.isArray(node.value) ? node.value : [String(node.value)];
    return node.operator === "ne" ? !values.includes(key) : values.includes(key);
  }
  return truth(tree) !== false;
}
export function filterDefaults(
  tree: FilterTree,
  fields: Pick<CustomField, "id" | "kind">[] = []
): Record<string, Condition["value"]> {
  const result: Record<string, Condition["value"]> = {};
  const ambiguous = new Set<string>();
  function visit(node: FilterTree) {
    if ("op" in node) {
      if (node.op === "and") node.children.forEach(visit);
      return;
    }
    if (
      node.operator !== "eq" ||
      Array.isArray(node.value) ||
      fields.find((field) => field.id === node.field)?.kind === "multiselect"
    )
      return;
    if (Object.hasOwn(result, node.field) && JSON.stringify(result[node.field]) !== JSON.stringify(node.value))
      ambiguous.add(node.field);
    result[node.field] = node.value;
  }
  visit(tree);
  for (const key of ambiguous) delete result[key];
  return result;
}
