import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fieldEditorPosition,
  longTextKeyAction,
} from "../../apps/web/core/components/custom-fields/mobile-field-layout";

test("desktop keeps Enter save and Ctrl+Enter multiline contracts", () => {
  assert.equal(longTextKeyAction({ key: "Enter" }), "save");
  assert.equal(longTextKeyAction({ key: "Enter", ctrlKey: true }), "insert-line");
  assert.equal(longTextKeyAction({ key: "Enter", shiftKey: true }), "native");
});

test("software keyboard Enter adds a normal line without submitting", () => {
  assert.equal(longTextKeyAction({ key: "Enter", mobile: true }), "native");
  assert.equal(longTextKeyAction({ key: "Enter", mobile: true, ctrlKey: true }), "insert-line");
});

test("composition and readonly values cannot accidentally submit", () => {
  assert.equal(longTextKeyAction({ key: "Enter", isComposing: true }), "native");
  assert.equal(longTextKeyAction({ key: "Enter", disabled: true }), "native");
  assert.equal(longTextKeyAction({ key: "Escape" }), "cancel");
  assert.equal(longTextKeyAction({ key: "Escape", isComposing: true }), "native");
});

test("inline editor fits a 320px viewport without horizontal overflow", () => {
  const position = fieldEditorPosition({ left: 280, top: 100, bottom: 140 }, { width: 320, height: 568 });
  assert.equal(position.width, 304);
  assert.equal(position.left, 8);
  assert.equal(position.top, 144);
  assert.ok(position.left + position.width <= 312);
});

test("inline editor moves above its anchor near bottom of screen", () => {
  const position = fieldEditorPosition({ left: 30, top: 600, bottom: 644 }, { width: 390, height: 700 });
  assert.equal(position.top, 296);
  assert.ok(position.top + 300 <= 692);
});

test("software keyboard and visual viewport panning keep controls on screen", () => {
  const viewport = { width: 390, height: 240, offsetTop: 190, offsetLeft: 0 };
  const position = fieldEditorPosition({ left: 20, top: 400, bottom: 444 }, viewport);
  assert.equal(position.maxHeight, 224);
  assert.equal(position.top, 198);
  assert.ok(position.top + position.maxHeight <= viewport.offsetTop + viewport.height - 8);
});

test("visual viewport zoom offset and measured small panel are preserved", () => {
  const position = fieldEditorPosition(
    { left: 500, top: 100, bottom: 120 },
    { width: 200, height: 400, offsetLeft: 100 },
    140
  );
  assert.equal(position.left, 108);
  assert.equal(position.width, 184);
  assert.equal(position.top, 124);
});
