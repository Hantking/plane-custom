import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, Download, ExternalLink, Loader2, Sparkles } from "lucide-react";
import { Button } from "@plane/propel/button";
import type { AIRun, AIReport } from "./service";
import { actionNames, downloadAIFile, reportCSV } from "./chat-helpers";
import { AIReportActions } from "./report-actions";
import type { ReportExportContext } from "./report-actions";

function ReportCard({
  report,
  run,
  exportContext,
}: {
  report: AIReport;
  run: AIRun;
  exportContext: ReportExportContext;
}) {
  return (
    <section className="my-3 space-y-3 rounded-xl border border-subtle bg-layer-1 p-4" aria-label={report.title}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{report.title}</h3>
        <button
          type="button"
          className="flex items-center gap-1 text-11 text-secondary hover:text-primary"
          onClick={() => downloadAIFile(reportCSV(report), "relatorio-plane.csv", "text/csv;charset=utf-8")}
        >
          <Download size={13} />
          CSV
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["total", "Tarefas"],
            ["completed", "Concluídas"],
            ["overdue", "Atrasadas"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="rounded-lg bg-surface-1 p-2">
            <strong className="text-xl block">{report.metrics[key]}</strong>
            <span className="text-11 text-secondary">{label}</span>
          </div>
        ))}
      </div>
      {!!report.rows.length && (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-left text-11">
            <thead>
              <tr>
                {report.columns.map((column) => (
                  <th key={column} className="border-b border-subtle p-2 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.row_ids.map((rowId, index) => (
                <tr key={rowId}>
                  {report.columns.map((column, cell) => (
                    <td key={column} className="border-b border-subtle p-2">
                      {report.rows[index][cell]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-11 text-secondary">
        {report.period
          ? `${report.period.from} a ${report.period.to}`
          : `Retrato em ${new Date(report.as_of).toLocaleDateString("pt-BR", { timeZone: report.timezone })}`}{" "}
        · {report.timezone}
        {report.truncated ? " · Exibição limitada a 100 grupos" : ""}
      </p>
      <details className="text-11 text-secondary">
        <summary className="cursor-pointer">Como os números são calculados</summary>
        <p className="mt-1">{report.definition}</p>
      </details>
      <AIReportActions run={run} reportId={report.id} reportTitle={report.title} context={exportContext} />
    </section>
  );
}

export function AIChatMessage({
  run,
  command,
  apply,
  exportContext,
}: {
  run: AIRun;
  command: (run: AIRun, action: string) => void;
  apply?: (text: string, mode: "insert" | "replace" | "discard") => void;
  exportContext: ReportExportContext;
}) {
  const [copied, setCopied] = useState(false);
  const active = ["queued", "running", "cancelling"].includes(run.status);
  return (
    <article className="space-y-4 text-13">
      <div className="ml-auto max-w-[90%] rounded-2xl bg-layer-1 px-4 py-3 whitespace-pre-wrap">{run.prompt}</div>
      <div className="flex items-center gap-2 text-11 text-secondary">
        <Sparkles size={15} className="text-accent-primary" />
        <strong className="text-primary">Plane AI</strong>
        <span className="truncate">{run.model}</span>
      </div>
      {run.response && (
        <div className="prose-sm [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base max-w-none break-words text-primary prose [&_a]:text-accent-primary [&_a]:underline [&_li]:my-1 [&_p]:my-3 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-layer-1 [&_pre]:p-3 [&_table]:block [&_table]:max-w-full [&_table]:overflow-auto [&_td]:border [&_td]:border-subtle [&_td]:p-2 [&_th]:border [&_th]:border-subtle [&_th]:p-2">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.response}</ReactMarkdown>
        </div>
      )}
      {active && (
        <p className="flex items-center gap-2 text-secondary" role="status">
          <Loader2 size={14} className="animate-spin" />
          {run.status === "queued"
            ? "Preparando sua resposta…"
            : run.status === "cancelling"
              ? "Interrompendo…"
              : (run.context.activity ?? "Consultando o contexto do workspace…")}
        </p>
      )}
      {(run.context.reports ?? []).map((report) => (
        <ReportCard key={report.id} report={report} run={run} exportContext={exportContext} />
      ))}
      {run.error && (
        <p role="alert" className="rounded-lg border border-subtle p-3 text-danger-primary">
          {run.error}
        </p>
      )}
      {!!run.sources.length && (
        <details className="rounded-xl border border-subtle p-3">
          <summary className="cursor-pointer text-11 font-medium">
            {run.sources.length} fontes consultadas no workspace
          </summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {run.sources.map((source) => (
              <a
                key={`${source.kind}:${source.id}`}
                href={source.url}
                className="flex min-w-0 items-center gap-2 rounded-lg bg-layer-1 p-2 text-11 hover:underline"
              >
                <ExternalLink size={12} className="shrink-0" />
                <span className="truncate">{source.title}</span>
              </a>
            ))}
          </div>
        </details>
      )}
      {run.actions.map((action) => (
        <section key={action.id} className="space-y-2 rounded-xl border border-subtle p-3">
          <strong>{actionNames[action.operation] ?? action.operation}</strong>
          <span className="ml-2 text-11 text-secondary">
            {(
              {
                proposed: "Aguardando confirmação",
                done: "Concluído",
                failed: "Não concluído",
                rejected: "Descartado",
              } as Record<string, string>
            )[action.status] ?? action.status}
          </span>
          {action.result.url && (
            <a className="block text-accent-primary underline" href={action.result.url}>
              {action.result.title}
            </a>
          )}
          {action.result.error && (
            <p role="alert" className="text-danger-primary">
              {action.result.error}
            </p>
          )}
          {action.status === "proposed" && (
            <details>
              <summary className="cursor-pointer text-11">Ver alterações propostas</summary>
              <pre className="mt-2 overflow-auto text-11">{JSON.stringify(action.arguments, null, 2)}</pre>
            </details>
          )}
        </section>
      ))}
      {run.status === "awaiting_confirmation" && (
        <div className="flex gap-2">
          <Button onClick={() => command(run, "approve")}>Confirmar alterações</Button>
          <Button variant="secondary" onClick={() => command(run, "reject")}>
            Descartar
          </Button>
        </div>
      )}
      {["failed", "cancelled"].includes(run.status) && (
        <Button variant="secondary" onClick={() => command(run, "retry")}>
          Tentar novamente
        </Button>
      )}
      {apply && run.status === "completed" && !!run.response && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => apply(run.response, "insert")}>Inserir no editor</Button>
          <Button variant="secondary" onClick={() => apply(run.response, "replace")}>
            Substituir seleção
          </Button>
          <Button variant="secondary" onClick={() => apply("", "discard")}>
            Descartar
          </Button>
        </div>
      )}
      {!active && !!run.response && (
        <div className="flex flex-wrap items-center gap-3 text-11 text-secondary">
          <button
            type="button"
            className="flex items-center gap-1 hover:text-primary"
            onClick={() => {
              void navigator.clipboard
                .writeText(run.response)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                  return true;
                })
                .catch(() => setCopied(false));
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copiado" : "Copiar"}
          </button>
          <button
            type="button"
            className="flex items-center gap-1 hover:text-primary"
            onClick={() => downloadAIFile(run.response, "resposta-plane-ai.md")}
          >
            <Download size={13} />
            Salvar resposta
          </button>
          {run.context.truncated && <span>Contexto limitado · consulte as fontes</span>}
        </div>
      )}
      {run.status === "completed" && !!run.response && <AIReportActions run={run} context={exportContext} />}
    </article>
  );
}
