import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isSelectionKind,
  refreshViewConfig,
  selectionValues,
} from "../../apps/web/core/components/custom-fields/selection-values";
import type { CustomField, ViewConfig } from "../../apps/web/core/components/custom-fields/service";

const makeField = (id: string, kind: CustomField["kind"] = "multiselect"): CustomField => ({
  id,
  kind,
  name: id,
  description: "",
  active: true,
  required: false,
  position: 0,
  options: [
    { id: "red", label: "Red", color: "#ef4444" },
    { id: "green", label: "Green", color: "#22c55e" },
  ],
});
const config: ViewConfig = {
  filters: [{ id: "condition", field: "tags", operator: "eq", value: "red" }],
  columns: ["tags", "other"],
  match: "all",
  group_by: "tags",
  order_by: "tags",
  layout: "kanban",
  search: "",
  priority: "",
};

test("multiple selection keeps IDs in option order without duplicates or unknown labels", () => {
  const field = makeField("tags");
  assert.deepEqual(selectionValues(field, ["green", "red", "green", "unknown"]), ["red", "green"]);
  assert.deepEqual(selectionValues(field, "red"), ["red"]);
  assert.deepEqual(selectionValues(field, null), []);
  assert.equal(isSelectionKind("multiselect"), true);
  assert.equal(isSelectionKind("boolean"), false);
});

test("deleting or archiving a field removes stale controls without dropping unrelated columns", () => {
  const next = refreshViewConfig(config, [makeField("tags"), makeField("other", "text")], [makeField("other", "text")]);
  assert.deepEqual(next.filters, []);
  assert.deepEqual(next.columns, ["other"]);
  assert.equal(next.group_by, "");
  assert.equal(next.order_by, "-created_at");
});

test("changing field type refreshes incompatible current filters and keeps multiple grouping", () => {
  const next = refreshViewConfig(
    config,
    [makeField("tags", "select"), makeField("other", "text")],
    [makeField("tags"), makeField("other", "text")]
  );
  assert.deepEqual(next.filters, []);
  assert.equal(next.group_by, "tags");
  assert.equal(next.order_by, "-created_at");
  assert.deepEqual(next.columns, ["tags", "other"]);
});

test("reactivating fields adds a visible column only once", () => {
  const before = { ...makeField("tags"), active: false };
  const next = refreshViewConfig(
    config,
    [before, makeField("other", "text")],
    [makeField("tags"), makeField("other", "text")]
  );
  assert.deepEqual(next.columns, ["tags", "other"]);
});
