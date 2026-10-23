import { useRef, useState } from "react";
import { useParams } from "react-router";
import useSWR, { mutate } from "swr";
import { Check, CheckCircle2, ChevronRight, Loader2, Plug, Search, Settings2, Sparkles } from "lucide-react";
import { Button } from "@plane/propel/button";
import { planeAI, aiError, aiInputClass } from "./service";
import type { AICatalogModel, AIConnection, AIModel } from "./service";
import { catalogSelection, modelFamily, providerPresets, toggleModel } from "./model-helpers";

type Connection = AIConnection & {
  base_url: string;
  has_api_key: boolean;
  protocol: string;
  purpose: string;
  context_tokens: number;
  output_tokens: number;
  timeout_seconds: number;
  allowed_roles: number[];
  enabled: boolean;
};
type Policy = {
  enabled: boolean;
  instructions: string;
  user_daily_limit: number;
  workspace_daily_limit: number;
  retention_days: number;
};
type Draft = Omit<Connection, "id" | "has_api_key">;
const empty = (): Draft => ({
  name: "OpenRouter",
  base_url: providerPresets[0].url,
  protocol: "chat_completions",
  purpose: "chat",
  models: [],
  default_model: "",
  context_tokens: 24000,
  output_tokens: 2000,
  timeout_seconds: 90,
  allowed_roles: [15, 20],
  enabled: true,
});
const fallbackModel = (id: string): AIModel => ({
  id,
  capabilities: {
    streaming: false,
    tools: false,
    system: true,
    structured: false,
    embeddings: false,
    multimodal: false,
  },
  parameters: {},
  output_parameter: "max_tokens",
});

