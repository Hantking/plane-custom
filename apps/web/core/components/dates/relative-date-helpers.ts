const DAY_MS = 86_400_000;
export const TODAY_DATE_COLOR = "#B69277";
const formatters = new Map<string, Intl.DateTimeFormat>();
const weekdays = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" });
const normalDate = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

function civilDay(year: number, month: number, day: number): number | null {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.getTime() / DAY_MS
    : null;
}

export function calendarDayInZone(date: Date, timeZone: string): number | null {
  if (!Number.isFinite(date.getTime())) return null;
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone });
    } catch {
      formatter = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: "UTC",
      });
    }
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const value = (name: string) => Number(parts.find((part) => part.type === name)?.value);
  return civilDay(value("year"), value("month"), value("day"));
}

function selectedDay(value: string | Date, timeZone: string): number | null {
  // Calendar Date objects and YYYY-MM-DD represent a civil day, not a UTC instant.
  if (value instanceof Date) {
    return Number.isFinite(value.getTime())
      ? civilDay(value.getFullYear(), value.getMonth() + 1, value.getDate())
      : null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) return civilDay(Number(match[1]), Number(match[2]), Number(match[3]));
  return calendarDayInZone(new Date(value), timeZone);
}

export function relativeDatePresentation(
  value: string | Date,
  {
    timeZone = "UTC",
    now = new Date(),
    todayDay = calendarDayInZone(now, timeZone),
  }: { timeZone?: string; now?: Date; todayDay?: number | null } = {}
) {
  const day = selectedDay(value, timeZone);
  if (day === null || todayDay === null) return null;
  const difference = day - todayDay;
  const fullDate = normalDate.format(new Date(day * DAY_MS));
  const text =
    difference === 0
      ? "hoje"
      : difference === 1
        ? "amanhã"
        : difference === -1
          ? "ontem"
          : difference >= 2 && difference <= 5
            ? weekdays.format(new Date(day * DAY_MS))
            : difference <= -2 && difference >= -5
              ? `há ${-difference} dias`
              : fullDate;
  return {
    text,
    fullDate,
    difference,
    relative: difference >= -5 && difference <= 5,
    tone: difference === 0 ? ("today" as const) : difference < -5 ? ("old" as const) : ("normal" as const),
  };
}
