export function plainTextHTML(text: string) {
  return `<p>${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;").replaceAll("\n", "<br>")}</p>`;
}

type Snapshot = { html: string; range: { from: number; to: number } | null };
export function matchesEditorSnapshot(before: Snapshot, after: Snapshot) {
  return (
    before.html === after.html &&
    before.range !== null &&
    after.range !== null &&
    before.range.from === after.range.from &&
    before.range.to === after.range.to
  );
}
