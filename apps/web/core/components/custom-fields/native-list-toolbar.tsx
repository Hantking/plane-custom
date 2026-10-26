import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowDownWideNarrow,
  Bookmark,
  Columns3,
  Filter,
  Group,
  Layers2,
  Plus,
  Search,
  Settings2,
} from "lucide-react";
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
import { NativeListToolbarPortal, NativeListToolbarPopover } from "./native-list-toolbar-slot";

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
    <NativeListToolbarPortal>
      <div data-native-list-toolbar className="flex min-w-0 flex-wrap items-center gap-0.5 text-12">
        <span
          title="Total de tarefas únicas no resultado"
          className="mr-1 hidden shrink-0 rounded-md bg-layer-2 px-2 py-1 text-11 font-medium text-secondary sm:inline"
        >
          {summary?.count ?? "…"}
          <span className="hidden @6xl:inline"> tarefas</span>
        </span>
        <NativeListToolbarPopover title="Exportar CSV" icon={<ArrowDownToLine className="size-3.5" />}>
          <p className="text-12 text-secondary">Exporte as tarefas do resultado atual.</p>
          <div className="flex flex-col items-stretch gap-2">
            <Button variant="secondary" disabled={list.busy} onClick={() => void list.exportCSV("presentation")}>
              Campos visíveis
            </Button>
            <Button variant="secondary" disabled={list.busy} onClick={() => void list.exportCSV("all")}>
              Todos os campos
            </Button>
          </div>
        </NativeListToolbarPopover>
        <NativeListToolbarPopover
          title="Agrupar"
          icon={<Group className="size-3.5" />}
          active={!!list.query.group_by || (!!list.query.native_group && list.query.native_group !== "inherit")}
        >
          <label className="flex flex-col gap-2 text-12 font-medium">
            Agrupar tarefas por
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
              <option value="inherit">Padrão da visualização</option>
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
        </NativeListToolbarPopover>
        <NativeListToolbarPopover
          title={`Ordenar${list.query.sorts?.length ? ` (${list.query.sorts.length})` : ""}`}
          icon={<ArrowDownWideNarrow className="size-3.5" />}
          active={!!list.query.sorts?.length}
          wide
        >
          <div className="space-y-3">
            <MultiSortEditor
              value={draft.sorts ?? []}
              fields={fields}
              onChange={(sorts) => setDraft({ ...draft, sorts })}
            />
            <div className="flex flex-wrap gap-2">
              <Button disabled={list.busy} onClick={() => void apply({ sorts: draft.sorts, manual: false })}>
                Aplicar ordem
              </Button>
              <Button variant="secondary" disabled={list.busy} onClick={() => void apply({ sorts: [], manual: true })}>
                Ordem manual pessoal
              </Button>
            </div>
            <p className="text-11 text-secondary">A ordem manual é pessoal e independente por visualização e grupo.</p>
          </div>
        </NativeListToolbarPopover>
        <NativeListToolbarPopover
          title="Filtrar campos"
          icon={<Filter className="size-3.5" />}
          active={
            !!list.query.filters?.length ||
            (!!list.query.filter_tree &&
              ("op" in list.query.filter_tree ? !!list.query.filter_tree.children.length : true))
          }
          wide
          showLabel
        >
          <div className="space-y-3">
            <p className="text-12 text-secondary">
              Combine campos personalizados com os filtros nativos da visualização.
            </p>
            <FilterTreeEditor
              fields={fields}
              value={draft.filter_tree!}
              onChange={(filter_tree) => setDraft({ ...draft, filter_tree })}
            />
            <div className="flex flex-wrap gap-2">
              <Button disabled={list.busy} onClick={() => void apply({ filter_tree: draft.filter_tree })}>
                Aplicar filtros
              </Button>
              <Button
                variant="secondary"
                disabled={list.busy}
                onClick={() => void apply({ filter_tree: { op: "and", children: [] }, filters: [], search: "" })}
              >
                Limpar filtros
              </Button>
            </div>
          </div>
        </NativeListToolbarPopover>
        <NativeListToolbarPopover
          title="Subtarefas"
          icon={<Layers2 className="size-3.5" />}
          active={list.query.subtasks !== "collapsed" && !!list.query.subtasks}
        >
          <label className="flex flex-col gap-2 text-12 font-medium">
            Exibir subtarefas
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
          <p className="text-12 text-secondary">
            Expandidas aparecem junto à tarefa principal. Separadas entram individualmente nos filtros, totais e
            exportações.
          </p>
        </NativeListToolbarPopover>
        <NativeListToolbarPopover title="Campos" icon={<Columns3 className="size-3.5" />}>
          <label className="flex items-center gap-2 text-12">
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
          {project && (
            <a
              className="block border-t border-subtle pt-3 text-12 text-accent-primary hover:underline"
              href={`/${native.display.workspace}/projects/${project}/custom-fields/`}
            >
              Gerenciar campos e visualizações do projeto
            </a>
          )}
        </NativeListToolbarPopover>
        <NativeListToolbarPopover
          title="Buscar na Lista"
          searchTrigger
          icon={<Search className="size-3.5" />}
          active={!!list.query.search}
        >
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void apply({ search });
            }}
          >
            <label className="space-y-2 text-12">
              <span>ID, título, descrição ou campos visíveis</span>
              <input
                data-native-list-search
                aria-label="Buscar na Lista"
                className={fieldInputClass}
                value={search}
                maxLength={255}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar tarefas…"
              />
            </label>
            <Button type="submit" disabled={list.busy}>
              Buscar
            </Button>
          </form>
        </NativeListToolbarPopover>
        <NativeListToolbarPopover title="Personalizar" icon={<Settings2 className="size-3.5" />} showLabel>
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-12">
              <input
                type="checkbox"
                checked={!!list.query.search_hidden}
                onChange={(event) => void apply({ search_hidden: event.target.checked })}
              />
              Incluir campos textuais ocultos na busca
            </label>
            <h3 className="border-t border-subtle pt-3 font-medium">Cálculos do resultado</h3>
            <select
              aria-label="Campo de cálculo"
              className={fieldInputClass}
              value={calculationField}
              onChange={(event) => setCalculationField(event.target.value)}
            >
              <option value="">Selecione um campo</option>
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
              <div
                key={`${calculation.field}:${calculation.operation}`}
                className="flex items-center justify-between gap-2 text-12"
              >
                {fields.find((f) => f.id === calculation.field)?.name} · {calculation.operation}
                <button
                  type="button"
                  aria-label="Remover cálculo"
                  onClick={() => void apply({ calculations: list.query.calculations?.filter((_, i) => i !== index) })}
                >
                  ×
                </button>
              </div>
            ))}
            {!!summary?.calculations.length && (
              <div className="space-y-1 border-t border-subtle pt-3" aria-label="Cálculos da Lista">
                {summary.calculations.map((item) => (
                  <p key={`${item.field}:${item.operation}`}>
                    {fields.find((f) => f.id === item.field)?.name} · {item.operation}:{" "}
                    <strong>{item.value ?? "—"}</strong>
                  </p>
                ))}
              </div>
            )}
          </div>
        </NativeListToolbarPopover>
        {project && (
          <NativeListToolbarPopover
            title={selected?.name ?? "Presets"}
            icon={<Bookmark className="size-3.5" />}
            active={!!selected}
            showLabel
          >
            <div className="flex flex-col gap-3 text-12">
              <label className="space-y-2">
                <span className="font-medium">Preset de consulta</span>
                <select
                  aria-label="Preset de filtros e ordenação"
                  className={fieldInputClass}
                  value={list.query.view_id ?? ""}
                  disabled={list.busy}
                  onChange={(event) => void chooseView(event.target.value)}
                >
                  <option value="">Minha configuração</option>
                  {views.data?.map((view) => (
                    <option key={view.id} value={view.id}>
                      {view.name}
                      {view.shared ? " · compartilhado" : " · privado"}
                      {view.locked ? " · bloqueado" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {selected && (
                <div className="flex flex-wrap gap-2">
                  {canUpdate && (
                    <Button
                      variant="secondary"
                      disabled={list.busy}
                      onClick={() => void updateView({ config: presetConfig() })}
                    >
                      Atualizar preset
                    </Button>
                  )}
                  {canManage && (
                    <Button
                      variant="secondary"
                      disabled={list.busy}
                      onClick={() => void updateView({ locked: !selected.locked })}
                    >
                      {selected.locked ? "Desbloquear" : "Bloquear"}
                    </Button>
                  )}
                  {canUpdate && (
                    <Button
                      variant="secondary"
                      disabled={list.busy}
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
                </div>
              )}
              <div className="space-y-3 border-t border-subtle pt-3">
                <label className="block space-y-2">
                  <span className="font-medium">Salvar como novo preset</span>
                  <input
                    aria-label="Nome da View"
                    className={fieldInputClass}
                    value={viewName}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={100}
                    placeholder="Nome do preset"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} />
                  Compartilhar com o projeto
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
                  Salvar preset
                </Button>
              </div>
              <p className="text-11 leading-relaxed text-secondary">
                Presets salvam filtros, ordenação e campos visíveis. A posição e a largura das colunas e a ordem manual
                continuam pessoais.
              </p>
            </div>
          </NativeListToolbarPopover>
        )}
        <div className="ml-1 border-l border-subtle pl-1">
          {!props.disableIssueCreation && !props.isCompletedCycle && (
            <Button size="sm" title="Nova tarefa" aria-label="Nova tarefa" onClick={() => setCreate(true)}>
              <Plus className="size-3.5" />
              <span className="hidden @6xl:inline">Nova tarefa</span>
            </Button>
          )}
        </div>
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
    </NativeListToolbarPortal>
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
