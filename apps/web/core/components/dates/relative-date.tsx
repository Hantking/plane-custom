import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { observer } from "mobx-react";
import { useUser } from "@/hooks/store/user";
import { calendarDayInZone, relativeDatePresentation, TODAY_DATE_COLOR } from "./relative-date-helpers";

// One shared clock; cells only rerender when the user's calendar day actually changes.
let clock = Date.now();
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
function notify() {
  clock = Date.now();
  for (const listener of listeners) listener();
}
function tick() {
  notify();
  timer = setTimeout(tick, 60_000 - (Date.now() % 60_000));
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    tick();
    window.addEventListener("focus", notify);
    document.addEventListener("visibilitychange", notify);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearTimeout(timer);
      window.removeEventListener("focus", notify);
      document.removeEventListener("visibilitychange", notify);
    }
  };
}
const serverSnapshot = () => null;

export const RelativeDate = observer(function RelativeDate({
  value,
  normalText,
}: {
  value: string | Date;
  normalText?: ReactNode;
}) {
  const { data: user } = useUser();
  const timeZone = user?.user_timezone || "UTC";
  const todayDay = useSyncExternalStore(subscribe, () => calendarDayInZone(new Date(clock), timeZone), serverSnapshot);
  const presentation = relativeDatePresentation(value, { timeZone, todayDay });
  if (!presentation) return <span>{normalText ?? relativeDatePresentation(value, { timeZone })?.fullDate ?? "—"}</span>;
  return (
    <span
      className={presentation.tone === "old" ? "text-danger-primary" : undefined}
      style={presentation.tone === "today" ? { color: TODAY_DATE_COLOR } : undefined}
      title={presentation.fullDate}
    >
      {presentation.relative ? presentation.text : (normalText ?? presentation.fullDate)}
    </span>
  );
});
