import { useState } from "react";
import { observer } from "mobx-react";
import { useUser } from "@/hooks/store/user";
import useSWR, { useSWRConfig } from "swr";
import { fieldError } from "@/components/custom-fields/service";
import type { ModuleStateSettings } from "./service";
import { moduleStatesKey, moduleStatesService } from "./service";

function ModuleRow({
  workspace,
  project,
  module,
  states,
  editable,
  refresh,
}: {
  workspace: string;
  project: string;
  module: ModuleStateSettings["modules"][number];
  states: ModuleStateSettings["states"];
  editable: boolean;
  refresh: () => Promise<unknown>;
}) {
  const [selected, setSelected] = useState<string[] | null>(module.state_ids);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await moduleStatesService.save(workspace, project, module.id, selected);
      await refresh();
    } catch (failure) {
      setError(fieldError(failure));
    } finally {
      setSaving(false);
    }
  };
  return (
    <fieldset className="rounded border border-subtle p-4" disabled={!editable || saving}>
      <legend className="px-1 text-14 font-medium">{module.name}</legend>
      <label className="flex items-center gap-2 text-13">
        <input
          type="checkbox"
          checked={selected === null}
          onChange={(event) => setSelected(event.target.checked ? null : states.map((state) => state.id))}
        />
        Todos os estados do projeto
      </label>
      {selected !== null && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {states.map((state) => (
            <label key={state.id} className="flex items-center gap-2 text-13">
              <input
                type="checkbox"
                checked={selected.includes(state.id)}
                onChange={(event) =>
                  setSelected(event.target.checked ? [...selected, state.id] : selected.filter((id) => id !== state.id))
                }
              />
              <span>{state.name}</span>
            </label>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-13 text-danger-primary">
          {error}
        </p>
      )}
      {editable && (
        <button
          type="button"
          disabled={saving || selected?.length === 0}
          onClick={() => void save()}
          className="mt-3 rounded bg-accent-primary px-3 py-1.5 text-13 text-on-color disabled:opacity-50"
        >
          {saving ? "Salvando…" : `Salvar estados de ${module.name}`}
        </button>
      )}
    </fieldset>
  );
}

export const ModuleStateSettingsPanel = observer(function ModuleStateSettingsPanel({
  workspace,
  project,
  editable,
}: {
  workspace: string;
  project: string;
  editable: boolean;
}) {
  const userId = useUser().data?.id;
  const { data, error, mutate } = useSWR(userId ? [...moduleStatesKey(workspace, project), userId] : null, () =>
    moduleStatesService.settings(workspace, project)
  );
  const { mutate: revalidate } = useSWRConfig();
  const refresh = async () => {
    await mutate();
    await revalidate(
      (key) =>
        Array.isArray(key) &&
        key[0] === "module-state-visibility" &&
        key[1] === workspace &&
        key[2] === project &&
        key[4] === userId
    );
  };
  return (
    <section className="mt-8 space-y-4" aria-label="Estados por módulo">
      <div>
        <h2 className="text-16 font-semibold">Estados por módulo</h2>
        <p className="mt-1 text-13 text-secondary">
          Escolha os estados exibidos nos grupos e seletores de cada módulo. Estados fora da seleção que já tenham
          tarefas continuam visíveis. Esta configuração não bloqueia alterações de estado pela API ou fora do módulo.
        </p>
      </div>
      {error ? (
        <div role="alert">
          <p>{fieldError(error)}</p>
          <button type="button" onClick={() => void mutate()}>
            Tentar novamente
          </button>
        </div>
      ) : !data ? (
        <p role="status">Carregando módulos…</p>
      ) : !data.modules.length ? (
        <p className="text-13 text-secondary">Nenhum módulo ativo neste projeto.</p>
      ) : (
        data.modules.map((module) => (
          <ModuleRow
            key={`${module.id}:${JSON.stringify(module.state_ids)}`}
            workspace={workspace}
            project={project}
            module={module}
            states={data.states}
            editable={editable && data.can_manage}
            refresh={refresh}
          />
        ))
      )}
    </section>
  );
});
