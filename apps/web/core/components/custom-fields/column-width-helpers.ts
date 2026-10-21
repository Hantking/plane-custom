export const MAX_COLUMN_WIDTH = 1200;

export function minimumColumnWidth(key: string) {
  return key === "title" ? 160 : 80;
}

export function defaultColumnWidth(key: string) {
  if (key === "title") return 400;
  if (key === "standard:created_on" || key === "standard:updated_on") return 180;
  return key.startsWith("custom:") ? 200 : 160;
}

export function clampColumnWidth(key: string, width: number) {
  return Math.max(
    minimumColumnWidth(key),
    Math.min(MAX_COLUMN_WIDTH, Math.round(Number.isFinite(width) ? width : defaultColumnWidth(key)))
  );
}

export function savedColumnWidth(key: string, widths: Record<string, number> = {}) {
  return clampColumnWidth(key, widths[key] ?? defaultColumnWidth(key));
}

export function columnWidthVariable(key: string) {
  return "--hentis-column-" + key.replace(/[^a-z\d-]/gi, "-");
}

export function resizedColumnWidth(key: string, initialWidth: number, initialX: number, currentX: number) {
  return clampColumnWidth(key, initialWidth + currentX - initialX);
}

export function visibleTableColumns<Key extends string>(
  columns: readonly string[],
  visible: Partial<Record<Key, boolean | undefined>>,
  estimateEnabled: boolean
) {
  return [
    "title",
    ...columns.filter(
      (key) =>
        key.startsWith("custom:") ||
        (!!visible[key.slice(9) as Key] && (key !== "standard:estimate" || estimateEnabled))
    ),
  ];
}
