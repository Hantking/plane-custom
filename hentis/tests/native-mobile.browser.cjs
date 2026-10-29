/* eslint-disable no-await-in-loop -- Sequential language and browser state transitions are the behavior under test. */
// Native app browser checks. Every API call is mocked; no production account is used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
let playwright;
try {
  playwright = require(process.env.PLAYWRIGHT_MODULE || "../browser/node_modules/playwright");
} catch {
  playwright = require(
    path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")
  );
}
const { chromium } = playwright;
const { PROJECT, FIELD, fixture, installFixtures } = require("./native-mobile.fixtures.cjs");
let ORIGIN = process.env.PLANE_TEST_ORIGIN;
const OUTPUT = process.env.PLANE_TEST_OUTPUT || path.resolve(__dirname, "../browser/output");
fs.mkdirSync(OUTPUT, { recursive: true });
let browser, server;

async function newPage(viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  const page = await context.newPage();
  const data = fixture();
  data.language = process.env.PLANE_TEST_LANGUAGE || "en";
  const errors = [],
    consoleErrors = [],
    requestsFailed = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    requestsFailed.push({ url: request.url(), failure: request.failure()?.errorText })
  );
  await installFixtures(page, data, ORIGIN);
  return { context, page, data, errors, consoleErrors, requestsFailed };
}

async function visit(state, route) {
  await state.page.goto(ORIGIN + route, { waitUntil: "domcontentloaded", timeout: 90000 });
  await state.page.locator("[data-mobile-navigation]").waitFor({ state: "attached", timeout: 90000 });
  await state.page.waitForFunction(() => document.querySelector("[data-mobile-navigation] button")?.disabled !== true);
}

