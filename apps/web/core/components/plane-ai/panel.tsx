import { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { ReactNode, RefObject } from "react";
import useSWR from "swr";
import { useMatches } from "react-router";
import { Dialog } from "@headlessui/react";
import {
  ArrowUp,
  BrainCircuit,
  History,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { EditorRefApi } from "@plane/editor";
import { Button } from "@plane/propel/button";
import { useUser } from "@/hooks/store/user";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { AIWorkspaceTools } from "./workspace-tools";
import { AIModelPicker } from "./model-picker";
import { AIChatMessage } from "./chat-message";
import { chatStarters } from "./chat-helpers";
import { resolveModel } from "./model-helpers";
import { planeAI, aiError } from "./service";
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
  const params = useMatches().at(-1)?.params ?? {};
  const { data: bootstrap, error: bootstrapError } = useSWR(
    user?.id ? ["plane-ai", workspaceSlug, user.id] : null,
    () => planeAI.read<AIBootstrap>(workspaceSlug)
  );
  const [isOpen, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [scope, setScope] = useState<AIScope>({ kind: "workspace" });
  const [selection, setSelection] = useState("auto");
  const [prompt, setPrompt] = useState("");
  const [conversationId, setConversation] = useState("");
  const [runs, setRuns] = useState<AIRun[]>([]);
  const [activeRun, setActiveRun] = useState("");
  const [error, setError] = useState("");
  const [connectionNotice, setConnectionNotice] = useState("");
  const [sending, setSending] = useState(false);
  const [allowActions, setAllowActions] = useState(false);
  const [tab, setTab] = useState("chat");
  const apply = useRef<Start["apply"]>(undefined);
  const requestKey = useRef<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const preferenceKey = `plane-ai-model:${workspaceSlug}:${user?.id ?? "anonymous"}`;
  const connections = bootstrap?.connections ?? [];
  const chosen = resolveModel(connections, selection);
  const connection = chosen?.connection;
  const model = chosen?.model;
  const history = useSWR(isOpen && bootstrap?.enabled && user?.id ? ["ai-history", workspaceSlug, user.id] : null, () =>
    planeAI.read<AIConversation[]>(workspaceSlug, "conversations/")
  );
  const { mutate: mutateHistory } = history;
  const currentIssueId =
    issueDetail.peekIssue?.workspaceSlug === workspaceSlug ? issueDetail.peekIssue.issueId : params.issueId;
  useEffect(() => {
    try {
      setSelection(localStorage.getItem(preferenceKey) ?? "auto");
    } catch {
      setSelection("auto");
    }
  }, [preferenceKey]);
  const selectModel = (key: string) => {
    setSelection(key);
    setAllowActions(false);
    try {
      localStorage.setItem(preferenceKey, key);
    } catch {
      /* The selector remains usable without local storage. */
    }
  };
  const refreshResults = useCallback(
    (run: AIRun) => {
      for (const action of run.actions) {
        if (
          action.status === "done" &&
          action.result.kind === "issue" &&
          action.result.id &&
          typeof action.arguments.project_id === "string"
        )
          void issueDetail
            .fetchIssue(workspaceSlug, action.arguments.project_id, action.result.id)
            .catch(() => undefined);
      }
    },
    [issueDetail, workspaceSlug]
  );
  const replaceRun = useCallback(
    (run: AIRun) =>
      setRuns((current) =>
        current.some((item) => item.id === run.id)
          ? current.map((item) => (item.id === run.id ? run : item))
          : [...current, run]
      ),
    []
  );
  useEffect(() => {
    if (!activeRun || !isOpen) return;
    let disposed = false;
    const events = planeAI.events(workspaceSlug, activeRun);
    events.addEventListener("message", (event) => {
      if (disposed) return;
      const run = JSON.parse(event.data) as AIRun;
      replaceRun(run);
      setConnectionNotice("");
      if (!["queued", "running", "cancelling"].includes(run.status)) {
        setActiveRun("");
        events.close();
        void mutateHistory();
        refreshResults(run);
      }
    });
    events.addEventListener("error", () => {
      if (disposed) return;
      setConnectionNotice("Reconectando à resposta em andamento…");
      void planeAI
        .read<AIRun>(workspaceSlug, `runs/${activeRun}/`)
        .then((run) => {
          if (disposed) return run;
          replaceRun(run);
          if (!["queued", "running", "cancelling"].includes(run.status)) {
            setActiveRun("");
            setConnectionNotice("");
            events.close();
            void mutateHistory();
            refreshResults(run);
          }
          return run;
        })
        .catch((failure) => {
          if (disposed) return;
          const status = (failure as { response?: { status: number } }).response?.status;
          if (status === 403 || status === 404) {
            events.close();
            setRuns([]);
            setActiveRun("");
            setConnectionNotice("");
            setError(aiError(failure));
          }
        });
    });
    return () => {
      disposed = true;
      events.close();
    };
  }, [activeRun, isOpen, workspaceSlug, mutateHistory, refreshResults, replaceRun]);
  useEffect(() => {
    if (stickToBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [runs]);
  useEffect(() => {
    let disposed = false;
    const check = () => {
      if (disposed || document.hidden || !conversationId || !isOpen) return;
      void planeAI
        .read<AIConversation>(workspaceSlug, `conversations/${conversationId}/`)
        .then((value) => {
          if (disposed) return value;
          setRuns(value.runs ?? []);
          setConnectionNotice("");
          setActiveRun(value.runs?.find((run) => ["queued", "running", "cancelling"].includes(run.status))?.id ?? "");
          return value;
        })
        .catch((failure) => {
          if (disposed) return;
          const status = (failure as { response?: { status: number } }).response?.status;
          if (status === 403 || status === 404) {
            setRuns([]);
            setActiveRun("");
            setConnectionNotice("");
            setError(aiError(failure));
          } else setConnectionNotice("Reconectando à conversa…");
        });
    };
    document.addEventListener("visibilitychange", check);
    const timer = window.setInterval(check, 15000);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", check);
      window.clearInterval(timer);
    };
  }, [conversationId, isOpen, workspaceSlug]);
  const contextualScope = useCallback((): AIScope => {
    const peek = issueDetail.peekIssue;
    if (peek?.workspaceSlug === workspaceSlug) return { kind: "issue", id: peek.issueId };
    if (params.issueId) return { kind: "issue", id: params.issueId };
    if (params.pageId) return { kind: "page", id: params.pageId };
    if (params.projectId) return { kind: "project", id: params.projectId };
    return { kind: "workspace" };
  }, [params.issueId, params.pageId, params.projectId, issueDetail, workspaceSlug]);
  const newChat = useCallback(
    (start: Start = {}) => {
      setScope(start.scope ?? contextualScope());
      setPrompt(start.prompt ?? "");
      setConversation("");
      setRuns([]);
      setError("");
      setConnectionNotice("");
      setAllowActions(false);
      setTab("chat");
      setActiveRun("");
      requestKey.current = null;
      apply.current = start.apply;
      stickToBottom.current = true;
      setShowHistory(false);
    },
    [contextualScope]
  );
  const open = useCallback(
    (start?: Start) => {
      if (start || !conversationId) newChat(start);
      setOpen(true);
    },
    [conversationId, newChat]
  );
  const contextValue = useMemo(() => ({ enabled: !!bootstrap?.enabled, open }), [bootstrap?.enabled, open]);
  const loadConversation = async (id: string) => {
    setError("");
    setRuns([]);
    setConversation(id);
    apply.current = undefined;
    stickToBottom.current = true;
    try {
      const value = await planeAI.read<AIConversation>(workspaceSlug, `conversations/${id}/`);
      setScope(value.scope);
      setRuns(value.runs ?? []);
      setShowHistory(false);
      setTab("chat");
      setActiveRun(value.runs?.find((run) => ["queued", "running", "cancelling"].includes(run.status))?.id ?? "");
    } catch (failure) {
      setError(aiError(failure));
    }
  };
  const send = async () => {
    if (!connection || !model || !prompt.trim() || sending || activeRun) return;
    setSending(true);
    setError("");
    stickToBottom.current = true;
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
      replaceRun({
        id: run.id,
        conversation_id: id,
        prompt,
        response: "",
        status: "queued",
        error: "",
        sources: [],
        model: model.id,
        usage: {},
        latency_ms: 0,
        context: { scope },
        actions: [],
      });
      setActiveRun(run.id);
      setPrompt("");
      setAllowActions(false);
      requestKey.current = null;
      void mutateHistory();
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
  const applyPreview = apply.current
    ? (text: string, mode: "insert" | "replace" | "discard") => {
        try {
          if (mode !== "discard") apply.current?.(text, mode);
          apply.current = undefined;
          setOpen(false);
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : "Não foi possível aplicar o texto.");
        }
      }
    : undefined;
  return (
    <AIContext.Provider value={contextValue}>
      {children}
      <Dialog open={isOpen} onClose={() => setOpen(false)} className="relative z-[100]">
        <div className="fixed inset-0 bg-black/25 backdrop-blur-[2px]" aria-hidden="true" />
        <Dialog.Panel
          className={`shadow-xl fixed inset-y-3 right-3 flex w-[calc(100%-24px)] flex-col overflow-hidden rounded-2xl border border-subtle bg-surface-1 text-primary ${expanded ? "max-w-none" : "max-w-5xl"}`}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-subtle px-4 py-3">
            <Dialog.Title className="flex items-center gap-2 font-semibold">
              <span className="rounded-lg bg-layer-1 p-2 text-accent-primary">
                <BrainCircuit size={20} />
              </span>
              Plane AI
              <span className="font-normal hidden text-11 text-secondary sm:inline">Seu workspace em uma conversa</span>
            </Dialog.Title>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Histórico de conversas"
                aria-pressed={showHistory}
                className="rounded-lg p-2 hover:bg-layer-1"
                onClick={() => setShowHistory(!showHistory)}
              >
                <History size={17} />
              </button>
              <button
                type="button"
                aria-label={expanded ? "Reduzir chat" : "Expandir chat"}
                className="rounded-lg p-2 hover:bg-layer-1"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
              </button>
              <button
                type="button"
                aria-label="Fechar Plane AI"
                className="rounded-lg p-2 hover:bg-layer-1"
                onClick={() => setOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
          </header>
          <nav
            className="flex shrink-0 items-center gap-4 border-b border-subtle px-4 py-2 text-13"
            aria-label="Plane AI"
          >
            {[
              ["chat", "Chat"],
              ["memory", "Memória"],
              ["automations", "Automações"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`py-1 ${tab === key ? "font-semibold text-accent-primary" : "text-secondary"}`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
            {bootstrap?.admin && (
              <a href={`/${workspaceSlug}/settings/ai/`} className="ml-auto flex items-center gap-1 text-secondary">
                <Settings2 size={14} />
                Configurar
              </a>
            )}
          </nav>
          {!bootstrap?.enabled ? (
            <div className="m-auto max-w-md space-y-3 p-8 text-center">
              <BrainCircuit size={40} className="mx-auto text-accent-primary" />
              <h2 className="text-xl font-semibold">Conecte a IA ao seu workspace</h2>
              <p className="text-13 text-secondary">
                {bootstrapError
                  ? aiError(bootstrapError)
                  : "Um administrador pode habilitar a IA e escolher os modelos disponíveis para a equipe."}
              </p>
              {bootstrap?.admin && (
                <a className="text-accent-primary underline" href={`/${workspaceSlug}/settings/ai/`}>
                  Configurar Plane AI
                </a>
              )}
            </div>
          ) : tab !== "chat" ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <AIWorkspaceTools key={tab} slug={workspaceSlug} bootstrap={bootstrap} tab={tab} />
            </div>
          ) : (
            <div className="relative flex min-h-0 flex-1">
              {showHistory && (
                <aside
                  className="absolute inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-subtle bg-layer-1 p-3 md:static md:w-60"
                  aria-label="Suas conversas"
                >
                  <Button variant="secondary" onClick={() => newChat()}>
                    <Plus size={14} />
                    Nova conversa
                  </Button>
                  {history.error && (
                    <p role="alert" className="text-11">
                      {aiError(history.error)}
                    </p>
                  )}
                  {history.data?.map((conversation) => (
                    <div
                      key={conversation.id}
                      className={`group flex items-center gap-1 rounded-lg ${conversationId === conversation.id ? "bg-surface-1" : "hover:bg-surface-1"}`}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate p-2 text-left text-13"
                        onClick={() => void loadConversation(conversation.id)}
                      >
                        {conversation.title}
                      </button>
                      <button
                        type="button"
                        aria-label={`Apagar conversa ${conversation.title}`}
                        className="shrink-0 p-2 text-secondary"
                        onClick={async () => {
                          try {
                            await planeAI.remove(workspaceSlug, `conversations/${conversation.id}/`);
                            if (conversationId === conversation.id) newChat();
                            await mutateHistory();
                          } catch (failure) {
                            setError(aiError(failure));
                          }
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  {!history.data?.length && (
                    <p className="p-2 text-11 text-secondary">Suas conversas aparecerão aqui.</p>
                  )}
                </aside>
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-2">
                  <label className="flex min-w-0 items-center gap-2 text-11 text-secondary">
                    <Search size={13} />
                    <span className="shrink-0">Contexto</span>
                    <select
                      aria-label="Escopo enviado à IA"
                      disabled={!!conversationId}
                      className="max-w-72 min-w-0 truncate rounded border-0 bg-transparent py-1 text-11 text-primary"
                      value={`${scope.kind}:${scope.id ?? ""}`}
                      onChange={(event) => {
                        const [kind, id] = event.target.value.split(":");
                        setScope({ kind: kind as AIScope["kind"], ...(id ? { id } : {}) });
                      }}
                    >
                      <option value="workspace:">Todo o workspace</option>
                      {bootstrap.projects.map((project) => (
                        <option key={project.id} value={`project:${project.id}`}>
                          {project.name}
                        </option>
                      ))}
                      {scope.kind === "project" && !bootstrap.projects.some((project) => project.id === scope.id) && (
                        <option value={`project:${scope.id}`}>Projeto da conversa</option>
                      )}
                      {currentIssueId && <option value={`issue:${currentIssueId}`}>Tarefa atual</option>}
                      {scope.kind === "issue" && scope.id !== currentIssueId && (
                        <option value={`issue:${scope.id}`}>Tarefa da conversa</option>
                      )}
                      {params.pageId && <option value={`page:${params.pageId}`}>Página atual</option>}
                      {scope.kind === "page" && scope.id !== params.pageId && (
                        <option value={`page:${scope.id}`}>Página da conversa</option>
                      )}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="flex shrink-0 items-center gap-1 text-11 text-secondary hover:text-primary"
                    onClick={() => newChat()}
                  >
                    <Plus size={13} />
                    Nova conversa
                  </button>
                </div>
                <div
                  ref={scroll}
                  className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8"
                  aria-live="polite"
                  aria-busy={!!activeRun}
                  onScroll={(event) => {
                    const target = event.currentTarget;
                    stickToBottom.current = target.scrollHeight - target.scrollTop - target.clientHeight < 100;
                  }}
                >
                  <div className="mx-auto max-w-3xl space-y-8">
                    {!runs.length && (
                      <div className="space-y-6 py-6">
                        <div className="space-y-2">
                          <Sparkles size={30} className="text-accent-primary" />
                          <h2 className="text-2xl font-semibold">O que você quer saber ou fazer?</h2>
                          <p className="max-w-xl text-13 text-secondary">
                            Pesquise seu trabalho, entenda o progresso e transforme dados em relatórios. Troque o modelo
                            quando quiser; o contexto do workspace acompanha a conversa.
                          </p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {chatStarters.map((starter) => (
                            <button
                              type="button"
                              key={starter.title}
                              className="rounded-xl border border-subtle p-4 text-left transition-colors hover:bg-layer-1"
                              onClick={() => {
                                setPrompt(starter.prompt);
                                requestKey.current = null;
                                composer.current?.focus();
                              }}
                            >
                              <strong className="block text-13">{starter.title}</strong>
                              <span className="mt-1 block text-11 text-secondary">{starter.detail}</span>
                            </button>
                          ))}
                        </div>
                        {!connections.length && (
                          <p role="status" className="rounded-lg bg-layer-1 p-3 text-13">
                            Nenhum modelo habilitado.{" "}
                            {bootstrap.admin ? (
                              <a className="text-accent-primary underline" href={`/${workspaceSlug}/settings/ai/`}>
                                Conecte um provedor e escolha seus modelos.
                              </a>
                            ) : (
                              "Peça a um administrador para configurar os modelos da equipe."
                            )}
                          </p>
                        )}
                      </div>
                    )}
                    {runs.map((run) => (
                      <AIChatMessage
                        key={run.id}
                        run={run}
                        command={(value, action) => void command(value, action)}
                        apply={applyPreview}
                        exportContext={{
                          workspaceSlug,
                          writableProjects: bootstrap.writable_projects ?? [],
                          onPublished: async () => {
                            const updated = await planeAI.read<AIRun>(workspaceSlug, `runs/${run.id}/`);
                            replaceRun(updated);
                          },
                        }}
                      />
                    ))}
                  </div>
                </div>
                <form
                  className="shrink-0 space-y-2 px-4 pt-2 pb-4 sm:px-6"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void send();
                  }}
                >
                  {connectionNotice && (
                    <p role="status" className="px-2 text-11 text-secondary">
                      {connectionNotice}
                    </p>
                  )}
                  {error && (
                    <p role="alert" className="rounded-lg bg-layer-1 p-2 text-13 text-danger-primary">
                      {error}
                    </p>
                  )}
                  <div className="shadow-sm rounded-2xl border border-subtle bg-surface-1 p-3 focus-within:border-accent-strong">
                    <textarea
                      ref={composer}
                      aria-label="Mensagem para Plane AI"
                      className="w-full resize-none bg-transparent p-1 text-13 text-primary outline-none"
                      rows={3}
                      maxLength={24000}
                      value={prompt}
                      onChange={(event) => {
                        setPrompt(event.target.value);
                        requestKey.current = null;
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          void send();
                        }
                      }}
                      placeholder="Pergunte, busque ou peça um relatório…"
                    />
                    <div className="flex items-end justify-between gap-2">
                      <AIModelPicker
                        connections={connections}
                        value={selection}
                        onChange={selectModel}
                        disabled={sending || !!activeRun}
                      />
                      <div className="flex items-center gap-2">
                        {activeRun ? (
                          <button
                            type="button"
                            aria-label="Interromper resposta"
                            className="rounded-full bg-layer-1 p-2.5"
                            onClick={async () => {
                              try {
                                await planeAI.create(workspaceSlug, `runs/${activeRun}/cancel/`, {});
                              } catch (failure) {
                                setError(aiError(failure));
                              }
                            }}
                          >
                            <Square size={16} />
                          </button>
                        ) : (
                          <button
                            type="submit"
                            aria-label="Enviar mensagem"
                            disabled={!model || !prompt.trim() || sending}
                            className="rounded-full bg-accent-primary p-2.5 text-white disabled:opacity-40"
                          >
                            {sending ? <Loader2 size={17} className="animate-spin" /> : <ArrowUp size={17} />}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-11 text-secondary">
                    <label
                      className="flex items-center gap-2"
                      title="Autoriza ferramentas gerais de edição. Pedidos explícitos de criar ou salvar relatórios já podem criar uma página privada quando o projeto é identificado."
                    >
                      <input
                        type="checkbox"
                        disabled={!model?.capabilities.tools || !!activeRun}
                        checked={allowActions}
                        onChange={(event) => setAllowActions(event.target.checked)}
                      />
                      Permitir alterações que eu solicitar
                    </label>
                    <span>{connection?.name ?? "Selecione um modelo"} · Enter envia · Shift+Enter quebra linha</span>
                  </div>
                </form>
              </div>
            </div>
          )}
        </Dialog.Panel>
      </Dialog>
    </AIContext.Provider>
  );
}

export function PlaneAIButton({ variant = "sidebar" }: { variant?: "sidebar" | "top-navigation" }) {
  const ai = usePlaneAI();
  if (!ai?.enabled) return null;
  return (
    <button
      type="button"
      aria-label="Abrir Plane AI"
      title="Abrir Plane AI"
      onClick={() => ai.open()}
      className={
        variant === "top-navigation"
          ? "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-accent-subtle bg-accent-primary/10 px-2.5 text-12 font-medium text-accent-primary transition-colors hover:bg-accent-primary/20 focus-visible:outline-2 focus-visible:outline-accent-strong"
          : "flex w-full items-center gap-2 rounded px-2 py-1.5 text-13 text-secondary hover:bg-layer-1"
      }
    >
      <BrainCircuit size={16} />
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
          const snapshot = editor.getDocument().html,
            selected = editor.getSelectedPlainText(),
            range = editor.getSelectionRange();
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
