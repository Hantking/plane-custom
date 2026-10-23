import type { AICatalogModel, AIConnection, AIModel } from "./service";

export const providerPresets = [
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "GPT, Claude, Gemini e outros em uma conexão",
    url: "https://openrouter.ai/api/v1",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "Modelos disponíveis na sua conta OpenAI",
    url: "https://api.openai.com/v1",
  },
  {
    id: "groq",
    name: "Groq",
    description: "Modelos disponíveis na sua conta Groq",
    url: "https://api.groq.com/openai/v1",
  },
  { id: "custom", name: "Outro provedor", description: "Endpoint compatível com Chat Completions", url: "" },
] as const;

export function modelFamily(id: string) {
  const value = id.toLowerCase();
  if (value.includes("claude")) return "Claude";
  if (value.includes("gemini")) return "Gemini";
  if (value.includes("gpt") || /(?:^|\/)o[134](?:-|$)/.test(value)) return "GPT";
  if (value.includes("deepseek")) return "DeepSeek";
  if (value.includes("llama")) return "Llama";
  if (value.includes("qwen")) return "Qwen";
  return "Outros";
}

export function catalogSelection(catalog: AICatalogModel[], current: AIModel[]) {
  if (current.length) return current;
  const usable = catalog.filter((model) => model.configuration.capabilities.tools);
  return (usable.length ? usable : catalog).slice(0, 3).map((model) => model.configuration);
}

export function toggleModel(models: AIModel[], model: AIModel, defaultModel: string) {
  const selected = models.some((item) => item.id === model.id);
  const next = selected
    ? models.filter((item) => item.id !== model.id)
    : models.length < 30
      ? [...models, model]
      : models;
  return {
    models: next,
    default_model: next.some((item) => item.id === defaultModel) ? defaultModel : (next[0]?.id ?? ""),
  };
}

export function availableModels(connections: AIConnection[]) {
  return connections.flatMap((connection) =>
    connection.models.map((model) => ({
      key: `${connection.id}:${model.id}`,
      connection,
      model,
      family: modelFamily(model.id),
    }))
  );
}

export function resolveModel(connections: AIConnection[], selected: string) {
  const options = availableModels(connections);
  if (selected && selected !== "auto") return options.find((item) => item.key === selected);
  const connection = connections[0];
  return (
    options.find((item) => item.connection.id === connection?.id && item.model.id === connection.default_model) ??
    options[0]
  );
}
