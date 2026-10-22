import { useState } from "react";
import { useParams } from "react-router";
import useSWR from "swr";
import { Button } from "@plane/propel/button";
import { planeAI, aiError, aiInputClass } from "./service";
import type { AIConnection, AIModel } from "./service";

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
const CAPS = ["streaming", "tools", "structured", "system", "embeddings", "multimodal"] as const;
type DraftModel = AIModel & { _key: string };
type DraftConnection = Omit<Connection, "id" | "models"> & { models: DraftModel[] };
const EMPTY_MODEL = (): DraftModel => ({
  _key: crypto.randomUUID(),
  id: "",
  capabilities: {
    streaming: false,
    tools: false,
    structured: false,
    system: true,
    embeddings: false,
    multimodal: false,
  },
  parameters: {},
  output_parameter: "max_tokens",
});
const emptyConnection = (): DraftConnection => ({
  name: "",
  base_url: "",
  has_api_key: false,
  protocol: "chat_completions",
  purpose: "chat",
  models: [EMPTY_MODEL()],
  default_model: "",
  context_tokens: 16000,
  output_tokens: 1000,
  timeout_seconds: 60,
  allowed_roles: [15, 20],
  enabled: true,
});

export function PlaneAISettings() {
  const { workspaceSlug = "" } = useParams();
  const policy = useSWR(["ai-policy", workspaceSlug], () => planeAI.read<Policy>(workspaceSlug, "settings/"));
  const connections = useSWR(["ai-connections", workspaceSlug], () =>
    planeAI.read<Connection[]>(workspaceSlug, "connections/")
  );
  const metrics = useSWR(["ai-metrics", workspaceSlug], () =>
    planeAI.read<Record<string, unknown>>(workspaceSlug, "metrics/")
  );
  const [draftPolicy, setPolicy] = useState<Policy | null>(null);
  const [draft, setDraft] = useState(emptyConnection());
  const [editing, setEditing] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [replaceKey, setReplaceKey] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const currentPolicy = draftPolicy ?? policy.data;
  const updateModel = (index: number, value: Partial<AIModel>) =>
    setDraft((current) => ({
      ...current,
      models: current.models.map((m, i) => (i === index ? { ...m, ...value } : m)),
    }));
  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      const { has_api_key: _hasKey, ...payload } = draft;
      const data = {
        ...payload,
        models: payload.models.map(({ _key, ...model }) => model),
        ...(replaceKey || !editing ? { api_key: apiKey } : {}),
      };
      if (editing) await planeAI.update(workspaceSlug, `connections/${editing}/`, data);
      else await planeAI.create(workspaceSlug, "connections/", data);
      await connections.mutate();
      setDraft(emptyConnection());
      setEditing("");
      setApiKey("");
      setReplaceKey(false);
      setMessage("Conexão salva. Teste cada modelo antes de disponibilizá-lo à equipe.");
    } catch (failure) {
      setMessage(aiError(failure));
    } finally {
      setSaving(false);
    }
  };
  return (
    <main className="size-full space-y-6 overflow-y-auto p-6 text-13 text-primary">
      <h1 className="text-xl font-semibold">Inteligência Artificial · Plane AI</h1>
      {metrics.data && (
        <details className="max-w-3xl rounded border border-subtle p-3">
          <summary>Uso, latência e falhas · últimos 30 dias</summary>
          <pre className="overflow-auto text-11">{JSON.stringify(metrics.data, null, 2)}</pre>
        </details>
      )}
      <p className="text-secondary">
        Conexões são chamadas somente pelo backend. As credenciais são criptografadas e nunca retornam nesta tela. A
        instalação deve definir PLANE_AI_ENABLED, PLANE_AI_ENCRYPTION_KEY e PLANE_AI_ALLOWED_HOSTS.
      </p>
      {(message || policy.error || connections.error) && (
        <p role="status" className="rounded border border-subtle p-3 whitespace-pre-wrap">
          {message || aiError(policy.error ?? connections.error)}
        </p>
      )}
      {currentPolicy && (
        <section className="max-w-3xl space-y-3 rounded border border-subtle p-4">
          <h2 className="font-semibold">Política do workspace</h2>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={currentPolicy.enabled}
              onChange={(e) => setPolicy({ ...currentPolicy, enabled: e.target.checked })}
            />
            Habilitar Plane AI neste workspace
          </label>
          <label className="block">
            Instruções compartilhadas
            <textarea
              className={aiInputClass}
              rows={3}
              value={currentPolicy.instructions}
              maxLength={6000}
              onChange={(e) => setPolicy({ ...currentPolicy, instructions: e.target.value })}
            />
          </label>
          {(
            [
              ["user_daily_limit", "Solicitações diárias por usuário"],
              ["workspace_daily_limit", "Solicitações diárias no workspace"],
              ["retention_days", "Retenção de conversas (dias)"],
            ] as const
          ).map(([key, label]) => (
            <label className="block" key={key}>
              {label}
              <input
                className={aiInputClass}
                type="number"
                min={1}
                value={currentPolicy[key]}
                onChange={(e) => setPolicy({ ...currentPolicy, [key]: Number(e.target.value) })}
              />
            </label>
          ))}
          <Button
            onClick={async () => {
              try {
                await planeAI.update(workspaceSlug, "settings/", currentPolicy);
                await policy.mutate();
                setMessage("Política salva. Recarregue o workspace para atualizar a navegação.");
              } catch (failure) {
                setMessage(aiError(failure));
              }
            }}
          >
            Salvar política
          </Button>
        </section>
      )}
      <section className="max-w-3xl space-y-3">
        <h2 className="font-semibold">Conexões cadastradas</h2>
        {connections.data?.map((connection) => (
          <div key={connection.id} className="space-y-2 rounded border border-subtle p-3">
            <p>
              <strong>{connection.name}</strong> · {connection.enabled ? "Ativa" : "Desativada"} · {connection.purpose}{" "}
              · {connection.has_api_key ? "Credencial configurada" : "Sem credencial"}
            </p>
            <p>{connection.base_url}</p>
            <p>Modelos: {connection.models.map((m) => m.id).join(", ")}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  const { id, ...value } = connection;
                  setEditing(id);
                  setDraft({
                    ...value,
                    models: value.models.map((model) => Object.assign({}, model, { _key: crypto.randomUUID() })),
                  });
                  setApiKey("");
                  setReplaceKey(false);
                }}
              >
                Editar
              </Button>
              {connection.models.map((model) => (
                <Button
                  key={model.id}
                  variant="secondary"
                  onClick={async () => {
                    setMessage("Testando protocolo e capacidades declaradas…");
                    try {
                      const result = await planeAI.create<Record<string, unknown>>(
                        workspaceSlug,
                        `connections/${connection.id}/test/`,
                        { model: model.id }
                      );
                      setMessage(JSON.stringify(result, null, 2));
                    } catch (failure) {
                      setMessage(aiError(failure));
                    }
                  }}
                >
                  Testar {model.id}
                </Button>
              ))}
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    const result = await planeAI.create<{ models: string[]; notice: string }>(
                      workspaceSlug,
                      `connections/${connection.id}/models/`,
                      {}
                    );
                    setMessage(`${result.notice}\n${result.models.join("\n")}`);
                  } catch (failure) {
                    setMessage(aiError(failure));
                  }
                }}
              >
                Listar modelos
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    await planeAI.remove(workspaceSlug, `connections/${connection.id}/`);
                    await connections.mutate();
                  } catch (failure) {
                    setMessage(aiError(failure));
                  }
                }}
              >
                Excluir
              </Button>
            </div>
          </div>
        ))}
      </section>
      <form
        className="max-w-3xl space-y-4 rounded border border-subtle p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 className="font-semibold">{editing ? "Editar conexão" : "Nova conexão"}</h2>
        <label className="block">
          Nome
          <input
            required
            className={aiInputClass}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label className="block">
          Base URL (inclua o prefixo da API)
          <input
            required
            type="url"
            className={aiInputClass}
            value={draft.base_url}
            placeholder="https://seu-endpoint/caminho-api"
            onChange={(e) => setDraft({ ...draft, base_url: e.target.value })}
          />
        </label>
        {editing && (
          <label className="flex gap-2">
            <input type="checkbox" checked={replaceKey} onChange={(e) => setReplaceKey(e.target.checked)} />
            Substituir credencial (vazia remove a credencial)
          </label>
        )}
        <label className="block">
          API key (opcional)
          <input
            type="password"
            autoComplete="new-password"
            disabled={!!editing && !replaceKey}
            className={aiInputClass}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
        <label className="block">
          Protocolo
          <input readOnly className={aiInputClass} value="Chat Completions" />
        </label>
        <label className="block">
          Finalidade
          <select
            className={aiInputClass}
            value={draft.purpose}
            onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
          >
            <option value="chat">Conversa</option>
            <option value="embedding">Embeddings separados (opcional; busca lexical ativa)</option>
          </select>
        </label>
        <p className="text-secondary">
          A integração atual aceita somente texto. Embeddings, multimodal e saídas estruturadas são capacidades
          declaradas, mas não são enviados nem usados automaticamente. Responses requer um adaptador futuro.
        </p>
        {draft.models.map((model, index) => (
          <fieldset key={model._key} className="space-y-2 rounded border border-subtle p-3">
            <legend>Modelo {index + 1}</legend>
            <label className="block">
              Identificador manual
              <input
                required
                className={aiInputClass}
                value={model.id}
                onChange={(e) => updateModel(index, { id: e.target.value })}
              />
            </label>
            <div className="flex flex-wrap gap-3">
              {CAPS.map((capability) => (
                <label className="flex gap-1" key={capability}>
                  <input
                    type="checkbox"
                    checked={!!model.capabilities[capability]}
                    onChange={(e) =>
                      updateModel(index, { capabilities: { ...model.capabilities, [capability]: e.target.checked } })
                    }
                  />
                  {capability}
                </label>
              ))}
            </div>
            <label className="block">
              Parâmetro de limite de saída
              <select
                className={aiInputClass}
                value={model.output_parameter ?? "max_tokens"}
                onChange={(e) =>
                  updateModel(index, { output_parameter: e.target.value as AIModel["output_parameter"] })
                }
              >
                <option>max_tokens</option>
                <option>max_completion_tokens</option>
                <option value="none">Não enviar</option>
              </select>
            </label>
            <label className="block">
              Parâmetros compatíveis (JSON; somente os explicitamente configurados)
              <textarea
                key={model._key}
                className={aiInputClass}
                defaultValue={JSON.stringify(model.parameters ?? {}, null, 2)}
                rows={3}
                onBlur={(e) => {
                  try {
                    updateModel(index, { parameters: JSON.parse(e.target.value) as Record<string, unknown> });
                  } catch {
                    setMessage("JSON de parâmetros inválido.");
                  }
                }}
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              disabled={draft.models.length === 1}
              onClick={() => setDraft({ ...draft, models: draft.models.filter((_, i) => i !== index) })}
            >
              Remover modelo
            </Button>
          </fieldset>
        ))}
        <Button
          type="button"
          variant="secondary"
          onClick={() => setDraft({ ...draft, models: [...draft.models, EMPTY_MODEL()] })}
        >
          Adicionar modelo
        </Button>
        <label className="block">
          Modelo padrão
          <select
            required
            className={aiInputClass}
            value={draft.default_model}
            onChange={(e) => setDraft({ ...draft, default_model: e.target.value })}
          >
            <option value="">Selecione</option>
            {draft.models.map((m) => (
              <option key={m._key} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        </label>
        {(
          [
            ["context_tokens", "Janela de contexto (tokens)"],
            ["output_tokens", "Limite de saída (tokens)"],
            ["timeout_seconds", "Timeout (segundos)"],
          ] as const
        ).map(([key, label]) => (
          <label className="block" key={key}>
            {label}
            <input
              type="number"
              min={1}
              required
              className={aiInputClass}
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
            />
          </label>
        ))}
        <div className="flex gap-3">
          {(
            [
              [20, "Administradores"],
              [15, "Membros"],
              [5, "Convidados"],
            ] as const
          ).map(([role, label]) => (
            <label key={role} className="flex gap-1">
              <input
                type="checkbox"
                checked={draft.allowed_roles.includes(role)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    allowed_roles: e.target.checked
                      ? [...draft.allowed_roles, role]
                      : draft.allowed_roles.filter((r) => r !== role),
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
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />
          Conexão ativa
        </label>
        <div className="flex gap-2">
          <Button type="submit" disabled={saving}>
            Salvar conexão
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setEditing("");
              setDraft(emptyConnection());
              setApiKey("");
              setReplaceKey(false);
            }}
          >
            Limpar formulário
          </Button>
        </div>
      </form>
    </main>
  );
}
