// Keep decimal strings out of Number/Intl: 14 integer + 6 fraction digits exceed JS precision.
export function plainNumber(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /^-?\d+\.\d+$/.test(text) ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

export function phoneDisplay(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.length > 11 && digits.startsWith("55")) digits = digits.slice(2);
  if (digits.length !== 10 && digits.length !== 11) return value;
  const split = digits.length - 4;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, split)}-${digits.slice(split)}`;
}

export function safeSite(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const text = value.trim();
  try {
    const url = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text) ? text : `https://${text}`);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