export function PlaneAISettings() {
  const { workspaceSlug = "" } = useParams();
  const policy = useSWR(["ai-policy", workspaceSlug], () => planeAI.read<Policy>(workspaceSlug, "settings/"));
  const connections = useSWR(["ai-connections", workspaceSlug], () =>
    planeAI.read<Connection[]>(workspaceSlug, "connections/")
  );
  const [draftPolicy, setPolicy] = useState<Policy | null>(null);
  const [draft, setDraft] = useState(empty);
  const [provider, setProvider] = useState<string>("openrouter");
  const [editing, setEditing] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [replaceKey, setReplaceKey] = useState(false);
  const [catalog, setCatalog] = useState<AICatalogModel[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [manual, setManual] = useState("");
  const catalogRequest = useRef(0);
  const currentPolicy = draftPolicy ?? policy.data;
  const refresh = async () => {
    await connections.mutate();
    await mutate((key: unknown) => Array.isArray(key) && key[0] === "plane-ai" && key[1] === workspaceSlug);
  };
  const discover = async (value = draft, id = editing, key = apiKey, replace = replaceKey) => {
    const request = ++catalogRequest.current;
    setBusy("catalog");
    setError("");
    setMessage("");
    try {
      const result = await planeAI.create<{ models: AICatalogModel[] }>(workspaceSlug, "catalog/", {
        base_url: value.base_url,
        purpose: value.purpose,
        ...(id ? { connection_id: id } : {}),
        ...(!id || replace ? { api_key: key } : {}),
      });
      if (request !== catalogRequest.current) return;
      setCatalog(result.models);
      setLoaded(true);
      setFamily("");
      const models = catalogSelection(result.models, value.models);
      setDraft((current) => ({
        ...current,
        models,
        default_model: models.some((model) => model.id === current.default_model)
          ? current.default_model
          : (models[0]?.id ?? ""),
      }));
      setMessage(
        result.models.length
          ? `${result.models.length} modelos encontrados. Escolha quais ficarão disponíveis no chat.`
          : "O provedor não retornou modelos para esta finalidade. Você pode informar um ID em Opções avançadas."
      );
    } catch (failure) {
      if (request === catalogRequest.current) setError(aiError(failure));
    } finally {
      if (request === catalogRequest.current) setBusy("");
    }
  };
  const reset = () => {
    catalogRequest.current++;
    setEditing("");
    setDraft(empty());
    setProvider("openrouter");
    setApiKey("");
    setReplaceKey(false);
    setCatalog([]);
    setLoaded(false);
    setQuery("");
    setFamily("");
    setError("");
    setMessage("");
  };
  const save = async () => {
    setBusy("save");
    setError("");
    try {
      const data = { ...draft, ...(!editing || replaceKey ? { api_key: apiKey } : {}) };
      if (editing) await planeAI.update(workspaceSlug, `connections/${editing}/`, data);
      else await planeAI.create(workspaceSlug, "connections/", data);
      await refresh();
      reset();
      setMessage("Conexão salva. Os modelos escolhidos já estão disponíveis no seletor do chat.");
    } catch (failure) {
      setError(aiError(failure));
    } finally {
      setBusy("");
    }
  };
  const test = async (connection: Connection, model = connection.default_model) => {
    setBusy(connection.id);
    setError("");
    setMessage("");
    try {
      const result = await planeAI.create<{ tool_call_observed: boolean }>(
        workspaceSlug,
        `connections/${connection.id}/test/`,
        { model }
      );
      setMessage(
        `Conexão funcionando com ${model}.${result.tool_call_observed ? " O modelo também respondeu com uma chamada de ferramenta." : " Resposta de teste recebida."}`
      );
    } catch (failure) {
      setError(aiError(failure));
    } finally {
      setBusy("");
    }
  };
  const models = [
    ...catalog,
    ...draft.models
      .filter((model) => !catalog.some((item) => item.id === model.id))
      .map((model) => ({
        id: model.id,
        name: model.id,
        description: "Modelo já habilitado nesta conexão",
        context_tokens: null,
        capability_source: "unknown" as const,
        configuration: model,
      })),
  ];
  const visible = models.filter(
    (model) =>
      (!family || modelFamily(model.id) === family) &&
      `${model.id} ${model.name}`.toLowerCase().includes(query.toLowerCase())
  );
  const choose = (model: AIModel) =>
    setDraft((current) => ({ ...current, ...toggleModel(current.models, model, current.default_model) }));
  return (
    <main className="size-full overflow-y-auto bg-surface-1 p-4 text-13 text-primary md:p-8">
      <div className="mx-auto max-w-5xl space-y-7">
        <header className="space-y-2">
          <div className="flex items-center gap-2 text-accent-primary">
            <Sparkles size={20} />
            <span className="font-semibold">Plane AI</span>
          </div>
          <h1 className="text-2xl font-semibold">Seus modelos. O contexto do seu trabalho.</h1>
          <p className="max-w-2xl text-secondary">
            Conecte um provedor, carregue seu catálogo e escolha os modelos. Sua equipe troca de modelo no chat para
            buscar informações, analisar projetos e gerar relatórios.
          </p>
        </header>
        {(error || policy.error || connections.error) && (
          <p role="alert" className="rounded-lg border border-danger-strong bg-layer-1 p-3 text-danger-primary">
            {error || aiError(policy.error ?? connections.error)}
          </p>
        )}
        {message && (
          <p role="status" className="flex items-start gap-2 rounded-lg border border-subtle bg-layer-1 p-3">
            <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-accent-primary" />
            {message}
          </p>
        )}
        {currentPolicy && (
          <section className="rounded-xl border border-subtle p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">IA no workspace</h2>
                <p className="text-secondary">Defina as instruções e os limites da sua equipe.</p>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={currentPolicy.enabled}
                  onChange={(event) => setPolicy({ ...currentPolicy, enabled: event.target.checked })}
                />
                Habilitar Plane AI
              </label>
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-secondary">Instruções, limites e retenção</summary>
              <div className="mt-3 space-y-3">
                <label className="block">
                  Instruções do workspace
                  <textarea
                    className={aiInputClass}
                    rows={3}
                    maxLength={6000}
                    value={currentPolicy.instructions}
                    onChange={(event) => setPolicy({ ...currentPolicy, instructions: event.target.value })}
                  />
                </label>
                <div className="grid gap-3 md:grid-cols-3">
                  {(
                    [
                      ["user_daily_limit", "Solicitações por usuário/dia"],
                      ["workspace_daily_limit", "Solicitações do workspace/dia"],
                      ["retention_days", "Retenção em dias"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        min={1}
                        className={aiInputClass}
                        value={currentPolicy[key]}
                        onChange={(event) => setPolicy({ ...currentPolicy, [key]: Number(event.target.value) })}
                      />
                    </label>
                  ))}
                </div>
              </div>
            </details>
            <Button
              className="mt-3"
              variant="secondary"
              onClick={async () => {
                try {
                  await planeAI.update(workspaceSlug, "settings/", currentPolicy);
                  await policy.mutate();
                  await refresh();
                  setPolicy(null);
                  setMessage("Política do workspace atualizada.");
                } catch (failure) {
                  setError(aiError(failure));
                }
              }}
            >
              Salvar política
            </Button>
          </section>
        )}
        {!!connections.data?.length && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Conexões da equipe</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {connections.data.map((connection) => (
                <article key={connection.id} className="space-y-3 rounded-xl border border-subtle p-4">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="flex items-center gap-2">
                      <Plug size={17} />
                      {connection.name}
                    </strong>
                    <span className="text-11 text-secondary">{connection.enabled ? "Ativa" : "Desativada"}</span>
                  </div>
                  <p className="truncate text-11 text-secondary">{connection.base_url}</p>
                  <div className="flex flex-wrap gap-1">
                    {connection.models.map((model) => (
                      <span key={model.id} className="rounded bg-layer-1 px-2 py-1 text-11">
                        {model.id}
                        {model.id === connection.default_model ? " · padrão" : ""}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      disabled={!!busy}
                      onClick={() => {
                        const { id, has_api_key: _key, ...value } = connection;
                        setEditing(id);
                        setDraft(value);
                        setApiKey("");
                        setReplaceKey(false);
                        setCatalog([]);
                        setLoaded(false);
                        setQuery("");
                        setError("");
                        setMessage("");
                        setProvider(providerPresets.find((item) => item.url === value.base_url)?.id ?? "custom");
                        void discover(value, id, "", false);
                      }}
                    >
                      Editar modelos
                    </Button>
                    <Button variant="secondary" disabled={!!busy} onClick={() => void test(connection)}>
                      Testar conexão
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!!busy}
                      onClick={async () => {
                        try {
                          await planeAI.remove(workspaceSlug, `connections/${connection.id}/`);
                          await refresh();
                        } catch (failure) {
                          setError(aiError(failure));
                        }
                      }}
                    >
                      Excluir
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="space-y-5 rounded-xl border border-subtle p-5"
          aria-label="Configurar conexão de IA"
        >
          <fieldset disabled={!!busy} className="space-y-5">
            <h2 className="text-lg font-semibold">{editing ? `Editar ${draft.name}` : "Conectar provedor"}</h2>
            {!editing && (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {providerPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={provider === preset.id}
                    className={`rounded-lg border p-3 text-left ${provider === preset.id ? "border-accent-strong bg-layer-1" : "border-subtle"}`}
                    onClick={() => {
                      setProvider(preset.id);
                      setDraft({ ...empty(), name: preset.id === "custom" ? "" : preset.name, base_url: preset.url });
                      setCatalog([]);
                      setLoaded(false);
                      setError("");
                      setApiKey("");
                      setFamily("");
                    }}
                  >
                    <span className="flex justify-between font-semibold">
                      {preset.name}
                      {provider === preset.id && <Check size={15} />}
                    </span>
                    <span className="mt-1 block text-11 text-secondary">{preset.description}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <label>
                Nome da conexão
                <input
                  required
                  className={aiInputClass}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <label>
                Base URL
                <input
                  required
                  type="url"
                  className={aiInputClass}
                  value={draft.base_url}
                  placeholder="https://seu-provedor/v1"
                  onChange={(event) => {
                    setDraft({ ...draft, base_url: event.target.value, models: [], default_model: "" });
                    setCatalog([]);
                    setLoaded(false);
                    if (editing) {
                      setReplaceKey(true);
                      setApiKey("");
                    }
                  }}
                />
              </label>
            </div>
            {editing && (
              <label className="flex gap-2">
                <input type="checkbox" checked={replaceKey} onChange={(event) => setReplaceKey(event.target.checked)} />
                Alterar a chave desta conexão
              </label>
            )}
            <label className="block">
              Chave da API
              <input
                type="password"
                autoComplete="new-password"
                disabled={!!editing && !replaceKey}
                placeholder={editing && !replaceKey ? "Credencial existente preservada" : "Chave do provedor"}
                className={aiInputClass}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" disabled={!!busy || !draft.base_url} onClick={() => void discover()}>
                {busy === "catalog" ? <Loader2 size={15} className="animate-spin" /> : <Plug size={15} />}
                {loaded ? "Atualizar catálogo" : "Conectar e carregar modelos"}
              </Button>
              <span className="text-11 text-secondary">
                O catálogo usa sua credencial, sem precisar salvar a conexão primeiro.
              </span>
            </div>
            {(loaded || models.length > 0) && (
              <section className="space-y-3 border-t border-subtle pt-4" aria-label="Catálogo de modelos">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Escolha os modelos do chat</h3>
                  <span className="text-11 text-secondary">{draft.models.length}/30 habilitados</span>
                </div>
                <div className="flex items-center gap-2">
                  <Search size={16} />
                  <input
                    aria-label="Buscar modelos disponíveis"
                    className={aiInputClass}
                    placeholder="Buscar GPT, Claude, Gemini, Llama…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {["", ...new Set(models.map((model) => modelFamily(model.id)))].map((name) => (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={family === name}
                      onClick={() => setFamily(name)}
                      className={`rounded-full border px-3 py-1 text-11 ${family === name ? "border-accent-strong bg-layer-1" : "border-subtle"}`}
                    >
                      {name || "Todos"}
                    </button>
                  ))}
                </div>
                <div className="grid max-h-96 gap-2 overflow-y-auto md:grid-cols-2">
                  {visible.map((model) => {
                    const selected = draft.models.some((item) => item.id === model.id);
                    return (
                      <label
                        key={model.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${selected ? "border-accent-strong bg-layer-1" : "border-subtle"}`}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Habilitar ${model.name}`}
                          checked={selected}
                          disabled={!selected && draft.models.length >= 30}
                          onChange={() =>
                            choose(draft.models.find((item) => item.id === model.id) ?? model.configuration)
                          }
                        />
                        <span className="min-w-0">
                          <strong className="block truncate">{model.name}</strong>
                          <span className="block truncate text-11 text-secondary">{model.id}</span>
                          <span className="mt-1 block text-11 text-secondary">
                            {model.configuration.capabilities.tools
                              ? "Busca e ações com ferramentas"
                              : "Conversa e contexto do workspace"}
                            {model.context_tokens ? ` · ${Math.round(model.context_tokens / 1000)}k contexto` : ""}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {!visible.length && <p className="text-secondary">Nenhum modelo corresponde à busca.</p>}
                <label className="block">
                  Modelo padrão
                  <select
                    required
                    aria-label="Modelo padrão da conexão"
                    className={aiInputClass}
                    value={draft.default_model}
                    onChange={(event) => setDraft({ ...draft, default_model: event.target.value })}
                  >
                    <option value="">Selecione um modelo</option>
                    {draft.models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {models.find((item) => item.id === model.id)?.name ?? model.id}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-11 text-secondary">
                  Capacidades usam metadados do provedor quando disponíveis e perfis de compatibilidade para famílias
                  conhecidas. Teste a conexão; ajustes individuais ficam nas opções avançadas.
                </p>
              </section>
            )}
            <details className="border-t border-subtle pt-3">
              <summary className="flex cursor-pointer items-center gap-2 text-secondary">
                <Settings2 size={15} />
                Opções avançadas
                <ChevronRight size={13} />
              </summary>
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  {(
                    [
                      ["context_tokens", "Janela de contexto"],
                      ["output_tokens", "Limite de saída"],
                      ["timeout_seconds", "Timeout em segundos"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        className={aiInputClass}
                        type="number"
                        min={1}
                        value={draft[key]}
                        onChange={(event) => setDraft({ ...draft, [key]: Number(event.target.value) })}
                      />
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap gap-4">
                  {(
                    [
                      [20, "Administradores"],
                      [15, "Membros"],
                      [5, "Convidados"],
                    ] as const
                  ).map(([role, label]) => (
                    <label key={role} className="flex gap-2">
                      <input
                        type="checkbox"
                        checked={draft.allowed_roles.includes(role)}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            allowed_roles: event.target.checked
                              ? [...draft.allowed_roles, role]
                              : draft.allowed_roles.filter((item) => item !== role),
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                  />
                  Conexão ativa
                </label>
                <label className="block">
                  Finalidade
                  <select
                    className={aiInputClass}
                    value={draft.purpose}
                    onChange={(event) => {
                      setDraft({ ...draft, purpose: event.target.value, models: [], default_model: "" });
                      setCatalog([]);
                      setLoaded(false);
                    }}
                  >
                    <option value="chat">Conversa</option>
                    <option value="embedding">Embeddings</option>
                  </select>
                </label>
                <div className="flex gap-2">
                  <input
                    aria-label="ID manual de modelo"
                    className={aiInputClass}
                    value={manual}
                    onChange={(event) => setManual(event.target.value)}
                    placeholder="Modelo não listado pelo provedor"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!manual.trim() || draft.models.some((item) => item.id === manual.trim())}
                    onClick={() => {
                      choose(fallbackModel(manual.trim()));
                      setManual("");
                    }}
                  >
                    Adicionar ID
                  </Button>
                </div>
                {draft.models.map((model) => (
                  <details key={model.id} className="rounded-lg border border-subtle p-3">
                    <summary className="cursor-pointer font-medium">{model.id}</summary>
                    <div className="mt-3 space-y-3">
                      <div className="flex flex-wrap gap-3">
                        {Object.keys(model.capabilities).map((capability) => {
                          const key = capability as keyof AIModel["capabilities"];
                          return (
                            <label key={key} className="flex gap-1">
                              <input
                                type="checkbox"
                                checked={model.capabilities[key]}
                                onChange={(event) =>
                                  setDraft({
                                    ...draft,
                                    models: draft.models.map((item) =>
                                      item.id === model.id
                                        ? {
                                            ...item,
                                            capabilities: { ...item.capabilities, [key]: event.target.checked },
                                          }
                                        : item
                                    ),
                                  })
                                }
                              />
                              {key}
                            </label>
                          );
                        })}
                      </div>
                      <label className="block">
                        Parâmetro de saída
                        <select
                          className={aiInputClass}
                          value={model.output_parameter ?? "max_tokens"}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              models: draft.models.map((item) =>
                                item.id === model.id
                                  ? { ...item, output_parameter: event.target.value as AIModel["output_parameter"] }
                                  : item
                              ),
                            })
                          }
                        >
                          <option>max_tokens</option>
                          <option>max_completion_tokens</option>
                          <option value="none">Não enviar</option>
                        </select>
                      </label>
                      <label className="block">
                        Parâmetros de geração (JSON)
                        <textarea
                          className={aiInputClass}
                          rows={2}
                          defaultValue={JSON.stringify(model.parameters ?? {})}
                          onBlur={(event) => {
                            try {
                              const parameters = JSON.parse(event.target.value) as Record<string, unknown>;
                              setDraft({
                                ...draft,
                                models: draft.models.map((item) =>
                                  item.id === model.id ? { ...item, parameters } : item
                                ),
                              });
                            } catch {
                              setError("JSON de parâmetros inválido.");
                            }
                          }}
                        />
                      </label>
                    </div>
                  </details>
                ))}
              </div>
            </details>
            <div className="flex gap-2 border-t border-subtle pt-4">
              <Button type="submit" disabled={!!busy || !draft.models.length || !draft.default_model}>
                {busy === "save" && <Loader2 size={15} className="animate-spin" />}Salvar conexão e modelos
              </Button>
              <Button type="button" variant="secondary" disabled={!!busy} onClick={reset}>
                Nova conexão
              </Button>
            </div>
          </fieldset>
        </form>
      </div>
    </main>
  );
}
