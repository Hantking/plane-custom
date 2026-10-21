import assert from "node:assert/strict";
import { test } from "node:test";
import {
  flattenNativeIssueIds,
  moveNativeProperty,
  nativePropertyRank,
  nativeRequest,
  normalizeNativeLayout,
  orderedNativeProperties,
} from "../../apps/web/core/components/custom-fields/native-display-helpers";

const project = "11111111-1111-4111-8111-111111111111";
const moduleId = "22222222-2222-4222-8222-222222222222";
const view = "33333333-3333-4333-8333-333333333333";

test("native context separates project, module and both kinds of views", () => {
  assert.equal(nativeRequest({ projectId: project }, "spreadsheet")?.scope, "project");
  assert.equal(nativeRequest({ projectId: project, moduleId }, "list")?.target, moduleId);
  assert.equal(nativeRequest({ projectId: project, viewId: view }, "kanban")?.scope, "project_view");
  assert.equal(nativeRequest({ globalViewId: view }, "calendar")?.scope, "workspace_view");
  assert.equal(nativeRequest({ projectId: project, cycleId: moduleId }, "gantt_chart")?.scope, "cycle");
});

test("all five layouts retain independent preference keys", () => {
  const keys = ["spreadsheet", "list", "kanban", "calendar", "gantt_chart"].map((layout) =>
    JSON.stringify(nativeRequest({ projectId: project }, layout))
  );
  assert.equal(new Set(keys).size, 5);
  assert.equal(normalizeNativeLayout("gantt"), "gantt_chart");
});

test("unsupported and temporary routes do not reuse another screen's preferences", () => {
  assert.equal(nativeRequest({ projectId: "temporary" }, "list"), null);
  assert.equal(nativeRequest({ projectId: project, userId: view }, "list"), null);
  assert.equal(nativeRequest({}, "calendar"), null);
  assert.equal(
    nativeRequest({ projectId: project }, "list", "/workspace/projects/id/archives/issues/")?.scope,
    "archive"
  );
});

test("custom columns can be positioned between native columns without moving the fixed title", () => {
  const order = orderedNativeProperties(["key", "state", "priority"], [{ id: "client" }, { id: "value" }], {
    order: ["standard:state", "custom:client", "standard:priority", "custom:value"],
    visible: ["client", "value"],
  });
  assert.deepEqual(order, ["standard:state", "custom:client", "standard:priority", "custom:value"]);
});

test("hidden and archived fields disappear while unsaved native columns keep working", () => {
  assert.deepEqual(
    orderedNativeProperties(["state", "priority"], [{ id: "client" }], {
      order: ["custom:deleted", "custom:client", "standard:state"],
      visible: [],
    }),
    ["standard:state", "standard:priority"]
  );
});

test("dragging and keyboard arrows move properties without mutating the previous preference", () => {
  const original = ["standard:state", "custom:client", "standard:priority"];
  assert.deepEqual(moveNativeProperty(original, "custom:client", "standard:state"), [
    "custom:client",
    "standard:state",
    "standard:priority",
  ]);
  assert.deepEqual(moveNativeProperty(original, "custom:client", "standard:priority"), [
    "standard:state",
    "standard:priority",
    "custom:client",
  ]);
  assert.deepEqual(original, ["standard:state", "custom:client", "standard:priority"]);
});

test("grouped layout IDs are batched once and never include temporary task IDs", () => {
  assert.deepEqual(flattenNativeIssueIds({ groupA: { subgroup: [project, moduleId] }, groupB: [project, "temp-id"] }), [
    project,
    moduleId,
  ]);
});

test("cards and date groups use the same property rank as the table", () => {
  const order = ["standard:start_date", "custom:client", "standard:due_date"];
  assert.equal(nativePropertyRank(order, "custom:client"), 1);
  assert.equal(nativePropertyRank(order, ["start_date", "due_date"]), 0);
});
