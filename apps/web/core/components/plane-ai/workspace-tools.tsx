import { useState } from "react";
import useSWR from "swr";
import { Button } from "@plane/propel/button";
import { useUser } from "@/hooks/store/user";
import { planeAI, aiError, aiInputClass } from "./service";
import type { AIBootstrap, AIRun, AIScope } from "./service";

type Memory = { id: string; kind: string; project: string | null; text: string };
type Automation = {
  id: string;
  name: string;
  instruction: string;
  enabled: boolean;
  interval_hours: number;
  execution_count: number;
  max_runs: number;
  last_run: string | null;
  next_run_at: string;
  connection: string;
  model: string;
  scope: AIScope;
  action_policy: string;
};
const PRESETS = [
  "Resuma o progresso do projeto, com fatos, métricas e links.",
  "Identifique tarefas atrasadas e bloqueadas. Informe o período e cite as fontes.",
  "Prepare uma atualização de equipe sobre o que mudou nesta semana.",
  "Sugira classificação, prioridades e responsáveis. Separe sugestões de fatos; não altere tarefas.",
];

export function AIWorkspaceTools({ slug, bootstrap, tab }: { slug: string; bootstrap: AIBootstrap; tab: string }) {
  const { data: user } = useUser();
  const memories = useSWR(["ai-memories", slug, user?.id], () => planeAI.read<Memory[]>(slug, "memories/"));
  const automations = useSWR(["ai-automations", slug, user?.id], () =>
    planeAI.read<Automation[]>(slug, "automations/")
  );
  const [text, setText] = useState("");
  const [kind, setKind] = useState("personal");
  const [project, setProject] = useState("");
  const [editing, setEditing] = useState("");
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState(PRESETS[0]);
  const [hours, setHours] = useState(24);
  const [maxRuns, setMaxRuns] = useState(30);
  const [connectionId, setConnection] = useState(bootstrap.connections[0]?.id ?? "");
  const connection = bootstrap.connections.find((c) => c.id === connectionId);
  const [model, setModel] = useState(connection?.default_model ?? "");
  const [error, setError] = useState("");
  const [result, setResult] = useState<AIRun | null>(null);
  const [saving, setSaving] = useState(false);
  const [automaticWrites, setAutomaticWrites] = useState(false);
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      if (tab === "memory") {
        const payload = { kind, project: kind === "project" ? project : null, text };
        if (editing) await planeAI.update(slug, `memories/${editing}/`, payload);
        else await planeAI.create(slug, "memories/", payload);
        setText("");
        setEditing("");
        await memories.mutate();
      } else {
        const payload = {
          name,
          instruction,
          connection: connectionId,
          model,
          interval_hours: hours,
          max_runs: maxRuns,
          scope: project ? { kind: "project", id: project } : { kind: "workspace" },
          action_policy: automaticWrites ? "limited_writes" : "read_only",
        };
        if (editing) await planeAI.update(slug, `automations/${editing}/`, payload);
        else await planeAI.create(slug, "automations/", payload);
        setName("");
        setEditing("");
        await automations.mutate();
      }
    } catch (failure) {
      setError(aiError(failure));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-4 overflow-y-auto p-4 text-13">
      <p className="text-secondary">
        {tab === "memory"
          ? "Memórias são explícitas e editáveis. Conversas privadas não são compartilhadas automaticamente. Memórias de projeto e workspace são administradas pelo administrador."
          : "Automações executam com suas permissões atuais pelo Celery. Escrita automática exige política explícita de administrador e um projeto. Frequência mínima: 1 hora; verificação a cada 5 minutos."}
      </p>
      {error && (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      )}
      <form
        className="space-y-3 rounded border border-subtle p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {tab === "memory" ? (
          <>
            <select
              aria-label="Visibilidade da memória"
              className={aiInputClass}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="personal">Pessoal</option>
              {bootstrap.admin && (
                <>
                  <option value="project">Projeto</option>
                  <option value="workspace">Workspace compartilhado</option>
                </>
              )}
            </select>
            <textarea
              aria-label="Memória persistente"
              required
              className={aiInputClass}
              value={text}
              rows={4}
              onChange={(e) => setText(e.target.value)}
              maxLength={4000}
            />
          </>
        ) : (
          <>
            <input
              aria-label="Nome da automação"
              required
              className={aiInputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
            <select
              aria-label="Modelo de instrução"
              className={aiInputClass}
              onChange={(e) => setInstruction(e.target.value)}
            >
              <option value="">Instrução personalizada</option>
              {PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
            </select>
            <textarea
              aria-label="Instrução reutilizável"
              required
              className={aiInputClass}
              value={instruction}
              rows={4}
              onChange={(e) => setInstruction(e.target.value)}
              maxLength={6000}
            />
            <select
              aria-label="Conexão da automação"
              className={aiInputClass}
              value={connectionId}
              onChange={(e) => {
                setConnection(e.target.value);
                setModel(bootstrap.connections.find((c) => c.id === e.target.value)?.default_model ?? "");
              }}
            >
              {bootstrap.connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Modelo da automação"
              className={aiInputClass}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {connection?.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </select>
            <label className="block">
              Intervalo (horas)
              <input
                className={aiInputClass}
                type="number"
                min={1}
                max={8760}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              />
            </label>
            <label className="block">
              Máximo de execuções
              <input
                className={aiInputClass}
                type="number"
                min={1}
                max={1000}
                value={maxRuns}
                onChange={(e) => setMaxRuns(Number(e.target.value))}
              />
            </label>
          </>
        )}
        {(tab !== "memory" || kind === "project") && (
          <select
            aria-label="Escopo de projeto"
            className={aiInputClass}
            required={kind === "project" && tab === "memory"}
            value={project}
            onChange={(e) => setProject(e.target.value)}
          >
            <option value="">{tab === "memory" ? "Selecione o projeto" : "Workspace"}</option>
            {bootstrap.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        {tab !== "memory" && bootstrap.admin && (
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={automaticWrites}
              onChange={(event) => setAutomaticWrites(event.target.checked)}
            />
            Autorizar no máximo uma alteração por execução neste projeto: adicionar comentário ou atualizar prioridade,
            estado e responsáveis. Outras operações e alterações em lote são recusadas.
          </label>
        )}
        <Button type="submit" disabled={saving}>
          {editing ? "Salvar alterações" : "Adicionar"}
        </Button>
      </form>
      {tab === "memory"
        ? memories.data?.map((memory) => (
            <div key={memory.id} className="space-y-2 rounded border border-subtle p-3">
              <p className="text-secondary">
                {memory.kind}
                {memory.project
                  ? ` · ${bootstrap.projects.find((p) => p.id === memory.project)?.name ?? "Projeto"}`
                  : ""}
              </p>
              <p className="whitespace-pre-wrap">{memory.text}</p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditing(memory.id);
                    setText(memory.text);
                    setKind(memory.kind);
                    setProject(memory.project ?? "");
                  }}
                >
                  Editar
                </Button>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await planeAI.remove(slug, `memories/${memory.id}/`);
                      await memories.mutate();
                    } catch (failure) {
                      setError(aiError(failure));
                    }
                  }}
                >
                  Apagar
                </Button>
              </div>
            </div>
          ))
        : automations.data?.map((automation) => (
            <div key={automation.id} className="space-y-2 rounded border border-subtle p-3">
              <strong>
                {automation.name} · {automation.enabled ? "Ativa" : "Desativada"}
              </strong>
              <p>
                {automation.execution_count}/{automation.max_runs} execuções · a cada {automation.interval_hours} h
              </p>
              <p className="text-secondary">Próxima: {automation.next_run_at}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditing(automation.id);
                    setName(automation.name);
                    setInstruction(automation.instruction);
                    setHours(automation.interval_hours);
                    setMaxRuns(automation.max_runs);
                    setConnection(automation.connection);
                    setModel(automation.model);
                    setProject(automation.scope.id ?? "");
                    setAutomaticWrites(automation.action_policy === "limited_writes");
                  }}
                >
                  Editar
                </Button>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await planeAI.update(slug, `automations/${automation.id}/`, { enabled: !automation.enabled });
                      await automations.mutate();
                    } catch (failure) {
                      setError(aiError(failure));
                    }
                  }}
                >
                  {automation.enabled ? "Desativar" : "Ativar"}
                </Button>
                {automation.last_run && (
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      try {
                        setResult(await planeAI.read<AIRun>(slug, `runs/${automation.last_run}/`));
                      } catch (failure) {
                        setResult(null);
                        setError(aiError(failure));
                      }
                    }}
                  >
                    Último resultado
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await planeAI.remove(slug, `automations/${automation.id}/`);
                      await automations.mutate();
                    } catch (failure) {
                      setError(aiError(failure));
                    }
                  }}
                >
                  Apagar
                </Button>
              </div>
            </div>
          ))}
      {result && (
        <section className="rounded border border-subtle p-3">
          <strong>{result.status}</strong>
          <p className="whitespace-pre-wrap">{result.response || result.error}</p>
          {result.sources.map((source) => (
            <a className="block text-accent-primary underline" key={`${source.kind}:${source.id}`} href={source.url}>
              {source.title}
            </a>
          ))}
        </section>
      )}
    </div>
  );
}
