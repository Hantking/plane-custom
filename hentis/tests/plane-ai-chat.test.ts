import assert from "node:assert/strict";
import { test } from "node:test";
import {
  availableModels,
  catalogSelection,
  modelFamily,
  resolveModel,
  toggleModel,
} from "../../apps/web/core/components/plane-ai/model-helpers";
import { chatStarters, displayAIResponse, reportCSV } from "../../apps/web/core/components/plane-ai/chat-helpers";
import type { AICatalogModel, AIConnection, AIModel, AIReport } from "../../apps/web/core/components/plane-ai/service";

const model = (id: string, tools = true): AIModel => ({
  id,
  capabilities: { tools, streaming: true, system: true, embeddings: false, structured: false, multimodal: false },
  output_parameter: "max_tokens",
  parameters: {},
});
const connections: AIConnection[] = [
  {
    id: "provider-one",
    name: "Multi-model",
    default_model: "openai/gpt-default",
    models: [model("anthropic/claude"), model("openai/gpt-default")],
  },
  { id: "provider-two", name: "Other", default_model: "model:version", models: [model("model:version", false)] },
];
const catalog = (id: string, tools = true): AICatalogModel => ({
  id,
  name: id,
  configuration: model(id, tools),
  capability_source: "provider",
  description: "",
  context_tokens: 32000,
});

test("one picker exposes every configured provider and keeps namespaced model IDs intact", () => {
  assert.equal(availableModels(connections).length, 3);
  const choice = resolveModel(connections, "provider-two:model:version");
  assert.equal(choice?.model.id, "model:version");
  assert.equal(choice?.connection.id, "provider-two");
});

test("automatic mode uses the administrator default instead of alphabetical or array model order", () => {
  assert.equal(resolveModel(connections, "auto")?.model.id, "openai/gpt-default");
  assert.equal(resolveModel([], "auto"), undefined);
});

test("removing an explicitly selected model never silently changes the provider", () => {
  assert.equal(resolveModel(connections, "removed:model"), undefined);
});

test("catalog loading selects compatible suggestions without requiring manual model IDs", () => {
  const models = catalogSelection([catalog("chat-only", false), catalog("with-tools"), catalog("another")], []);
  assert.deepEqual(
    models.map((item) => item.id),
    ["with-tools", "another"]
  );
  assert.equal(catalogSelection([catalog("chat-only", false)], [])[0].id, "chat-only");
});

test("refreshing a catalog preserves selected models and advanced parameters", () => {
  const previous = [{ ...model("existing"), parameters: { temperature: 0.25 } }];
  assert.equal(catalogSelection([catalog("new")], previous), previous);
});

test("disabling the default selects a remaining enabled model without mutating previous configuration", () => {
  const original = [model("a"), model("b")];
  assert.deepEqual(toggleModel(original, original[0], "a"), { models: [original[1]], default_model: "b" });
  assert.equal(original.length, 2);
  assert.equal(toggleModel([original[0]], original[0], "a").default_model, "");
});

test("enabling models respects the server authorization limit", () => {
  const original = Array.from({ length: 30 }, (_, index) => model(`model-${index}`));
  assert.equal(toggleModel(original, model("overflow"), "model-0").models.length, 30);
});

test("model families work for provider-qualified IDs", () => {
  assert.equal(modelFamily("anthropic/claude-sonnet"), "Claude");
  assert.equal(modelFamily("google/gemini-2.5-pro"), "Gemini");
  assert.equal(modelFamily("openai/o3-mini"), "GPT");
  assert.equal(modelFamily("internal:custom"), "Outros");
});

test("report CSV preserves numbers and quotes while neutralizing formula-like group names", () => {
  const report: AIReport = {
    id: "overview:project",
    title: "Progress",
    kind: "overview",
    group_by: "project",
    metrics: { total: 2, completed: 0, overdue: 1, in_progress: 0, completion_percent: 0 },
    period: null,
    as_of: "2026-10-23T12:00:00Z",
    timezone: "UTC",
    truncated: false,
    definition: "Exact totals",
    columns: ["Projeto", "Total"],
    rows: [
      [' =HYPERLINK("bad")', 2],
      ["Name; with\nline", -1],
    ],
    row_ids: ["a", "b"],
  };
  const csv = reportCSV(report);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\' =HYPERLINK(""bad"")";"2"'));
  assert.ok(csv.includes('"Name; with\nline";"-1"'));
});

test("chat starters are actionable prompts for search, reports and writing", () => {
  assert.equal(new Set(chatStarters.map((item) => item.title)).size, chatStarters.length);
  assert.ok(chatStarters.some((item) => item.prompt.includes("carga de trabalho")));
  assert.ok(chatStarters.some((item) => item.prompt.includes("fontes")));
});

test("historical provider tool markup is not displayed as the assistant answer", () => {
  const call = "<tool_call><function=search_workspace><parameter=query>Cliente</parameter></function></tool_call>";
  assert.equal(displayAIResponse(call + call), "");
  assert.equal(displayAIResponse("Resposta final.\n" + call), "Resposta final.");
  assert.equal(displayAIResponse("Buscando… <tool_call><function="), "Buscando…");
});
