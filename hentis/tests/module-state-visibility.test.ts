import assert from "node:assert/strict";
import { test } from "node:test";
import { hasGroupItems, visibleStateIds } from "../../apps/web/core/components/module-states/helpers";

test("module selection preserves project order and existing occupied states", () => {
  const all = ["backlog", "todo", "done"];
  assert.deepEqual(visibleStateIds(all, null), all);
  assert.deepEqual(visibleStateIds(all, ["done", "todo"]), ["todo", "done"]);
  assert.deepEqual(visibleStateIds(all, ["todo"], ["done"]), ["todo", "done"]);
  assert.deepEqual(visibleStateIds(all, ["todo"], [], "backlog"), ["backlog", "todo"]);
  assert.deepEqual(visibleStateIds(all, ["foreign"]), []);
  assert.deepEqual(all, ["backlog", "todo", "done"]);
});

test("state groups keep loaded tasks across simple and nested Kanban grouping", () => {
  assert.equal(hasGroupItems(["task"]), true);
  assert.equal(hasGroupItems({ owner: { priority: ["task"] } }), true);
  for (const value of [undefined, null, [], {}, { owner: [] }]) assert.equal(hasGroupItems(value), false);
});
