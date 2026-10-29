export function visibleStateIds(
  all: string[],
  selected: string[] | null | undefined,
  occupied: string[] = [],
  current?: string | null
): string[] {
  if (selected == null) return all;
  const included = new Set([...selected, ...occupied, ...(current ? [current] : [])]);
  return all.filter((id) => included.has(id));
}

export function hasGroupItems(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return !!value && typeof value === "object" && Object.values(value).some(hasGroupItems);
}
