import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import useSWR from "swr";
import { FieldInput, displayValue } from "./inputs";
import { FieldManager } from "./manager";
import { fieldError, fieldInputClass, fieldsService } from "./service";
import type { Condition, CustomField, CustomItem, FieldValue, Group, ViewConfig } from "./service";

const initial: ViewConfig = {
  filters: [],
  match: "all",
  group_by: "",
  order_by: "-created_at",
  layout: "table",
  columns: [],
  search: "",
  priority: "",
};
const operatorNames: Record<string, string> = {
  eq: "é igual",
  ne: "é diferente",
  contains: "contém",
  gt: "maior/depois",
  gte: "maior/depois ou igual",
  lt: "menor/antes",
  lte: "menor/antes ou igual",
  empty: "está vazio",
  not_empty: "está preenchido",
};
function operators(field: CustomField) {
  return [
    "eq",
    "ne",
    ...(field.kind === "text" || field.kind === "url" ? ["contains"] : []),
    ...(field.kind === "number" || field.kind === "date" ? ["gt", "gte", "lt", "lte"] : []),
    "empty",
    "not_empty",
  ];
}

function EditableValue({
  field,
  item,
  workspace,
  project,
  disabled,
  refresh,
}: {
  field: CustomField;
  item: CustomItem;
  workspace: string;
  project: string;
  disabled: boolean;
  refresh: () => Promise<unknown>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (value: FieldValue) => {
    setError("");
    setBusy(true);
    try {
      await fieldsService.save(workspace, project, item.id, { [field.id]: value });
      await refresh();
    } catch (e) {
      setError(fieldError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <FieldInput
        field={field}
        value={item.custom_fields[field.id]}
        disabled={disabled || busy}
        onChange={(value) => void save(value)}
      />
      {error && (
        <p role="alert" className="text-red-600 text-13">
          {error}
        </p>
      )}
    </div>
  );
}

function GroupColumn({
  group,
  field,
  config,
  workspace,
  project,
  fields,
  canEdit,
  refresh,
}: {
  group: Group;
  field: CustomField;
  config: ViewConfig;
  workspace: string;
  project: string;
  fields: CustomField[];
  canEdit: boolean;
  refresh: () => Promise<unknown>;
}) {
  const [rows, setRows] = useState(group.results);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(group.has_more);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setRows(group.results);
    setPage(1);
    setHasMore(group.has_more);
  }, [group]);
  const more = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await fieldsService.items(workspace, project, config, page + 1, group.key);
      const next = result.groups?.[0];
      if (next) {
        setRows((current) => [...current, ...next.results]);
        setHasMore(next.has_more);
        setPage(page + 1);
      }
    } catch (e) {
      setError(fieldError(e));
    } finally {
      setBusy(false);
    }
  };
  const drop = async (id: string) => {
    if (!canEdit || !id) return;
    setError("");
    const value = group.key === "__empty__" ? null : field.kind === "boolean" ? group.key === "true" : group.key;
    try {
      await fieldsService.save(workspace, project, id, { [field.id]: value });
      await refresh();
    } catch (e) {
      setError(fieldError(e));
    }
  };
  return (
    <section
      className={
        config.layout === "kanban"
          ? "max-w-96 min-w-72 flex-1 rounded border border-subtle bg-layer-1 p-3"
          : "mb-4 rounded border border-subtle p-3"
      }
      onDragOver={(e) => {
        if (canEdit) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        void drop(e.dataTransfer.getData("application/x-plane-work-item"));
      }}
    >
      <h3 className="mb-3 font-medium">
        {group.label} <span className="text-secondary">({group.count})</span>
      </h3>
      <div className="space-y-2">
        {rows.map((item) => (
          <article
            key={item.id}
            draggable={canEdit && config.layout === "kanban"}
            onDragStart={(e) => e.dataTransfer.setData("application/x-plane-work-item", item.id)}
            className="rounded border border-subtle bg-surface-1 p-3"
          >
            <Link className="font-medium hover:underline" to={`/${workspace}/projects/${project}/issues/${item.id}`}>
              {item.identifier} · {item.name}
            </Link>
            <p className="mt-1 text-13 text-secondary">
              {item.state} · {item.priority}
            </p>
            {fields.map((f) => (
              <p key={f.id} className="mt-1 text-13">
                {f.name}: {displayValue(f, item.custom_fields[f.id])}
              </p>
            ))}
            {canEdit && (
              <div className="mt-2 block text-13">
                Mover para
                <FieldInput
                  field={field}
                  value={item.custom_fields[field.id]}
                  immediate
                  onChange={(value) => {
                    const key = value === null ? "__empty__" : String(value);
                    if (key !== group.key)
                      void fieldsService
                        .save(workspace, project, item.id, { [field.id]: value })
                        .then(refresh)
                        .catch((e: unknown) => setError(fieldError(e)));
                  }}
                />
              </div>
            )}
          </article>
        ))}
      </div>
      {hasMore && (
        <button className={`${fieldInputClass} mt-3`} disabled={busy} onClick={() => void more()}>
          Carregar mais deste grupo
        </button>
      )}
      {error && (
        <p role="alert" className="text-red-600 text-13">
          {error}
        </p>
      )}
    </section>
  );
}

