import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const [react, server, markdown, gfm] = await Promise.all(
  ["react", "react-dom/server", "react-markdown", "remark-gfm"].map((name) => import(require.resolve(name)))
);
const render = (text) =>
  server.renderToStaticMarkup(react.default.createElement(markdown.default, { remarkPlugins: [gfm.default] }, text));

test("the installed renderer produces real report tables, headings and lists", () => {
  const html = render("## Progresso\n\n| Projeto | Total |\n| --- | --- |\n| Plane | 60 |\n\n- Próximo passo");
  assert.ok(html.includes("<h2>Progresso</h2>"));
  assert.ok(html.includes("<table>"));
  assert.ok(html.includes("<td>60</td>"));
  assert.ok(html.includes("<li>Próximo passo</li>"));
});

test("model output does not execute raw HTML or javascript links", () => {
  const html = render("<script>alert(1)</script>\n\n[abrir](javascript:alert%281%29)");
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes('href="javascript:'));
});
