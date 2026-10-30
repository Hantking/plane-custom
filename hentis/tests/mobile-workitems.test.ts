import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ISSUE_MOBILE_PANELS,
  adjacentIssueMobilePanel,
  isIssueMobileViewport,
  resolveIssueMobilePanel,
} from "../../apps/web/core/components/issues/issue-detail/mobile-panels.ts";

test("task layout follows viewport width including tablet rotation boundaries", () => {
  for (const width of [1, 320, 390, 767]) assert.equal(isIssueMobileViewport(width), true);
  for (const width of [0, -1, 768, 844, 1440, Infinity, NaN]) assert.equal(isIssueMobileViewport(width), false);
});

test("opening another task starts with its content instead of retaining the previous task's panel", () => {
  for (const panel of ISSUE_MOBILE_PANELS) {
    assert.equal(resolveIssueMobilePanel({ issueId: "previous-task", panel }, "new-task"), "content");
    assert.equal(resolveIssueMobilePanel({ issueId: "current-task", panel }, "current-task"), panel);
  }
});

test("keyboard users can reach every native task section and wrap between the first and last tabs", () => {
  assert.deepEqual(ISSUE_MOBILE_PANELS, ["content", "properties", "comments", "attachments"]);
  assert.equal(adjacentIssueMobilePanel("content", "ArrowRight"), "properties");
  assert.equal(adjacentIssueMobilePanel("properties", "ArrowRight"), "comments");
  assert.equal(adjacentIssueMobilePanel("comments", "ArrowRight"), "attachments");
  assert.equal(adjacentIssueMobilePanel("attachments", "ArrowRight"), "content");
  assert.equal(adjacentIssueMobilePanel("content", "ArrowLeft"), "attachments");
  for (const panel of ISSUE_MOBILE_PANELS) {
    assert.equal(adjacentIssueMobilePanel(panel, "Home"), "content");
    assert.equal(adjacentIssueMobilePanel(panel, "End"), "attachments");
    assert.equal(adjacentIssueMobilePanel(panel, "Escape"), undefined);
    assert.equal(adjacentIssueMobilePanel(panel, "Tab"), undefined);
  }
});
