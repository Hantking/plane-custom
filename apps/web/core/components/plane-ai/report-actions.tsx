import { useRef, useState } from "react";
import { Dialog } from "@headlessui/react";
import { ExternalLink, FileDown, FilePlus2, Loader2, X } from "lucide-react";
import { Button } from "@plane/propel/button";
import { planeAI, aiError, aiInputClass } from "./service";
import type { AIReportDocument, AIRun, AISource } from "./service";
import { downloadAIBlob } from "./chat-helpers";

export type ReportExportContext = {
  workspaceSlug: string;
  writableProjects: { id: string; name: string }[];
  onPublished: () => Promise<void>;
};

export function AIReportActions({
  run,
  reportId,
  reportTitle,
  context,
}: {
  run: AIRun;
  reportId?: string;
  reportTitle?: string;
  context: ReportExportContext;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"" | "pdf" | "page">("");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<AISource | null>(null);
  const [project, setProject] = useState("");
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState(1);
  const requestKey = useRef<string | null>(null);
  const initialFocus = useRef<HTMLInputElement>(null);
  const ready = run.status === "completed";
  const exportPDF = async () => {
    setBusy("pdf");
    setError("");
    try {
      const query = reportId ? `?report_id=${encodeURIComponent(reportId)}` : "";
      const document = await planeAI.read<AIReportDocument>(
        context.workspaceSlug,
        `runs/${run.id}/report-document/${query}`
      );
      const { reportPDF } = await import("./report-pdf");
      const blob = await reportPDF(document.html);
      downloadAIBlob(blob, document.filename);
    } catch (failure) {
      setError(aiError(failure));
    } finally {
      setBusy("");
    }
  };
  const createPage = async () => {
    if (!project || !title.trim() || busy) return;
    setBusy("page");
    setError("");
    try {
      requestKey.current ??= crypto.randomUUID();
      const page = await planeAI.create<AISource>(context.workspaceSlug, `runs/${run.id}/report-page/`, {
        project_id: project,
        title: title.trim(),
        access: visibility,
        request_key: requestKey.current,
        ...(reportId ? { report_id: reportId } : {}),
      });
      setCreated(page);
      setOpen(false);
      await context.onPublished();
    } catch (failure) {
      setError(aiError(failure));
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 text-11 text-secondary">
        <button
          type="button"
          disabled={!ready || !!busy}
          className="flex items-center gap-1 hover:text-primary disabled:opacity-50"
          onClick={() => void exportPDF()}
        >
          {busy === "pdf" ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}Exportar PDF
        </button>
        <button
          type="button"
          disabled={!ready || !!busy || !context.writableProjects.length}
          className="flex items-center gap-1 hover:text-primary disabled:opacity-50"
          title={
            !context.writableProjects.length
              ? "Você precisa de permissão de edição em um projeto para criar páginas."
              : undefined
          }
          onClick={() => {
            setProject(
              context.writableProjects.find((item) => item.id === run.context.scope?.id)?.id ??
                context.writableProjects[0]?.id ??
                ""
            );
            setTitle(reportTitle ?? run.context.reports?.[0]?.title ?? "Relatório · Plane AI");
            setVisibility(1);
            requestKey.current = null;
            setError("");
            setOpen(true);
          }}
        >
          <FilePlus2 size={13} />
          Criar página no Plane
        </button>
        {created && (
          <a href={created.url} className="flex items-center gap-1 text-accent-primary underline">
            <ExternalLink size={13} />
            Abrir página: {created.title}
          </a>
        )}
      </div>
      {error && !open && (
        <p role="alert" className="text-11 text-danger-primary">
          {error}
        </p>
      )}
      <Dialog
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        initialFocus={initialFocus}
        className="relative z-[120]"
      >
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="shadow-xl w-full max-w-lg space-y-4 rounded-2xl border border-subtle bg-surface-1 p-5 text-13 text-primary">
            <div className="flex items-center justify-between">
              <Dialog.Title className="text-lg font-semibold">Criar página com o relatório</Dialog.Title>
              <button
                type="button"
                aria-label="Fechar criação de página"
                disabled={!!busy}
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-secondary">
              A página incluirá a análise, tabelas, período e fontes desta resposta. Depois de criada, você pode
              editá-la normalmente no Plane.
            </p>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void createPage();
              }}
            >
              <label className="block">
                Título
                <input
                  ref={initialFocus}
                  aria-label="Título da página do relatório"
                  required
                  maxLength={160}
                  className={aiInputClass}
                  value={title}
                  disabled={!!busy}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    requestKey.current = null;
                  }}
                />
              </label>
              <label className="block">
                Projeto
                <select
                  aria-label="Projeto da página do relatório"
                  className={aiInputClass}
                  value={project}
                  disabled={!!busy}
                  onChange={(event) => {
                    setProject(event.target.value);
                    requestKey.current = null;
                  }}
                >
                  {context.writableProjects.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                Visibilidade
                <select
                  aria-label="Visibilidade da página do relatório"
                  className={aiInputClass}
                  value={visibility}
                  disabled={!!busy}
                  onChange={(event) => {
                    setVisibility(Number(event.target.value));
                    requestKey.current = null;
                  }}
                >
                  <option value={1}>Privada · somente você</option>
                  <option value={0}>Compartilhada com o projeto</option>
                </select>
              </label>
              {error && (
                <p role="alert" className="text-danger-primary">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" disabled={!!busy} onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={!!busy || !title.trim() || !project}>
                  {busy === "page" && <Loader2 size={14} className="animate-spin" />}Criar página
                </Button>
              </div>
            </form>
          </Dialog.Panel>
        </div>
      </Dialog>
    </>
  );
}
