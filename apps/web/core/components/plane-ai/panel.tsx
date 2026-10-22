import { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { ReactNode, RefObject } from "react";
import useSWR from "swr";
import { useMatches } from "react-router";
import { Dialog } from "@headlessui/react";
import { Sparkles, X } from "lucide-react";
import type { EditorRefApi } from "@plane/editor";
import { Button } from "@plane/propel/button";
import { useUser } from "@/hooks/store/user";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { AIWorkspaceTools } from "./workspace-tools";
import { planeAI, aiError, aiInputClass } from "./service";
import { plainTextHTML, matchesEditorSnapshot } from "./writing-helpers";
import type { AIBootstrap, AIScope, AIRun, AIConversation } from "./service";

type Start = { scope?: AIScope; prompt?: string; apply?: (text: string, mode: "insert" | "replace") => void };
type PanelContext = { enabled: boolean; open: (start?: Start) => void };
const AIContext = createContext<PanelContext | null>(null);
export const usePlaneAI = () => useContext(AIContext);

export function PlaneAIProvider({ workspaceSlug, children }: { workspaceSlug: string; children: ReactNode }) {
  const { data: user } = useUser();
  return (
    <AIState key={`${workspaceSlug}:${user?.id ?? "anonymous"}`} workspaceSlug={workspaceSlug}>
      {children}
    </AIState>
  );
}

function AIState({ workspaceSlug, children }: { workspaceSlug: string; children: ReactNode }) {
  const { data: user } = useUser();
  const issueDetail = useIssueDetail();
  const refreshResults = useCallback(
    (run: AIRun) => {
      for (const action of run.actions) {
        if (
          action.status === "done" &&
          action.result.kind === "issue" &&
          action.result.id &&
          typeof action.arguments.project_id === "string"
        ) {
          void issueDetail
            .fetchIssue(workspaceSlug, action.arguments.project_id, action.result.id)
            .catch(() => undefined);
        }
      }
    },
    [issueDetail, workspaceSlug]
  );
  const params = useMatches().at(-1)?.params ?? {};
  const currentIssueId =
    issueDetail.peekIssue?.workspaceSlug === workspaceSlug ? issueDetail.peekIssue.issueId : params.issueId;
  const { data: bootstrap } = useSWR(user?.id ? ["plane-ai", workspaceSlug, user.id] : null, () =>
    planeAI.read<AIBootstrap>(workspaceSlug)
  );
  const [isOpen, setOpen] = useState(false);
  const [scope, setScope] = useState<AIScope>({ kind: "workspace" });
  const [connectionId, setConnection] = useState("");
  const [modelId, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [conversationId, setConversation] = useState("");
  const [runs, setRuns] = useState<AIRun[]>([]);
  const [activeRun, setActiveRun] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [allowActions, setAllowActions] = useState(false);
  const [tab, setTab] = useState("chat");
  const apply = useRef<Start["apply"]>(undefined);
  const requestKey = useRef<string | null>(null);
  const connections = bootstrap?.connections ?? [];
  const connection = connections.find((item) => item.id === connectionId) ?? connections[0];
  const model =
    connection?.models.find((item) => item.id === modelId) ??
    connection?.models.find((item) => item.id === connection.default_model);
  const history = useSWR(isOpen && bootstrap?.enabled && user?.id ? ["ai-history", workspaceSlug, user.id] : null, () =>
    planeAI.read<AIConversation[]>(workspaceSlug, "conversations/")
  );
  const { mutate: mutateHistory } = history;
  const replaceRun = (run: AIRun) =>
    setRuns((current) =>
      current.some((item) => item.id === run.id)
        ? current.map((item) => (item.id === run.id ? run : item))
        : [...current, run]
    );
  useEffect(() => {
    if (!activeRun || !isOpen) return;
    const events = planeAI.events(workspaceSlug, activeRun);
    events.addEventListener("message", (event) => {
      const run = JSON.parse(event.data) as AIRun;
      replaceRun(run);
      if (!["queued", "running", "cancelling"].includes(run.status)) {
        setActiveRun("");
        events.close();
        void mutateHistory();
        refreshResults(run);
      }
    });
    events.addEventListener("error", () => {
      events.close();
      // A revoked context must not leave a cached answer visible.
      void planeAI
        .read<AIRun>(workspaceSlug, `runs/${activeRun}/`)
        .then((run) => {
          replaceRun(run);
          if (["queued", "running", "cancelling"].includes(run.status))
            setError(
              "Conexão de streaming interrompida. Reabra o histórico para acompanhar; a execução pode continuar."
            );
          else setActiveRun("");
          return run;
        })
        .catch((failure) => {
          setRuns([]);
          setActiveRun("");
          setError(aiError(failure));
        });
    });
    return () => events.close();
  }, [activeRun, isOpen, workspaceSlug, mutateHistory, refreshResults]);
  // Revalidate before showing stored answers when returning to the tab.
  useEffect(() => {
    const check = () => {
      if (document.hidden || !conversationId || !isOpen) return;
      void planeAI
        .read<AIConversation>(workspaceSlug, `conversations/${conversationId}/`)
        .then((value) => {
          setRuns(value.runs ?? []);
          const active = value.runs?.find((run) => ["queued", "running", "cancelling"].includes(run.status));
          setActiveRun(active?.id ?? "");
          return value;
        })
        .catch((failure) => {
          setRuns([]);
          setError(aiError(failure));
        });
    };
    document.addEventListener("visibilitychange", check);
    const timer = window.setInterval(check, 15000);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.clearInterval(timer);
    };
  }, [conversationId, isOpen, workspaceSlug]);
  const open = useCallback(
    (start: Start = {}) => {
      const peek = issueDetail.peekIssue;
      const contextual: AIScope =
        peek?.workspaceSlug === workspaceSlug
          ? { kind: "issue", id: peek.issueId }
          : params.issueId
            ? { kind: "issue", id: params.issueId }
            : params.pageId
              ? { kind: "page", id: params.pageId }
              : params.projectId
                ? { kind: "project", id: params.projectId }
                : { kind: "workspace" };
      setScope(start.scope ?? contextual);
      setPrompt(start.prompt ?? "");
      setConversation("");
      setRuns([]);
      setError("");
      setAllowActions(false);
      setTab("chat");
      setActiveRun("");
      requestKey.current = null;
      apply.current = start.apply;
      setOpen(true);
    },
    [params.issueId, params.pageId, params.projectId, issueDetail, workspaceSlug]
  );
  const contextValue = useMemo(() => ({ enabled: !!bootstrap?.enabled, open }), [bootstrap?.enabled, open]);
  const send = async () => {
    if (!connection || !model || !prompt.trim() || sending || activeRun) return;
    setSending(true);
    setError("");
    try {
      let id = conversationId;
      if (!id) {
        const conversation = await planeAI.create<AIConversation>(workspaceSlug, "conversations/", {
          scope,
          title: prompt.slice(0, 150),
        });
        id = conversation.id;
        setConversation(id);
      }
      requestKey.current ??= crypto.randomUUID();
      const run = await planeAI.create<{ id: string }>(workspaceSlug, "runs/", {
        conversation_id: id,
        connection_id: connection.id,
        model: model.id,
        prompt,
        request_key: requestKey.current,
        allow_actions: allowActions && model.capabilities.tools,
      });
      setActiveRun(run.id);
      setPrompt("");
      setAllowActions(false);
      requestKey.current = null;
      void history.mutate();
    } catch (failure) {
      setError(aiError(failure));
    } finally {
      setSending(false);
    }
  };
  const command = async (run: AIRun, action: string) => {
    setError("");
    try {
      await planeAI.create(workspaceSlug, `runs/${run.id}/${action}/`, {});
      const updated = await planeAI.read<AIRun>(workspaceSlug, `runs/${run.id}/`);
      replaceRun(updated);
      if (["queued", "running", "cancelling"].includes(updated.status)) setActiveRun(updated.id);
      refreshResults(updated);
    } catch (failure) {
      setError(aiError(failure));
    }
  };
  return (
    <AIContext.Provider value={contextValue}>
      {children}
      <Dialog open={isOpen} onClose={() => setOpen(false)} className="relative z-[100]">
        <div className="fixed inset-0 bg-black/20" aria-hidden="true" />
        <Dialog.Panel className="shadow-xl fixed inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-subtle bg-surface-1 text-primary">
          <header className="flex items-center justify-between border-b border-subtle p-4">
            <Dialog.Title className="flex items-center gap-2 font-semibold">
              <Sparkles size={18} />
              Plane AI
            </Dialog.Title>
            <button aria-label="Fechar Plane AI" onClick={() => setOpen(false)}>
              <X size={20} />
            </button>
          </header>
          <nav className="flex gap-3 border-b border-subtle p-3 text-13" aria-label="Plane AI">
            {[
              ["chat", "Conversa"],
              ["memory", "Memória"],
              ["automations", "Automações"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={tab === key ? "font-semibold text-accent-primary" : "text-secondary"}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
            {bootstrap?.admin && (
              <a className="ml-auto" href={`/${workspaceSlug}/settings/ai/`}>
                Configurações
              </a>
            )}
          </nav>
          {!bootstrap?.enabled ? (
            <p className="p-4 text-13">
              Plane AI está desabilitado. Um administrador deve habilitar a integração e configurar uma conexão.
            </p>
          ) : tab !== "chat" ? (
            <AIWorkspaceTools key={tab} slug={workspaceSlug} bootstrap={bootstrap} tab={tab} />
          ) : (
            <>
              <div className="space-y-2 border-b border-subtle p-3 text-13">
                <div className="flex gap-2">
                  <select
                    aria-label="Conexão de IA"
                    className={aiInputClass}
                    value={connection?.id ?? ""}
                    onChange={(e) => {
                      setConnection(e.target.value);
                      setModel("");
                      setAllowActions(false);
                    }}
                  >
                    {connections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Modelo de IA"
                    className={aiInputClass}
                    value={model?.id ?? ""}
                    onChange={(e) => {
                      setModel(e.target.value);
                      setAllowActions(false);
                    }}
                  >
                    {connection?.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-secondary">
                  {model?.capabilities.streaming ? "Streaming" : "Resposta completa"} ·{" "}
                  {model?.capabilities.tools ? "Ferramentas disponíveis" : "Consulta e escrita, sem execução"} · somente
                  texto
                </p>
                <select
                  aria-label="Escopo enviado à IA"
                  disabled={!!conversationId}
                  className={aiInputClass}
                  value={`${scope.kind}:${scope.id ?? ""}`}
                  onChange={(e) => {
                    const [kind, id] = e.target.value.split(":");
                    setScope({ kind: kind as AIScope["kind"], ...(id ? { id } : {}) });
                  }}
                >
                  <option value="workspace:">Workspace (busca autorizada)</option>
                  {bootstrap.projects.map((project) => (
                    <option key={project.id} value={`project:${project.id}`}>
                      {project.name}
                    </option>
                  ))}
                  {scope.kind === "project" && !bootstrap.projects.some((project) => project.id === scope.id) && (
                    <option value={`project:${scope.id}`}>Projeto da conversa · {scope.id}</option>
                  )}
                  {currentIssueId && <option value={`issue:${currentIssueId}`}>Tarefa atual · {currentIssueId}</option>}
                  {scope.kind === "issue" && scope.id !== currentIssueId && (
                    <option value={`issue:${scope.id}`}>Tarefa da conversa · {scope.id}</option>
                  )}
                  {params.pageId && <option value={`page:${params.pageId}`}>Página atual · {params.pageId}</option>}
                  {scope.kind === "page" && scope.id !== params.pageId && (
                    <option value={`page:${scope.id}`}>Página da conversa · {scope.id}</option>
                  )}
                </select>
                <p className="text-secondary">
                  Serão enviados sua mensagem, trechos relevantes e fontes autorizadas deste escopo para{" "}
                  <strong>{connection?.name ?? "a conexão selecionada"}</strong>.
                </p>
                <div className="flex gap-2">
                  <select
                    aria-label="Histórico de conversas"
                    className={aiInputClass}
                    value={conversationId}
                    onChange={async (event) => {
                      const id = event.target.value;
                      setConversation(id);
                      setRuns([]);
                      setError("");
                      apply.current = undefined;
                      if (id)
                        try {
                          const value = await planeAI.read<AIConversation>(workspaceSlug, `conversations/${id}/`);
                          setScope(value.scope);
                          setRuns(value.runs ?? []);
                          const running = value.runs?.find((r) =>
                            ["queued", "running", "cancelling"].includes(r.status)
                          );
                          setActiveRun(running?.id ?? "");
                        } catch (failure) {
                          setError(aiError(failure));
                        }
                    }}
                  >
                    <option value="">Nova conversa</option>
                    {history.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                  {conversationId && (
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        try {
                          await planeAI.remove(workspaceSlug, `conversations/${conversationId}/`);
                          setConversation("");
                          setRuns([]);
                          void history.mutate();
                        } catch (failure) {
                          setError(aiError(failure));
                        }
                      }}
                    >
                      Apagar
                    </Button>
                  )}
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4" aria-live="polite" aria-busy={!!activeRun}>
                {!runs.length && (
                  <p className="text-13 text-secondary">
                    Pergunte sobre atrasos, bloqueios, mudanças nesta semana ou prioridades. Também posso escrever
                    descrições, critérios de aceite, planos, checklists e notas de versão.
                  </p>
                )}
                {runs.map((run) => (
                  <article key={run.id} className="space-y-3 text-13">
                    <p className="rounded bg-layer-1 p-3 whitespace-pre-wrap">{run.prompt}</p>
                    <p className="break-words whitespace-pre-wrap">
                      {run.response ||
                        (run.status === "queued" ? "Aguardando worker…" : run.status === "running" ? "Gerando…" : "")}
                    </p>
                    {run.error && (
                      <p role="alert" className="text-red-500">
                        {run.error}
                      </p>
                    )}
                    {run.context.period && (
                      <p className="text-11 text-secondary">
                        {run.context.report} · {run.context.period.from} a {run.context.period.to} ·{" "}
                        {run.context.timezone}
                        {run.context.truncated ? " · Contexto limitado" : ""}
                      </p>
                    )}
                    {!!run.sources.length && (
                      <details>
                        <summary>Contexto e fontes consultadas ({run.sources.length})</summary>
                        <ul className="space-y-1 p-2">
                          {run.sources.map((source) => (
                            <li key={`${source.kind}:${source.id}`}>
                              <a className="text-accent-primary underline" href={source.url}>
                                {source.title}
                              </a>
                            </li>
                          ))}
                        </ul>
                        <pre className="overflow-auto text-11">{JSON.stringify(run.context.metrics, null, 2)}</pre>
                      </details>
                    )}
                    {run.actions.map((action) => (
                      <div key={action.id} className="rounded border border-subtle p-2">
                        <strong>
                          {action.operation} · {action.status}
                        </strong>
                        {action.status === "proposed" && (
                          <pre className="overflow-auto whitespace-pre-wrap">
                            {JSON.stringify(action.arguments, null, 2)}
                          </pre>
                        )}
                        {action.result.url && (
                          <a className="block text-accent-primary underline" href={action.result.url}>
                            {action.result.title}
                          </a>
                        )}
                        {action.result.error && <p role="alert">{action.result.error}</p>}
                      </div>
                    ))}
                    {run.status === "awaiting_confirmation" && (
                      <div className="flex gap-2">
                        <Button onClick={() => void command(run, "approve")}>Confirmar alterações</Button>
                        <Button variant="secondary" onClick={() => void command(run, "reject")}>
                          Descartar
                        </Button>
                      </div>
                    )}
                    {["failed", "cancelled"].includes(run.status) && (
                      <Button variant="secondary" onClick={() => void command(run, "retry")}>
                        Tentar novamente
                      </Button>
                    )}
                    {apply.current && run.response && run.status === "completed" && (
                      <div className="flex gap-2">
                        {(["insert", "replace"] as const).map((mode) => (
                          <Button
                            key={mode}
                            variant="secondary"
                            onClick={() => {
                              try {
                                apply.current?.(run.response, mode);
                                setOpen(false);
                              } catch (failure) {
                                setError(
                                  failure instanceof Error ? failure.message : "Não foi possível aplicar a prévia."
                                );
                              }
                            }}
                          >
                            {mode === "insert" ? "Inserir" : "Substituir"}
                          </Button>
                        ))}
                        <Button
                          variant="secondary"
                          onClick={() => {
                            apply.current = undefined;
                            setOpen(false);
                          }}
                        >
                          Descartar
                        </Button>
                      </div>
                    )}
                    <p className="text-11 text-secondary">
                      {run.model} · {run.latency_ms} ms{" "}
                      {run.usage.total_tokens ? `· ${run.usage.total_tokens} tokens` : ""}
                    </p>
                  </article>
                ))}
              </div>
              <form
                className="space-y-2 border-t border-subtle p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                {error && (
                  <p role="alert" className="text-red-500 text-13">
                    {error}
                  </p>
                )}
                <textarea
                  aria-label="Mensagem para Plane AI"
                  className={aiInputClass}
                  rows={3}
                  value={prompt}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    requestKey.current = null;
                  }}
                  placeholder="Pergunte ou descreva o que deseja fazer…"
                />
                <label className="flex gap-2 text-13">
                  <input
                    type="checkbox"
                    disabled={!model?.capabilities.tools}
                    checked={allowActions}
                    onChange={(event) => setAllowActions(event.target.checked)}
                  />
                  Permitir executar as alterações que eu solicitar nesta mensagem
                </label>
                <div className="flex justify-end gap-2">
                  {activeRun && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={async () => {
                        try {
                          await planeAI.create(workspaceSlug, `runs/${activeRun}/cancel/`, {});
                        } catch (failure) {
                          setError(aiError(failure));
                        }
                      }}
                    >
                      Cancelar geração
                    </Button>
                  )}
                  <Button type="submit" disabled={!model || !prompt.trim() || sending || !!activeRun}>
                    {sending ? "Enviando…" : "Enviar"}
                  </Button>
                </div>
              </form>
            </>
          )}
        </Dialog.Panel>
      </Dialog>
    </AIContext.Provider>
  );
}

