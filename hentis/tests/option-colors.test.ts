import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_OPTION_COLOR,
  optionBackground,
  optionBadgeStyle,
} from "../../apps/web/core/components/custom-fields/option-colors";

test("legacy options use a neutral box background", () => {
  assert.equal(optionBackground({}), DEFAULT_OPTION_COLOR);
  assert.equal(optionBadgeStyle({}).backgroundColor, DEFAULT_OPTION_COLOR);
});

test("the user's choice colors the background, not the label text", () => {
  const style = optionBadgeStyle({ color: "#F59E0B" });
  assert.equal(style.backgroundColor, "#f59e0b");
  assert.equal(style.color, "#000000");
  assert.notEqual(style.color, style.backgroundColor);
});

test("light and dark boxes keep readable label contrast", () => {
  assert.equal(optionBadgeStyle({ color: "#ffffff" }).color, "#000000");
  assert.equal(optionBadgeStyle({ color: "#000000" }).color, "#ffffff");
  assert.equal(optionBadgeStyle({ color: "#000080" }).color, "#ffffff");
  assert.equal(optionBadgeStyle({ color: "#fef3c7" }).color, "#000000");
});

test("unrecognized legacy color metadata falls back to a valid background", () => {
  for (const color of ["red", "#fff", "#12345678", "url(example)", ""]) {
    assert.equal(optionBackground({ color }), DEFAULT_OPTION_COLOR);
  }
});