export function CustomFieldsProjectView() {
  const params = useParams();
  const workspace = params.workspaceSlug ?? "";
  const project = params.projectId ?? "";
  const [config, setConfig] = useState<ViewConfig>(initial);
  const [page, setPage] = useState(1);
  const [viewName, setViewName] = useState("");
  const [shared, setShared] = useState(false);
  const [selectedView, setSelectedView] = useState("");
  const [error, setError] = useState("");
  const initialized = useRef(false);
  const {
    data: meta,
    error: metaError,
    mutate: refreshMeta,
  } = useSWR(["hentis-fields", workspace, project], () => fieldsService.metadata(workspace, project));
  const { data: views, mutate: refreshViews } = useSWR(["hentis-views", workspace, project], () =>
    fieldsService.views(workspace, project)
  );
  const {
    data,
    error: itemsError,
    mutate: refreshItems,
    isLoading,
  } = useSWR(
    meta ? ["hentis-items", workspace, project, JSON.stringify(config), page] : null,
    () => fieldsService.items(workspace, project, config, page),
    { keepPreviousData: false }
  );
  const fields = meta?.fields.filter((field) => field.active) ?? [];
  const visible = fields.filter((field) => config.columns.includes(field.id));
  const groupedField = fields.find((field) => field.id === config.group_by);
  useEffect(() => {
    initialized.current = false;
    setConfig(initial);
    setPage(1);
    setSelectedView("");
  }, [workspace, project]);
  useEffect(() => {
    if (meta && !initialized.current) {
      initialized.current = true;
      setConfig((value) => ({ ...value, columns: meta.fields.filter((f) => f.active).map((f) => f.id) }));
    }
  }, [meta]);
  const update = (next: Partial<ViewConfig>) => {
    setPage(1);
    setConfig((current) => ({ ...current, ...next }));
    setError("");
  };
  const condition = (index: number, next: Partial<Condition>) =>
    update({ filters: config.filters.map((item, i) => (i === index ? { ...item, ...next } : item)) });
  const saveView = async () => {
    setError("");
    try {
      await fieldsService.saveView(workspace, project, viewName, shared, config);
      setViewName("");
      await refreshViews();
    } catch (e) {
      setError(fieldError(e));
    }
  };
  if (metaError)
    return (
      <p role="alert" className="p-6">
        Não foi possível acessar os campos deste projeto: {fieldError(metaError)}
      </p>
    );
  return (
    <main className="h-full overflow-auto p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Campos e visualizações</h1>
        <Link className="text-accent-primary" to={`/${workspace}/projects/${project}/issues/`}>
          Voltar às tarefas
        </Link>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <select
          aria-label="Visualização salva"
          className={fieldInputClass}
          value={selectedView}
          onChange={(e) => {
            setSelectedView(e.target.value);
            const view = views?.find((v) => v.id === e.target.value);
            update(view ? { ...initial, ...view.config } : initial);
          }}
        >
          <option value="">Visualização atual</option>
          {views?.map((view) => (
            <option value={view.id} key={view.id}>
              {view.name}
              {view.shared ? " · compartilhada" : " · privada"}
            </option>
          ))}
        </select>
        <select
          aria-label="Layout"
          className={fieldInputClass}
          value={config.layout}
          onChange={(e) => update({ layout: e.target.value as ViewConfig["layout"] })}
        >
          <option value="table">Tabela</option>
          <option value="list">Lista</option>
          <option value="kanban">Kanban</option>
        </select>
        <input
          aria-label="Buscar tarefa"
          placeholder="Buscar tarefa"
          className={fieldInputClass}
          value={config.search}
          onChange={(e) => update({ search: e.target.value })}
        />
        <select
          aria-label="Prioridade"
          className={fieldInputClass}
          value={config.priority}
          onChange={(e) => update({ priority: e.target.value })}
        >
          <option value="">Todas as prioridades</option>
          {["urgent", "high", "medium", "low", "none"].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          aria-label="Agrupar por"
          className={fieldInputClass}
          value={config.group_by}
          onChange={(e) => update({ group_by: e.target.value })}
        >
          <option value="">Sem agrupamento</option>
          {fields
            .filter((field) => field.kind === "select" || field.kind === "boolean")
            .map((field) => (
              <option key={field.id} value={field.id}>
                Agrupar por {field.name}
              </option>
            ))}
        </select>
        <select
          aria-label="Ordenar por"
          className={fieldInputClass}
          value={config.order_by}
          onChange={(e) => update({ order_by: e.target.value })}
        >
          <option value="-created_at">Mais recentes</option>
          <option value="created_at">Mais antigas</option>
          <option value="name">Título A–Z</option>
          {fields.flatMap((field) => [
            <option key={field.id} value={field.id}>
              {field.name} ↑
            </option>,
            <option key={`-${field.id}`} value={`-${field.id}`}>
              {field.name} ↓
            </option>,
          ])}
        </select>
      </div>
      <section className="mb-4 rounded border border-subtle p-3">
        <div className="mb-2 flex items-center gap-3">
          <h2 className="font-medium">Filtros</h2>
          <select
            aria-label="Combinar condições"
            className={fieldInputClass}
            value={config.match}
            onChange={(e) => update({ match: e.target.value as "all" | "any" })}
          >
            <option value="all">Todas as condições (E)</option>
            <option value="any">Qualquer condição (OU)</option>
          </select>
        </div>
        {config.filters.map((item, index) => {
          const field = fields.find((f) => f.id === item.field);
          return (
            <div key={item.id} className="mb-2 flex flex-wrap gap-2">
              <select
                aria-label="Campo do filtro"
                className={fieldInputClass}
                value={item.field}
                onChange={(e) => condition(index, { field: e.target.value, operator: "eq", value: null })}
              >
                {fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Operador"
                className={fieldInputClass}
                value={item.operator}
                onChange={(e) => condition(index, { operator: e.target.value })}
              >
                {field &&
                  operators(field).map((op) => (
                    <option key={op} value={op}>
                      {operatorNames[op]}
                    </option>
                  ))}
              </select>
              {field && !["empty", "not_empty"].includes(item.operator) && (
                <div className="w-60">
                  <FieldInput
                    field={field}
                    value={item.value}
                    immediate
                    onChange={(value) => condition(index, { value })}
                  />
                </div>
              )}
              <button onClick={() => update({ filters: config.filters.filter((_, i) => i !== index) })}>
                Remover filtro
              </button>
            </div>
          );
        })}
        <button
          disabled={!fields.length || config.filters.length >= 30}
          onClick={() =>
            update({
              filters: [...config.filters, { id: crypto.randomUUID(), field: fields[0].id, operator: "not_empty" }],
            })
          }
        >
          + Adicionar filtro
        </button>
        <button className="ml-4" onClick={() => update({ filters: [], search: "", priority: "" })}>
          Limpar filtros
        </button>
      </section>
      <details className="mb-4">
        <summary className="cursor-pointer text-13">Colunas e propriedades dos cartões</summary>
        <div className="mt-2 flex flex-wrap gap-3">
          {fields.map((field) => (
            <label className="text-13" key={field.id}>
              <input
                type="checkbox"
                checked={config.columns.includes(field.id)}
                onChange={(e) =>
                  update({
                    columns: e.target.checked
                      ? [...config.columns, field.id]
                      : config.columns.filter((id) => id !== field.id),
                  })
                }
              />{" "}
              {field.name}
            </label>
          ))}
        </div>
      </details>
      {meta?.can_edit && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            aria-label="Nome da visualização"
            className={fieldInputClass}
            maxLength={100}
            placeholder="Nome da nova visualização"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
          />
          <label className="text-13">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Compartilhar com o
            projeto
          </label>
          <button disabled={!viewName.trim()} className={fieldInputClass} onClick={() => void saveView()}>
            Salvar visualização
          </button>
          {selectedView && (
            <button
              onClick={() =>
                void fieldsService
                  .deleteView(workspace, project, selectedView)
                  .then(async () => {
                    setSelectedView("");
                    return refreshViews();
                  })
                  .catch((e: unknown) => setError(fieldError(e)))
              }
            >
              Excluir visualização
            </button>
          )}
        </div>
      )}
      {(error || itemsError) && (
        <p role="alert" className="text-red-600 mb-3">
          {error || fieldError(itemsError)}
        </p>
      )}
      <p className="mb-2 text-13 text-secondary">{isLoading ? "Carregando…" : `${data?.count ?? 0} tarefas`}</p>
      {config.layout === "kanban" && !groupedField ? (
        <p className="p-4">Escolha um campo de seleção ou sim/não em “Agrupar por” para montar o Kanban.</p>
      ) : groupedField && data?.groups ? (
        <div className={config.layout === "kanban" ? "flex items-start gap-4 overflow-x-auto pb-4" : "space-y-4"}>
          {data.groups.map((group) => (
            <GroupColumn
              key={`${JSON.stringify(config)}-${group.key}`}
              group={group}
              field={groupedField}
              config={config}
              workspace={workspace}
              project={project}
              fields={visible}
              canEdit={!!meta?.can_edit}
              refresh={refreshItems}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-auto">
          {config.layout === "list" && (
            <div className="space-y-3">
              {data?.results?.map((item) => (
                <article key={item.id} className="rounded border border-subtle p-3">
                  <Link
                    className="font-medium hover:underline"
                    to={`/${workspace}/projects/${project}/issues/${item.id}`}
                  >
                    {item.identifier} · {item.name}
                  </Link>
                  <p className="my-2 text-13 text-secondary">
                    {item.state} · {item.priority}
                  </p>
                  <div className="flex flex-wrap gap-4">
                    {visible.map((field) => (
                      <div className="min-w-48 text-13" key={field.id}>
                        <p>{field.name}</p>
                        <EditableValue
                          field={field}
                          item={item}
                          workspace={workspace}
                          project={project}
                          disabled={!meta?.can_edit}
                          refresh={refreshItems}
                        />
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
          {config.layout !== "list" && (
            <table className="w-full border-collapse text-left text-13">
              <thead>
                <tr>
                  <th className="min-w-64 border-b border-subtle p-2">Tarefa</th>
                  <th className="border-b border-subtle p-2">Estado</th>
                  {visible.map((field) => (
                    <th className="min-w-48 border-b border-subtle p-2" key={field.id}>
                      {field.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.results?.map((item) => (
                  <tr key={item.id}>
                    <td className="border-b border-subtle p-2">
                      <Link className="hover:underline" to={`/${workspace}/projects/${project}/issues/${item.id}`}>
                        {item.identifier} · {item.name}
                      </Link>
                    </td>
                    <td className="border-b border-subtle p-2">{item.state}</td>
                    {visible.map((field) => (
                      <td className="border-b border-subtle p-2" key={field.id}>
                        <EditableValue
                          field={field}
                          item={item}
                          workspace={workspace}
                          project={project}
                          disabled={!meta?.can_edit}
                          refresh={refreshItems}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="my-3 flex items-center gap-3">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Anterior
            </button>
            <span>Página {page}</span>
            <button disabled={!data?.has_more} onClick={() => setPage(page + 1)}>
              Próxima
            </button>
          </div>
        </div>
      )}
      {meta?.can_manage && (
        <div className="mt-6">
          <FieldManager workspace={workspace} project={project} fields={meta.fields} refresh={refreshMeta} />
        </div>
      )}
    </main>
  );
}
