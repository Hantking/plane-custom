import type { CustomField, FieldValue, ViewConfig } from "./service";

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
  return {
    ...config,
    columns: [
      ...new Set([
        ...config.columns.filter((id) => after.has(id)),
        ...active.filter((field) => !before.has(field.id)).map((field) => field.id),
      ]),
    ],
    filters: config.filters.filter(
      (condition) =>
        after.has(condition.field) && before.get(condition.field)?.kind === after.get(condition.field)?.kind
    ),
    group_by: group && (isSelectionKind(group.kind) || group.kind === "boolean") ? group.id : "",
    order_by:
      ["name", "created_at"].includes(config.order_by.replace(/^-/, "")) || (order && order.kind !== "multiselect")
        ? config.order_by
        : "-created_at",
  };
}
