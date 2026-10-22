import assert from "node:assert/strict";
import { test } from "node:test";
import { plainTextHTML, matchesEditorSnapshot } from "../../apps/web/core/components/plane-ai/writing-helpers";

test("generated text is escaped before reaching the HTML editor", () => {
  assert.equal(
    plainTextHTML('<script>alert("x")</script>&'),
    "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;</p>"
  );
});
test("writing preview preserves lines and Unicode without treating markup as instructions", () => {
  assert.equal(plainTextHTML("Critérios\nAceite ✅"), "<p>Critérios<br>Aceite ✅</p>");
});
test("moving selection within the same paragraph invalidates the preview", () => {
  const original = { html: "<p>same paragraph</p>", range: { from: 1, to: 5 } };
  assert.equal(matchesEditorSnapshot(original, { ...original, range: { from: 6, to: 12 } }), false);
  assert.equal(matchesEditorSnapshot(original, original), true);
});
test("remote document changes and an unavailable editor invalidate the preview", () => {
  const original = { html: "before", range: { from: 1, to: 5 } };
  assert.equal(matchesEditorSnapshot(original, { ...original, html: "after" }), false);
  assert.equal(matchesEditorSnapshot(original, { ...original, range: null }), false);
});
