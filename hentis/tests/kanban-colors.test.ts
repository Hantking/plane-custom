import assert from "node:assert/strict";
import { test } from "node:test";
import {
  kanbanColorVariables,
  kanbanGroupColor,
  kanbanStateColor,
} from "../../apps/web/core/components/issues/issue-layouts/kanban/colors";

test("board accents honor configured state colors and normalize shorthand safely", () => {
  assert.equal(kanbanStateColor("#AB12EF", "completed"), "#ab12ef");
  assert.equal(kanbanStateColor("#aF0"), "#aaff00");
  assert.equal(kanbanStateColor("url(javascript:alert(1))", "completed"), "#22c55e");
  assert.equal(kanbanStateColor(null, "started"), "#f59e0b");
  assert.equal(kanbanStateColor(undefined, "unknown"), "#64748b");
});

const getState = (id: string) => (id === "done" ? { color: "#123456", group: "completed" } : undefined);

test("column colors follow state grouping without assigning fake states to other groupings", () => {
  assert.equal(kanbanGroupColor("state", "done", getState), "#123456");
  assert.equal(kanbanGroupColor("state", "missing", getState), undefined);
  assert.equal(kanbanGroupColor("state_detail.group", "completed", getState), "#22c55e");
  assert.equal(kanbanGroupColor("assignees", "done", getState), undefined);
  assert.equal(kanbanColorVariables(undefined), undefined);
});

test("colored header text keeps at least 4.5 contrast for light, dark and bright status colors", () => {
  for (const color of ["#ffffff", "#000000", "#ffff00", "#00ff00", "#ef4444", "#6366f1", "#64748b"]) {
    const vars = kanbanColorVariables(color)!;
    const channels = [1, 3, 5]
      .map((start) => parseInt(color.slice(start, start + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    const contrast = vars["--kanban-foreground"] === "#000000" ? (luminance + 0.05) / 0.05 : 1.05 / (luminance + 0.05);
    assert(contrast >= 4.5, `${color}: ${contrast}`);
  }
});
