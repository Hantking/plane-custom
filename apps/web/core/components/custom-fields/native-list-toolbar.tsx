import { useEffect, useState } from "react";
import useSWR from "swr";
import { Button } from "@plane/propel/button";
import type { IList } from "@/components/issues/issue-layouts/list/default";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
import { CreateUpdateIssueModal } from "@/components/issues/issue-modal/modal";
import { NativeDisplayControls } from "./native-display-controls";
import { useNativeList } from "./native-list-context";
import { useNativeFieldsContext } from "./native-context";
import { nativeDisplayService } from "./native-service";
import { FilterTreeEditor, MultiSortEditor } from "./query-editors";
import { fieldsService, fieldError, fieldInputClass } from "./service";
import type { FieldValue, SavedView, ViewConfig } from "./service";
import { FieldInput } from "./inputs";
import { normalizeListQuery } from "./native-list-model";
import type { ListSummary } from "./native-list-controller";
import { SPREADSHEET_COLUMNS } from "@/components/issues/issue-layouts/utils";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";

export function NativeListToolbar({ props, summary }: { props: IList; summary?: ListSummary }) {
  const storeType = useIssueStoreType();
  const list = useNativeList()!;
  const native = useNativeFieldsContext()!;
  const project = native.display.request?.project_id ?? "";
  const fields = native.display.data?.fields ?? [];
  const [draft, setDraft] = useState(list.query);
  const [search, setSearch] = useState(list.query.search);
  const [error, setError] = useState("");
  const [viewName, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [create, setCreate] = useState(false);
  const [calculationField, setCalculationField] = useState("");
  const [calculationOp, setCalculationOp] = useState("count");
  const canManage = !!project && !!native.display.data?.manageable_project_ids?.includes(project);
  const views = useSWR(project ? ["hentis-views", native.display.workspace, project] : null, () =>
    fieldsService.views(native.display.workspace, project)
  );
  const selected = views.data?.find((view) => view.id === list.query.view_id);
  const canUpdate =
    !!selected && (selected.owner_id === native.display.userId || canManage) && (!selected.locked || canManage);
  const queryKey = JSON.stringify(list.query);
  useEffect(() => {
    setDraft(normalizeListQuery(JSON.parse(queryKey) as ViewConfig));
    setSearch((JSON.parse(queryKey) as ViewConfig).search);
  }, [queryKey]);
  const apply = async (patch: Partial<ViewConfig>) => {
    setError("");
    try {
      await list.patch(patch);
    } catch (failure) {
      setError(fieldError(failure));
    }
  };
  const presetConfig = () => {
    const { view_id: _view, manual_order: _manual, collapsed_groups: _collapsed, ...config } = list.query;
    return { ...config, manual: false, columns: native.display.data?.preference.visible ?? [] };
  };
  const chooseView = async (id: string) => {
    const view = views.data?.find((item) => item.id === id);
    try {
      if (view && native.display.request && native.display.data) {
        const allowed = new Set(fields.map((field) => field.id));
        const metadata = await nativeDisplayService.save(native.display.workspace, native.display.request, {
          ...native.display.data.preference,
          visible: (view.config.columns ?? []).filter((key) => allowed.has(key)),
        });
        await native.display.mutate(metadata, { revalidate: false });
      }
      await apply({
        ...normalizeListQuery(view?.config),
        view_id: id || undefined,
        manual: list.query.manual,
        manual_order: list.query.manual_order,
      });
    } catch (failure) {
      setError(fieldError(failure));
    }
  };
  const updateView = async (patch: Partial<SavedView>) => {
    if (!selected) return;
    try {
      await fieldsService.updateView(native.display.workspace, project, selected, patch);
      await views.mutate();
    } catch (failure) {
      setError(fieldError(failure));
    }
  };
  return (
    <div className="relative z-30 shrink-0 space-y-2 border-b border-subtle bg-surface-1 p-3 text-13">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>Lista · {summary?.count ?? "…"} tarefas únicas</strong>
        <div className="flex gap-2">
          {!props.disableIssueCreation && !props.isCompletedCycle && (
            <Button onClick={() => setCreate(true)}>Nova tarefa</Button>
          )}
          <Button variant="secondary" disabled={list.busy} onClick={() => void list.exportCSV("presentation")}>
            CSV · campos visíveis
          </Button>
          <Button variant="secondary" disabled={list.busy} onClick={() => void list.exportCSV("all")}>
            CSV · todos os campos
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-2" aria-label="Controles da Lista">
        <label className="flex items-center gap-1">
          Agrupar
          <select
            aria-label="Agrupar Lista"
            className={fieldInputClass}
            disabled={list.busy}
            value={list.query.group_by ? `custom:${list.query.group_by}` : (list.query.native_group ?? "inherit")}
            onChange={(event) => {
              const value = event.target.value;
              void apply(
                value.startsWith("custom:")
                  ? { group_by: value.slice(7) }
                  : { group_by: "", native_group: value as ViewConfig["native_group"] }
              );
            }}
          >
            <option value="inherit">Agrupamento nativo atual</option>
            <option value="none">Sem grupos</option>
            {[
              ["state", "Estado"],
              ["priority", "Prioridade"],
              ["assignees", "Responsável"],
              ["labels", "Etiquetas"],
              ["cycle", "Ciclo"],
              ["module", "Módulo"],
              ["created_by", "Criador"],
            ].map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
            {fields
              .filter((field) => ["select", "multiselect", "boolean"].includes(field.kind))
              .map((field) => (
                <option key={field.id} value={`custom:${field.id}`}>
                  {!project ? `${field.project_identifier} · ` : ""}
                  {field.name}
                </option>
              ))}
          </select>
        </label>
        <details className="relative rounded border border-subtle p-1.5">
          <summary>Ordenar ({list.query.sorts?.length ?? 0})</summary>
          <div className="absolute left-0 z-40 mt-2 w-[min(90vw,640px)] space-y-3 rounded border border-subtle bg-surface-1 p-3 shadow-raised-200">
            <MultiSortEditor
              value={draft.sorts ?? []}
              fields={fields}
              onChange={(sorts) => setDraft({ ...draft, sorts })}
            />
            <div className="flex gap-2">
              <Button disabled={list.busy} onClick={() => void apply({ sorts: draft.sorts, manual: false })}>
                Aplicar ordem
              </Button>
              <Button variant="secondary" disabled={list.busy} onClick={() => void apply({ sorts: [], manual: true })}>
                Ordem manual pessoal
              </Button>
            </div>
            <p className="text-11 text-secondary">
              Reordenação pessoal por contexto, preset e grupo (sem alterar sort_order compartilhado). Movimentos entre
              grupos nativos mantêm os efeitos compartilhados do Plane. Manual disponível sem grupos, por
              estado/prioridade e campos customizados.
            </p>
          </div>
        </details>
        <details className="relative rounded border border-subtle p-1.5">
          <summary>Filtrar</summary>
          <div className="absolute left-0 z-40 mt-2 max-h-[70vh] w-[min(90vw,650px)] space-y-2 overflow-auto rounded border border-subtle bg-surface-1 p-3 shadow-raised-200">
            <p className="text-11 text-secondary">
              Filtros customizados são combinados com os filtros nativos. AND/OR/NOT, até 5 níveis e 100 nós.
            </p>
            <FilterTreeEditor
              fields={fields}
              value={draft.filter_tree!}
              onChange={(filter_tree) => setDraft({ ...draft, filter_tree })}
            />
            <Button disabled={list.busy} onClick={() => void apply({ filter_tree: draft.filter_tree })}>
              Aplicar filtros
            </Button>
            <Button
              variant="secondary"
              disabled={list.busy}
              onClick={() => void apply({ filter_tree: { op: "and", children: [] }, filters: [], search: "" })}
            >
              Limpar filtros customizados
            </Button>
          </div>
        </details>
        <label className="flex items-center gap-1">
          Subtarefas
          <select
            aria-label="Modo de subtarefas"
            className={fieldInputClass}
            disabled={list.busy}
            value={list.query.subtasks ?? "collapsed"}
            onChange={(event) => void apply({ subtasks: event.target.value as ViewConfig["subtasks"] })}
          >
            <option value="collapsed">Recolhidas</option>
            <option value="expanded">Expandidas</option>
            <option value="separate">Separadas</option>
          </select>
        </label>
        <details className="relative rounded border border-subtle p-1.5">
          <summary>Campos</summary>
          <div className="absolute right-0 z-40 mt-2 max-h-[75vh] w-96 max-w-[90vw] overflow-auto rounded border border-subtle bg-surface-1 p-3 shadow-raised-200">
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={!!props.displayProperties?.key}
                onChange={(event) => list.updateStandard({ key: event.target.checked })}
              />
              Identificador
            </label>
            <NativeDisplayControls
              layout="list"
              standardProperties={Object.keys(SPREADSHEET_COLUMNS) as (keyof NonNullable<IList["displayProperties"]>)[]}
              displayProperties={props.displayProperties ?? {}}
              updateStandard={list.updateStandard}
            />
          </div>
        </details>
        <form
          className="flex gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            void apply({ search });
          }}
        >
          <input
            data-native-list-search
            aria-label="Buscar na Lista"
            className={fieldInputClass}
            value={search}
            maxLength={255}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ID, título, descrição, campos visíveis"
          />
          <Button type="submit" variant="secondary" disabled={list.busy}>
            Buscar
          </Button>
        </form>
        <details className="relative rounded border border-subtle p-1.5">
          <summary>Personalizar</summary>
          <div className="absolute right-0 z-40 mt-2 w-80 space-y-2 rounded border border-subtle bg-surface-1 p-3 shadow-raised-200">
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={!!list.query.search_hidden}
                onChange={(event) => void apply({ search_hidden: event.target.checked })}
              />
              Incluir campos textuais ocultos na busca (extensão explícita)
            </label>
            <p className="text-11">
              Expandidas: filhos autorizados são contextuais, sem entrar nos filtros/totais/exportação dos pais.
              Separadas: cada tarefa/subtarefa é filtrada, ordenada e contada uma única vez. Expansão automática até o
              limite nativo de 3 níveis.
            </p>
            <h3 className="font-medium">Cálculos do resultado completo</h3>
            <select
              aria-label="Campo de cálculo"
              className={fieldInputClass}
              value={calculationField}
              onChange={(event) => setCalculationField(event.target.value)}
            >
              <option value="">Selecione</option>
              {fields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Operação de cálculo"
              className={fieldInputClass}
              value={calculationOp}
              onChange={(event) => setCalculationOp(event.target.value)}
            >
              {["count", "sum", "avg", "min", "max"].map((op) => (
                <option key={op}>{op}</option>
              ))}
            </select>
            <Button
              variant="secondary"
              disabled={!calculationField || list.busy}
              onClick={() =>
                void apply({
                  calculations: [
                    ...(list.query.calculations ?? []),
                    { field: calculationField, operation: calculationOp as "count" },
                  ],
                })
              }
            >
              Adicionar cálculo
            </Button>
            {(list.query.calculations ?? []).map((calculation, index) => (
              <div key={`${calculation.field}:${calculation.operation}`} className="flex justify-between">
                {fields.find((f) => f.id === calculation.field)?.name} · {calculation.operation}
                <button
                  aria-label="Remover cálculo"
                  onClick={() => void apply({ calculations: list.query.calculations?.filter((_, i) => i !== index) })}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </details>
      </div>
      {project && (
        <div className="flex flex-wrap items-center gap-2 text-11">
          <select
            aria-label="Preset de filtros e ordenação"
            className={fieldInputClass}
            value={list.query.view_id ?? ""}
            onChange={(event) => void chooseView(event.target.value)}
          >
            <option value="">Configuração pessoal atual</option>
            {views.data?.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name}
                {view.shared ? " · compartilhada" : " · privada"}
                {view.locked ? " · bloqueada" : ""}
              </option>
            ))}
          </select>
          <input
            aria-label="Nome da View"
            className={fieldInputClass}
            value={viewName}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            placeholder="Novo preset"
          />
          <label className="flex gap-1">
            <input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} />
            Compartilhada
          </label>
          <Button
            variant="secondary"
            disabled={!viewName.trim() || list.busy || !props.canEditProperties(project)}
            onClick={async () => {
              try {
                await fieldsService.saveView(
                  native.display.workspace,
                  project,
                  viewName.trim(),
                  shared,
                  presetConfig()
                );
                await views.mutate();
                setName("");
              } catch (failure) {
                setError(fieldError(failure));
              }
            }}
          >
            Salvar novo preset
          </Button>
          {canUpdate && (
            <Button variant="secondary" onClick={() => void updateView({ config: presetConfig() })}>
              Atualizar preset
            </Button>
          )}
          {selected && canManage && (
            <Button variant="secondary" onClick={() => void updateView({ locked: !selected.locked })}>
              {selected.locked ? "Desbloquear" : "Bloquear"}
            </Button>
          )}
          {selected && canUpdate && (
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await fieldsService.deleteView(native.display.workspace, project, selected.id);
                  await views.mutate();
                  await apply({ view_id: undefined });
                } catch (failure) {
                  setError(fieldError(failure));
                }
              }}
            >
              Excluir preset
            </Button>
          )}
          <span className="text-secondary">
            Presets compartilham consulta; ordem/visibilidade/larguras e posição manual são pessoais. Colunas do preset
            alteram visibilidade, não a ordem.
          </span>
        </div>
      )}
      {summary?.calculations.length ? (
        <div className="flex flex-wrap gap-3" aria-label="Cálculos da Lista">
          {summary.calculations.map((item) => (
            <span key={`${item.field}:${item.operation}`}>
              {fields.find((f) => f.id === item.field)?.name} · {item.operation}: <strong>{item.value ?? "—"}</strong>
            </span>
          ))}
        </div>
      ) : null}
      {error && (
        <p role="alert" className="text-danger-primary">
          {error}
        </p>
      )}
      {create && (
        <CreateUpdateIssueModal
          storeType={storeType}
          isOpen
          onClose={() => {
            setCreate(false);
            void list.reload();
          }}
          data={list.createDefaults()}
        />
      )}
    </div>
  );
}

