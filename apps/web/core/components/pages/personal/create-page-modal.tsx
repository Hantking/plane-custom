import { useRef, useState } from "react";
import { Dialog } from "@headlessui/react";
import { EPageAccess } from "@plane/constants";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { ProjectPageService } from "@/services/page/project-page.service";
import { fieldError, fieldInputClass } from "@/components/custom-fields/service";
import type { PersonalPagesResult } from "./service";

const pageService = new ProjectPageService();

export function PersonalCreatePageModal({
  workspace,
  projects,
  onClose,
  onCreated,
}: {
  workspace: string;
  projects: PersonalPagesResult["creatable_projects"];
  onClose: () => void;
  onCreated: (page: string, project: string) => void;
}) {
  const [project, setProject] = useState(projects[0]?.id ?? "");
  const [name, setName] = useState("");
  const [access, setAccess] = useState(EPageAccess.PRIVATE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const close = () => {
    if (!busy.current) onClose();
  };
  const canCreate = projects.some((item) => item.id === project) && !!name.trim();
  const create = async () => {
    if (busy.current || !canCreate) return;
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      const page = await pageService.create(workspace, project, { name: name.trim(), access });
      if (!page?.id) throw new Error("O servidor não retornou a página criada.");
      onCreated(page.id, project);
    } catch (failure) {
      // The native service throws the server's validation payload, not AxiosError.
      setError(failure instanceof Error ? failure.message : fieldError({ response: { data: failure } }));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  return (
    <ModalCore isOpen handleClose={close} position={EModalPosition.TOP} width={EModalWidth.LG}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
        className="space-y-4 p-5"
      >
        <Dialog.Title as="h2" className="text-18 font-semibold">
          Nova página
        </Dialog.Title>
        <fieldset disabled={saving} className="space-y-4">
          <label className="block text-13">
            Projeto
            <select
              aria-label="Projeto da nova página"
              required
              className={`${fieldInputClass} mt-1 w-full`}
              value={project}
              onChange={(event) => setProject(event.target.value)}
            >
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.identifier} · {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-13">
            Título
            <input
              aria-label="Título da nova página"
              required
              maxLength={255}
              className={`${fieldInputClass} mt-1 w-full`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nome da página"
            />
          </label>
          <label className="block text-13">
            Visibilidade
            <select
              aria-label="Visibilidade da nova página"
              className={`${fieldInputClass} mt-1 w-full`}
              value={access}
              onChange={(event) => setAccess(Number(event.target.value) as EPageAccess)}
            >
              <option value={EPageAccess.PRIVATE}>Privada — somente você</option>
              <option value={EPageAccess.PUBLIC}>Compartilhada com o projeto</option>
            </select>
          </label>
        </fieldset>
        {error && (
          <p role="alert" className="text-13 text-danger-primary">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={close}
            className="rounded border border-subtle px-3 py-1.5 text-13 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving || !canCreate}
            className="rounded bg-accent-primary px-3 py-1.5 text-13 font-medium text-on-color disabled:opacity-50"
          >
            {saving ? "Criando…" : "Criar página"}
          </button>
        </div>
      </form>
    </ModalCore>
  );
}
