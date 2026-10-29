/* eslint-disable no-await-in-loop -- Sequential language and browser state transitions are the behavior under test. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { loadLocaleResource } from "../../packages/i18n/src/core/resources.generated.ts";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const [react, server, translations] = await Promise.all([
  import(pathToFileURL(require.resolve("react")).href),
  import(pathToFileURL(require.resolve("react-dom/server")).href),
  import("../../packages/i18n/dist/index.js"),
]);

function translatedText(key) {
  let value;
  function Probe() {
    value = translations.useTranslation().t(key);
    return react.default.createElement("span", null, value);
  }
  const html = server.renderToStaticMarkup(
    react.default.createElement(translations.TranslationProvider, null, react.default.createElement(Probe))
  );
  assert.ok(html.length > 0, "the compiled provider must render after language initialization");
  return value;
}

test("the compiled package loads English and Brazilian Portuguese namespaces instead of raw keys", async () => {
  await translations.setLanguage("en");
  assert.equal(translatedText("home.empty.quickstart_guide"), "Your quickstart guide");
  assert.equal(translatedText("submit"), "Submit");
  await translations.setLanguage("pt-BR");
  assert.equal(translatedText("home.empty.quickstart_guide"), "Seu guia de início rápido");
  assert.equal(translatedText("submit"), "Enviar");
});

test("every supported locale loads its actual compiled resources", async () => {
  assert.equal(translations.SUPPORTED_LANGUAGES.length, 19);
  for (const language of translations.SUPPORTED_LANGUAGES) {
    const file = new URL(`../../packages/i18n/src/locales/${language.value}/common.json`, import.meta.url);
    const expected = JSON.parse(await readFile(file, "utf8")).submit;
    await translations.setLanguage(language.value);
    assert.equal(translatedText("submit"), expected, language.value);
  }
});

test("unsupported locales fall back to English and unknown keys remain explicit", async () => {
  await translations.setLanguage("unsupported-locale");
  assert.equal(translatedText("submit"), "Submit");
  assert.equal(translatedText("home.empty.quickstart_guide"), "Your quickstart guide");
  assert.equal(translatedText("nonexistent.translation.key"), "nonexistent.translation.key");
});

test("resource loading remains lazy and rejects unknown or inherited resource names", async () => {
  const entry = await readFile(new URL("../../packages/i18n/dist/index.js", import.meta.url), "utf8");
  assert.equal(entry.includes("Seu guia de início rápido"), false, "other locales must remain in lazy chunks");
  assert.match(entry, /import\("\.\//, "the compiled entry must retain discoverable lazy imports");
  const home = await loadLocaleResource("pt-BR", "home");
  assert.equal(home.home.empty.quickstart_guide, "Seu guia de início rápido");
  for (const [language, namespace] of [
    ["unsupported-locale", "common"],
    ["en", "unsupported-namespace"],
    ["__proto__", "common"],
    ["en", "constructor"],
    ["../en", "common"],
  ]) {
    await assert.rejects(() => loadLocaleResource(language, namespace), /Unknown translation resource/);
  }
});