(async () => {
  if (!ORIGIN) {
    const root = path.resolve(__dirname, "../../apps/web/build/client");
    if (!fs.existsSync(path.join(root, "index.html")))
      throw new Error("Build the native web application before running browser checks.");
    const mime = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".webp": "image/webp",
      ".woff2": "font/woff2",
      ".woff": "font/woff",
    };
    server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      let file = path.resolve(root, "." + pathname);
      if (!file.startsWith(root + path.sep) && file !== root) {
        response.writeHead(403);
        return response.end();
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
      response.writeHead(200, {
        "Content-Type": mime[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      fs.createReadStream(file).pipe(response);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    ORIGIN = `http://127.0.0.1:${server.address().port}`;
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : process.platform === "win32"
        ? { executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" }
        : {}),
  });
  const state = await newPage();
  const { page, data } = state;
  try {
    await visit(state, "/hentis/");
    await page.locator("[data-mobile-navigation] button").first().click();
    await page.locator("[data-mobile-menu]").waitFor();
    await page.locator("[data-mobile-menu] summary").first().click();
    const links = await page
      .locator("[data-mobile-menu] a[href]")
      .evaluateAll((elements) =>
        elements.map((element) => ({ href: element.getAttribute("href"), text: element.textContent }))
      );
    for (const suffix of ["issues", "cycles", "modules", "pages", "views", "intake"])
      assert.ok(
        links.some((link) => link.href?.includes(`/projects/${PROJECT}/${suffix}`)),
        `Missing native project destination ${suffix}`
      );
    assert.ok(links.some((link) => link.href === "/hentis/settings/"));
    assert.ok(links.some((link) => link.href === "/hentis/pages/"));
    assert.ok(links.some((link) => link.href === `/hentis/settings/projects/${PROJECT}/`));
    const box = await page.locator("[data-mobile-menu]").boundingBox();
    assert.ok(box.width <= 390 && box.x >= 0);
    await page.screenshot({ path: path.join(OUTPUT, "menu-390.png") });
    await page.keyboard.press("Escape");
    await page.locator("[data-mobile-menu]").waitFor({ state: "hidden" });
    await page.locator("[data-mobile-navigation] button").nth(1).click();
    await page.locator("[data-native-workspace-search][data-search-open=true]").waitFor();
    await page.keyboard.press("Escape");
    await page.locator("[data-mobile-navigation] button").first().click();
    await page
      .locator("[data-mobile-menu]")
      .getByRole("button", { name: /profile|perfil/i })
      .click();
    await page.locator("#mobile-profile-settings").waitFor();
    const profileTabs = await page
      .locator("#mobile-profile-settings option")
      .evaluateAll((options) => options.map((option) => option.value));
    assert.ok(
      profileTabs.includes("general") &&
        profileTabs.includes("preferences") &&
        profileTabs.includes("security") &&
        profileTabs.includes("api-tokens")
    );
    await page.screenshot({ path: path.join(OUTPUT, "profile-390.png") });
    await page.keyboard.press("Escape");
    await page.locator("[data-mobile-navigation] button").last().click();
    await page.locator("[role=dialog] input").first().waitFor({ state: "visible" });
    assert.ok((await page.getByRole("dialog").innerText()).length > 40, "Native creation form is usable on mobile");
    await page.keyboard.press("Escape");
    await page.locator("[role=dialog] input").first().waitFor({ state: "hidden" });

    const routes = [
      ["cycles", `/hentis/projects/${PROJECT}/cycles/`],
      ["modules", `/hentis/projects/${PROJECT}/modules/`],
      ["pages", `/hentis/projects/${PROJECT}/pages/`],
      ["personal-pages", "/hentis/pages/"],
      ["views", `/hentis/projects/${PROJECT}/views/`],
      ["settings", "/hentis/settings/"],
      ["browse", "/hentis/browse/HNT-1/"],
    ];
    const report = {
      links,
      routes: [],
      errors: state.errors,
      consoleErrors: state.consoleErrors,
      failed: state.requestsFailed,
    };
    for (const [name, route] of routes) {
      const before = state.errors.length;
      await visit(state, route);
      if (["cycles", "modules"].includes(name)) {
        await page.getByRole("button", { name: "Layout", exact: true }).click();
        assert.ok(
          (await page.getByRole("menuitem").count()) >= 3,
          "List, board and Gantt must all be available on mobile"
        );
        await page.keyboard.press("Escape");
      }
      await page.screenshot({ path: path.join(OUTPUT, `${name}-390.png`) });
      report.routes.push({
        name,
        url: page.url(),
        body: (await page.locator("body").innerText()).slice(0, 3500),
        errors: state.errors.slice(before),
      });
    }
    await page.locator("[data-mobile-issue-tabs]").waitFor();
    const tabs = page.locator("[data-mobile-issue-tabs] [role=tab]");
    assert.equal(await tabs.count(), 4);
    const content = page.locator("[data-mobile-issue-panel=content]");
    const editor = content.locator("[contenteditable=true]").first();
    await editor.waitFor();
    await editor.fill("Rascunho preservado entre abas");
    const editorHandle = await editor.elementHandle();
    await tabs.nth(1).click();
    const properties = page.locator("[data-mobile-issue-panel=properties]");
    await properties.waitFor({ state: "visible" });
    const longText = properties.getByRole("textbox", { name: "Pendência principal" });
    await longText.waitFor();
    await longText.fill("Não salvar esta alteração");
    await properties.locator("[data-long-text-editor]").getByRole("button", { name: "Cancelar", exact: true }).click();
    assert.equal(data.fields[FIELD], "Valor original");
    assert.equal(await longText.inputValue(), "Valor original");
    await longText.fill("Rascunho preservado ao girar");
    const fieldHandle = await longText.elementHandle();
    for (const width of [768, 1440, 390, 320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction((expectedWidth) => innerWidth === expectedWidth, width);
      await page
        .locator(width < 768 ? "[data-mobile-navigation]" : "[data-issue-panel=properties]")
        .waitFor({ state: "visible" });
      assert.ok(await fieldHandle.evaluate((element) => element.isConnected));
      assert.equal(await fieldHandle.inputValue(), "Rascunho preservado ao girar");
    }
    await longText.fill("Pendência atualizada no celular");
    await properties.locator("[data-long-text-editor]").getByRole("button", { name: "Salvar", exact: true }).click();
    await page.waitForFunction(
      ({ key, value }) => document.querySelector(`textarea[aria-label="${key}"]`)?.value === value,
      { key: "Pendência principal", value: "Pendência atualizada no celular" }
    );
    assert.equal(data.fields[FIELD], "Pendência atualizada no celular");
    assert.ok(
      data.writes.some(
        (write) =>
          write.method === "PATCH" &&
          write.path.includes("/custom-fields/issues/") &&
          write.body.values[FIELD] === "Pendência atualizada no celular"
      )
    );
    await tabs.nth(2).click();
    await page.locator("[data-mobile-issue-panel=comments]").waitFor({ state: "visible" });
    await tabs.nth(3).click();
    await page.locator("[data-mobile-issue-panel=attachments]").waitFor({ state: "visible" });
    await tabs.nth(0).click();
    assert.ok((await editor.innerText()).includes("Rascunho preservado entre abas"));
    assert.ok(await editor.evaluate((element, original) => element === original, editorHandle));
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForFunction((width) => innerWidth === width, viewport.width);
      const layout = await page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        app: document.querySelector(".desktop-app-container").getBoundingClientRect().width,
      }));
      assert.ok(layout.document <= layout.viewport + 1, JSON.stringify({ viewport, layout }));
      assert.equal(layout.app, viewport.width);
      if (viewport.width < 768) await page.locator("[data-mobile-navigation]").waitFor({ state: "visible" });
      else await page.locator("[data-mobile-navigation]").waitFor({ state: "hidden" });
      assert.ok((await editorHandle.innerText()).includes("Rascunho preservado entre abas"));
      assert.ok(await editorHandle.evaluate((element) => element.isConnected));
      await page.screenshot({ path: path.join(OUTPUT, `detail-${viewport.width}.png`) });
    }
    report.writes = data.writes;
    report.calls = data.calls;
    report.unknown = [...new Set(data.unknown)];
    fs.writeFileSync(path.join(OUTPUT, "report.json"), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify(
        {
          navigationDestinations: links.length,
          renderedRoutes: report.routes.map((route) => route.name),
          nativeCustomFieldPatch: true,
          editorPreserved: true,
          viewports: [320, 390, 768, 1440],
          errors: [...new Set(state.errors)],
          artifacts: OUTPUT,
        },
        null,
        2
      )
    );
    if (process.env.PLANE_TEST_DIAGNOSTIC !== "1")
      assert.deepEqual(state.errors, [], "Native application must render without browser runtime errors.");
  } catch (error) {
    await page.screenshot({ path: path.join(OUTPUT, "failure.png") }).catch(() => {});
    const failure = {
      error: error.message,
      url: page.url(),
      body: (await page.locator("body").innerText()).slice(0, 4000),
      errors: [...new Set(state.errors)],
      consoleErrors: [...new Set(state.consoleErrors)],
      failed: state.requestsFailed,
      calls: data.calls,
      unknown: [...new Set(data.unknown)],
    };
    fs.writeFileSync(path.join(OUTPUT, "failure.json"), JSON.stringify(failure, null, 2));
    console.error(
      JSON.stringify(
        { ...failure, consoleErrors: failure.consoleErrors.slice(0, 4), calls: data.calls.length },
        null,
        2
      )
    );
    throw error;
  } finally {
    await state.context.close();
  }
})()
  .catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  });
