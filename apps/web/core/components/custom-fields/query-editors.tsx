import type { Condition, CustomField, FilterTree, SortCriterion } from "./service";
import { fieldInputClass } from "./service";
import { FieldInput } from "./inputs";

export const operatorLabels: Record<string, string> = {
  eq: "é igual",
  ne: "é diferente",
  contains: "contém",
  gt: "maior/depois",
  gte: "maior/depois ou igual",
  lt: "menor/antes",
  lte: "menor/antes ou igual",
  empty: "está vazio",
  not_empty: "está preenchido",
  contains_any: "contém alguma",
  contains_all: "contém todas",
};
export function fieldOperators(field: CustomField) {
  if (field.kind === "multiselect") return ["contains_any", "contains_all", "ne", "empty", "not_empty"];
  return [
    "eq",
    "ne",
    ...(["text", "url"].includes(field.kind) ? ["contains"] : []),
    ...(["number", "date"].includes(field.kind) ? ["gt", "gte", "lt", "lte"] : []),
    "empty",
    "not_empty",
  ];
}
const makeLeaf = (field: CustomField): Condition => ({ id: crypto.randomUUID(), field: field.id, operator: "empty" });

export function FilterTreeEditor({
  value,
  onChange,
  fields,
  depth = 0,
}: {
  value: FilterTree;
  onChange: (value: FilterTree) => void;
  fields: CustomField[];
  depth?: number;
}) {
  if ("op" in value) {
    return (
      <fieldset className="space-y-2 rounded border border-subtle p-2">
        <legend className="text-11">Grupo {depth + 1}</legend>
        <select
          aria-label={`Combinação do grupo ${depth + 1}`}
          className={fieldInputClass}
          value={value.op}
          onChange={(event) => {
            const op = event.target.value as "and" | "or" | "not";
            onChange({
              ...value,
              op,
              children: op === "not" ? [value.children[0] ?? makeLeaf(fields[0])] : value.children,
            });
          }}
          disabled={!fields.length}
        >
          <option value="and">Todas (AND)</option>
          <option value="or">Qualquer (OR)</option>
          <option value="not">Negar (NOT)</option>
        </select>
        {value.children.map((child, index) => (
          <div className="flex items-start gap-1" key={child.id}>
            <div className="min-w-0 flex-1">
              <FilterTreeEditor
                fields={fields}
                depth={depth + 1}
                value={child}
                onChange={(updated) =>
                  onChange({ ...value, children: value.children.map((node, i) => (i === index ? updated : node)) })
                }
              />
            </div>
            <button
              type="button"
              aria-label="Remover condição/grupo"
              disabled={value.op === "not" || (depth > 0 && value.children.length === 1)}
              onClick={() => onChange({ ...value, children: value.children.filter((_, i) => i !== index) })}
            >
              ×
            </button>
          </div>
        ))}
        {value.op !== "not" && (
          <div className="flex gap-2 text-11">
            <button
              type="button"
              disabled={!fields.length}
              onClick={() => onChange({ ...value, children: [...value.children, makeLeaf(fields[0])] })}
            >
              + Condição
            </button>
            <button
              type="button"
              disabled={!fields.length || depth >= 4}
              onClick={() =>
                onChange({
                  ...value,
                  children: [
                    ...value.children,
                    { id: crypto.randomUUID(), op: "and", children: [makeLeaf(fields[0])] },
                  ],
                })
              }
            >
              + Grupo
            </button>
          </div>
        )}
      </fieldset>
    );
  }
  const field = fields.find((candidate) => candidate.id === value.field);
  return (
    <div className="flex flex-wrap gap-1">
      <select
        aria-label="Campo do filtro"
        className={fieldInputClass}
        value={value.field}
        onChange={(event) => onChange({ ...value, field: event.target.value, operator: "empty", value: undefined })}
      >
        {!field && <option value={value.field}>Campo indisponível</option>}
        {fields.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name}
          </option>
        ))}
      </select>
      {field && (
        <>
          <select
            aria-label="Operador do filtro"
            className={fieldInputClass}
            value={value.operator}
            onChange={(event) => onChange({ ...value, operator: event.target.value })}
          >
            {fieldOperators(field).map((operator) => (
              <option key={operator} value={operator}>
                {operatorLabels[operator]}
              </option>
            ))}
          </select>
          {!["empty", "not_empty"].includes(value.operator) && (
            <div className="min-w-32 flex-1">
              <FieldInput
                field={field}
                value={value.value}
                immediate
                onChange={(next) => onChange({ ...value, value: next })}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

const nativeSortFields = [
  ["name", "Título"],
  ["sequence_id", "Identificador"],
  ["priority", "Prioridade"],
  ["state", "Estado"],
  ["start_date", "Início"],
  ["due_date", "Prazo"],
  ["created_at", "Criado em"],
  ["updated_at", "Atualizado em"],
];
export function MultiSortEditor({
  value,
  onChange,
  fields,
}: {
  value: SortCriterion[];
  onChange: (value: SortCriterion[]) => void;
  fields: CustomField[];
}) {
  const options = [
    ...nativeSortFields,
    ...fields.filter((field) => field.kind !== "multiselect").map((field) => [field.id, field.name]),
  ];
  const update = (index: number, patch: Partial<SortCriterion>) =>
    onChange(value.map((sort, i) => (i === index ? { ...sort, ...patch } : sort)));
  return (
    <div className="space-y-2">
      {value.map((sort, index) => (
        <div className="flex flex-wrap items-center gap-1" key={sort.field}>
          <span>{index + 1}.</span>
          <select
            aria-label="Campo de ordenação"
            className={fieldInputClass}
            value={sort.field}
            onChange={(event) => update(index, { field: event.target.value })}
          >
            {options.map(([id, label]) => (
              <option key={id} value={id} disabled={value.some((item, i) => item.field === id && i !== index)}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Direção"
            className={fieldInputClass}
            value={sort.direction}
            onChange={(event) => update(index, { direction: event.target.value as SortCriterion["direction"] })}
          >
            <option value="asc">Crescente</option>
            <option value="desc">Decrescente</option>
          </select>
          <select
            aria-label="Valores vazios"
            className={fieldInputClass}
            value={sort.nulls}
            onChange={(event) => update(index, { nulls: event.target.value as SortCriterion["nulls"] })}
          >
            <option value="last">Vazios no fim</option>
            <option value="first">Vazios no início</option>
          </select>
          <button
            type="button"
            aria-label="Aumentar precedência"
            disabled={!index}
            onClick={() => {
              const next = [...value];
              [next[index - 1], next[index]] = [next[index], next[index - 1]];
              onChange(next);
            }}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Remover ordenação"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={value.length >= 5}
        onClick={() => {
          const field = options.find(([id]) => !value.some((sort) => sort.field === id));
          if (field) onChange([...value, { field: field[0], direction: "asc", nulls: "last" }]);
        }}
      >
        + Critério
      </button>
      <p className="text-11 text-secondary">
        Critérios aplicados no servidor antes da paginação, dentro de cada grupo. Seleção única usa a ordem das opções;
        multiselect não oferece sort. Desempate final por UUID.
      </p>
    </div>
  );
}
