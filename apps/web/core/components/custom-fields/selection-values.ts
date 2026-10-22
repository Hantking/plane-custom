import type { CustomField, FieldValue, ViewConfig, FilterTree, Condition } from "./service";

export function isSelectionKind(kind: CustomField["kind"]) {
  return kind === "select" || kind === "multiselect";
}

export function selectionValues(field: Pick<CustomField, "options">, value: FieldValue | undefined): string[] {
  const selected = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return field.options.filter((option) => selected.includes(option.id)).map((option) => option.id);
}

export function refreshViewConfig(config: ViewConfig, previous: CustomField[], next: CustomField[]): ViewConfig {
  const active = next.filter((field) => field.active);
  const before = new Map(previous.filter((field) => field.active).map((field) => [field.id, field]));
  const after = new Map(active.map((field) => [field.id, field]));
  const group = after.get(config.group_by);
  const order = after.get(config.order_by.replace(/^-/, ""));
  const valid = (condition: Condition) => {
    const field = after.get(condition.field);
    if (!field || before.get(condition.field)?.kind !== field.kind) return false;
    if (isSelectionKind(field.kind) && !["empty", "not_empty"].includes(condition.operator)) {
      const values = Array.isArray(condition.value) ? condition.value : [condition.value];
      return values.every((value) => field.options.some((option) => option.id === value));
    }
    return true;
  };
  function prune(node: FilterTree): FilterTree | null {
    if (!("op" in node)) return valid(node) ? node : null;
    const children = node.children.map(prune).filter((child): child is FilterTree => child !== null);
    return children.length ? { ...node, children } : null;
  }
  const nativeSorts = new Set([
    "name",
    "created_at",
    "updated_at",
    "sequence_id",
    "priority",
    "state",
    "start_date",
    "due_date",
    "target_date",
    "sort_order",
    "created_on",
    "updated_on",
  ]);
  return {
    ...config,
    columns: [
      ...new Set([
        ...config.columns.filter((id) => after.has(id)),
        ...active.filter((field) => !before.has(field.id)).map((field) => field.id),
      ]),
    ],
    filters: config.filters.filter(valid),
    ...(config.filter_tree ? { filter_tree: prune(config.filter_tree) ?? { op: "and", children: [] } } : {}),
    ...(config.sorts
      ? {
          sorts: config.sorts.filter((sort) => {
            const key = sort.field.replace(/^(custom|standard):/, "");
            return nativeSorts.has(key) || (after.has(key) && after.get(key)?.kind !== "multiselect");
          }),
        }
      : {}),
    ...(config.calculations
      ? {
          calculations: config.calculations.filter(
            (item) => after.has(item.field) && (item.operation === "count" || after.get(item.field)?.kind === "number")
          ),
        }
      : {}),
    group_by: group && (isSelectionKind(group.kind) || group.kind === "boolean") ? group.id : "",
    order_by:
      ["name", "created_at"].includes(config.order_by.replace(/^-/, "")) || (order && order.kind !== "multiselect")
        ? config.order_by
        : "-created_at",
  };
}
