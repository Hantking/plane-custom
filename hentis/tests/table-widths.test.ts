import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampColumnWidth,
  columnWidthVariable,
  defaultColumnWidth,
  resizedColumnWidth,
  savedColumnWidth,
  visibleTableColumns,
} from "../../apps/web/core/components/custom-fields/column-width-helpers";

test("created and updated columns have independent saved widths", () => {
  const widths = { "standard:created_on": 220, "standard:updated_on": 310 };
  assert.equal(savedColumnWidth("standard:created_on", widths), 220);
  assert.equal(savedColumnWidth("standard:updated_on", widths), 310);
  assert.notEqual(columnWidthVariable("standard:created_on"), columnWidthVariable("standard:updated_on"));
});

test("dragging increases and decreases actual pixel widths", () => {
  assert.equal(resizedColumnWidth("standard:created_on", 180, 100, 160), 240);
  assert.equal(resizedColumnWidth("standard:updated_on", 180, 100, 60), 140);
  assert.equal(resizedColumnWidth("custom:client", 200, 100, 150), 250);
});

test("resize bounds keep the title and regular columns usable", () => {
  assert.equal(clampColumnWidth("title", 1), 160);
  assert.equal(clampColumnWidth("standard:created_on", -100), 80);
  assert.equal(clampColumnWidth("custom:client", 2000), 1200);
  assert.equal(clampColumnWidth("title", Number.NaN), defaultColumnWidth("title"));
});

test("missing widths restore defaults and never change visibility", () => {
  const widths = { title: 650 };
  assert.equal(savedColumnWidth("title", widths), 650);
  assert.equal(savedColumnWidth("standard:created_on", widths), 180);
  assert.equal(savedColumnWidth("custom:client", widths), 200);
  assert.deepEqual(widths, { title: 650 });
});

test("column group matches rendered cells, including hidden fields and estimates", () => {
  const columns = [
    "standard:state",
    "standard:estimate",
    "standard:created_on",
    "standard:updated_on",
    "custom:client",
  ];
  assert.deepEqual(
    visibleTableColumns(columns, { state: false, estimate: true, created_on: true, updated_on: true }, false),
    ["title", "standard:created_on", "standard:updated_on", "custom:client"]
  );
});

test("widths use safe independent CSS variables for custom and standard cells", () => {
  assert.equal(columnWidthVariable("standard:created_on"), "--hentis-column-standard-created-on");
  assert.equal(
    columnWidthVariable("custom:11111111-1111-4111-8111-111111111111"),
    "--hentis-column-custom-11111111-1111-4111-8111-111111111111"
  );
});