export function PlaneAIButton() {
  const ai = usePlaneAI();
  if (!ai?.enabled) return null;
  return (
    <button
      type="button"
      onClick={() => ai.open()}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-13 text-secondary hover:bg-layer-1"
    >
      <Sparkles size={16} />
      Plane AI
    </button>
  );
}

export function PlaneAIEditorButton({
  editorRef,
  scope,
}: {
  editorRef: RefObject<EditorRefApi | null>;
  scope?: AIScope;
}) {
  const ai = usePlaneAI();
  const [instruction, setInstruction] = useState("Melhore este texto, preservando seu sentido.");
  if (!ai?.enabled) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Ação de escrita com Plane AI"
        className="max-w-52 rounded border border-subtle bg-surface-1 p-1 text-13 text-secondary"
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
      >
        {[
          "Melhore este texto, preservando seu sentido.",
          "Resuma este texto.",
          "Traduza este texto para inglês.",
          "Corrija a escrita deste texto.",
          "Ajuste o tom deste texto para profissional.",
          "Gere uma descrição de tarefa e critérios de aceite a partir destas notas.",
          "Transforme estas anotações em uma lista de tarefas e subtarefas.",
          "Crie um plano de projeto e checklist a partir deste texto.",
          "Produza uma atualização de progresso ou notas de versão a partir destas notas.",
        ].map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="flex items-center gap-1 rounded p-1 text-13 text-secondary hover:bg-layer-1"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const editor = editorRef.current;
          if (!editor) return;
          const snapshot = editor.getDocument().html;
          const selected = editor.getSelectedPlainText();
          const range = editor.getSelectionRange();
          const text = selected || new DOMParser().parseFromString(snapshot, "text/html").body.textContent || "";
          ai.open({
            scope,
            prompt: `${instruction}\n\n${text}`,
            apply: (result, mode) => {
              if (
                editorRef.current !== editor ||
                !matchesEditorSnapshot(
                  { html: snapshot, range },
                  { html: editor.getDocument().html, range: editor.getSelectionRange() }
                )
              )
                throw new Error(
                  "O texto ou a seleção mudou desde a solicitação. Gere uma nova prévia antes de aplicar."
                );
              const html = plainTextHTML(result);
              if (selected) editor.insertText(html, mode === "insert");
              else if (mode === "replace") editor.setEditorValue(html, true);
              else editor.setEditorValueAtCursorPosition(html);
            },
          });
        }}
      >
        <Sparkles size={14} />
        Plane AI · escrever / seleção
      </button>
    </div>
  );
}
