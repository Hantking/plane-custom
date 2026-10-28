export function dateTimeParts(value: unknown): { date: string; time: string } {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(value)) return { date: "", time: "" };
  const [date, time = ""] = value.split("T");
  return { date, time };
}

// A missing clock stays missing, including when the user removes an existing one.
export function dateTimeValue(date: string, time: string): string | null {
  return date ? date + (time ? `T${time}` : "") : null;
}