export function NativeListBulkTools({ helpers }: { helpers: TSelectionHelper }) {
  const list = useNativeList();
  const native = useNativeFieldsContext();
  const [selection, setSelection] = useState<{ token: string; count: number } | null>(null);
  const [fieldId, setField] = useState("");
  const [value, setValue] = useState<FieldValue>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const queryKey = JSON.stringify(list?.query);
  useEffect(() => {
    setSelection(null);
  }, [queryKey]);
  if (!list?.enabled || !native) return null;
  const field = native.display.data?.fields.find((candidate) => candidate.id === fieldId);
  const canWrite = !!native.display.data?.fields.some((candidate) => list.canEditProject(candidate.project_id));
  const loaded = [...new Set((native.issueIds ?? []).filter((id) => helpers.getIsEntitySelected(id)))];
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-subtle bg-layer-1 p-2 text-11">
      <span>Operações nativas: {loaded.length} selecionados carregados. Campos personalizados:</span>
      <Button
        variant="secondary"
        disabled={busy || !canWrite || !loaded.length}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await list.operation<{ token: string; count: number }>("selection", { ids: loaded });
            setSelection(result);
            setMessage(
              result.count < loaded.length
                ? "Itens fora dos filtros/política de subtarefas não entram nesta seleção."
                : ""
            );
          } catch (failure) {
            setMessage(fieldError(failure));
          } finally {
            setBusy(false);
          }
        }}
      >
        Usar selecionados carregados
      </Button>
      <Button
        variant="secondary"
        disabled={busy || !canWrite}
        onClick={async () => {
          setBusy(true);
          try {
            setSelection(await list.operation("selection"));
            setMessage("");
          } catch (failure) {
            setMessage(fieldError(failure));
          } finally {
            setBusy(false);
          }
        }}
      >
        Selecionar todos os resultados
      </Button>
      {selection && (
        <>
          <strong>{selection.count} tarefas únicas · seleção congelada por 5 min</strong>
          <select
            aria-label="Campo da operação em massa"
            className={fieldInputClass}
            value={fieldId}
            onChange={(event) => {
              setField(event.target.value);
              setValue(null);
            }}
          >
            <option value="">Campo</option>
            {native.display.data?.fields.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
          {field && (
            <div className="max-w-60">
              <FieldInput field={field} value={value} immediate disabled={busy} onChange={setValue} />
            </div>
          )}
          <Button
            disabled={busy || !field || !selection.count}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await list.operation<{
                  succeeded: number;
                  count: number;
                  results: { id: string; ok: boolean; error?: string }[];
                }>("bulk", { token: selection.token, values: { [fieldId]: value } });
                setMessage(
                  `${result.succeeded}/${result.count} itens processados. ${result.results
                    .filter((r) => !r.ok)
                    .map((r) => `${r.id}: ${r.error}`)
                    .join("; ")}`
                );
                if (field) await fieldsService.refresh(native.display.workspace, field.project_id);
                setSelection(null);
              } catch (failure) {
                setMessage(fieldError(failure));
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirmar alteração em {selection.count} itens
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setSelection(null)}>
            Descartar seleção global
          </Button>
        </>
      )}
      {message && (
        <p role="status" className="w-full whitespace-pre-wrap">
          {message}
        </p>
      )}
    </div>
  );
}
