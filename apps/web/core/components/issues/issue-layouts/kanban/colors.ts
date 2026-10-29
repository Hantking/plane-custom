import type { CSSProperties } from "react";
import { optionBadgeStyle } from "../../../custom-fields/option-colors";

const groupColors: Record<string, string> = {
  backlog: "#64748b",
  unstarted: "#6366f1",
  started: "#f59e0b",
  completed: "#22c55e",
  cancelled: "#ef4444",
};

export function kanbanStateColor(color?: string | null, group?: string): string {
  if (color && /^#[\da-f]{6}$/i.test(color)) return color.toLowerCase();
  if (color && /^#[\da-f]{3}$/i.test(color))
    return (
      "#" +
      color
        .slice(1)
        .split("")
        .map((value) => value + value)
        .join("")
        .toLowerCase()
    );
  return groupColors[group ?? ""] ?? groupColors.backlog;
}

export function kanbanGroupColor(
  groupBy: string | null | undefined,
  id: string,
  getState: (id: string) => { color: string; group: string } | undefined
): string | undefined {
  if (groupBy === "state") {
    const state = getState(id);
    return state ? kanbanStateColor(state.color, state.group) : undefined;
  }
  return groupBy === "state_detail.group" ? groupColors[id] : undefined;
}

export function kanbanColorVariables(
  color: string | undefined
): (CSSProperties & Record<"--kanban-color" | "--kanban-foreground", string>) | undefined {
  if (!color) return undefined;
  const palette = optionBadgeStyle({ color });
  return { "--kanban-color": palette.backgroundColor, "--kanban-foreground": palette.color };
}
