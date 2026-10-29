import { useState } from "react";
import type { CustomField } from "./service";
import { fieldError, fieldInputClass, fieldsService } from "./service";
import { OptionBadge } from "./inputs";
import { optionBackground, OPTION_PALETTE } from "./option-colors";
import { isSelectionKind } from "./selection-values";

const blank = (): Partial<CustomField> => ({
  name: "",
  description: "",
  kind: "text",
  required: false,
  active: true,
  options: [],
  position: 0,
});
const labels: Record<CustomField["kind"], string> = {
  text: "Texto",
  long_text: "Texto longo",
  phone: "Telefone",
  site: "Site",
  number: "Número",
  date: "Data",
  datetime: "Data e hora",
  boolean: "Sim/não",
  select: "Seleção única",
  multiselect: "Seleção múltipla",
  url: "Link",
};

export function FieldManager({
  workspace,
  project,
  fields,
  refresh,
}: {
  workspace: string;
  project: string;
  fields: CustomField[];
  refresh: () => Promise<unknown>;
}) {
  const [form, setForm] = useState<Partial<CustomField>>(blank);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const remove = async (field: CustomField) => {
    if (
      !window.confirm(
        `Excluir definitivamente o campo “${field.name}”? Os valores e o histórico desse campo serão removidos das tarefas. Essa ação não pode ser desfeita. Para preservar os dados, use Arquivar.`
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await fieldsService.deleteDefinition(workspace, project, field.id);
      await refresh();
      if (form.id === field.id) setForm(blank());
    } catch (e) {
      setError(fieldError(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async (data: Partial<CustomField>) => {
    setBusy(true);
    setError("");
    try {
      await fieldsService.definition(workspace, project, data);
      await refresh();
      setForm(blank());
    } catch (e) {
      setError(fieldError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details data-custom-field-manager className="min-w-0 rounded border border-subtle p-3">
      <summary className="min-h-11 cursor-pointer py-2 font-medium sm:min-h-0 sm:py-0">
        Gerenciar campos do projeto
      </summary>
      <p className="my-2 text-13 text-secondary">
        Arquivar preserva os dados; excluir remove o campo e seus valores. Ao trocar o tipo, valores compatíveis são
        convertidos. Se algum valor não puder ser convertido, a alteração é cancelada sem apagar os dados. Visualizações
        salvas são ajustadas; filtros incompatíveis são removidos.
      </p>
      <div className="space-y-2">
        {fields.map((field) => (
          <div
            key={field.id}
            className="flex min-w-0 flex-wrap items-center gap-2 border-b border-subtle py-2 text-13 sm:gap-3"
          >
            <span className="w-full min-w-0 break-words sm:w-auto sm:flex-1">
              {field.name} · {labels[field.kind]} {field.active ? "" : "(arquivado)"}
            </span>
            <button
              className="min-h-11 rounded px-2 text-accent-primary sm:min-h-8"
              disabled={busy}
              onClick={() => setForm({ ...field, options: field.options.map((o) => ({ ...o })) })}
            >
              Editar
            </button>
            <button
              className="min-h-11 rounded px-2 sm:min-h-8"
              disabled={busy}
              onClick={() => void save({ id: field.id, active: !field.active })}
            >
              {field.active ? "Arquivar" : "Reativar"}
            </button>
            <button
              disabled={busy}
              className="text-red-600 min-h-11 rounded px-2 sm:min-h-8"
              onClick={() => void remove(field)}
            >
              Excluir
            </button>
          </div>
        ))}
      </div>
      <form
        className="mt-4 flex w-full max-w-2xl min-w-0 flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save(form);
        }}
      >
        <h3 className="font-semibold">{form.id ? "Editar campo" : "Novo campo"}</h3>
        <label className="flex min-w-0 flex-col gap-1 text-13">
          Nome
          <input
            className={`${fieldInputClass} min-h-11 w-full min-w-0 sm:min-h-8`}
            required
            maxLength={100}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-13">
          Tipo
          <select
            disabled={busy}
            className={`${fieldInputClass} min-h-11 w-full min-w-0 sm:min-h-8`}
            value={form.kind}
            onChange={(e) => {
              const kind = e.target.value as CustomField["kind"];
              setForm({ ...form, kind, options: isSelectionKind(kind) ? (form.options ?? []) : [] });
            }}
          >
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-13">
          Descrição
          <input
            className={`${fieldInputClass} min-h-11 w-full min-w-0 sm:min-h-8`}
            maxLength={500}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-13 sm:min-h-8">
          <input
            type="checkbox"
            checked={form.required}
            onChange={(e) => setForm({ ...form, required: e.target.checked })}
          />{" "}
          Obrigatório
        </label>
        {form.kind && isSelectionKind(form.kind) && (
          <div className="space-y-2">
            <h4 className="text-13">Opções (máximo 50)</h4>
            <p className="text-13 text-secondary">
              Escolha a cor de fundo da caixa de cada opção. A cor do texto é ajustada automaticamente para manter a
              leitura.
            </p>
            {form.options?.map((option) => (
              <div
                className="flex min-w-0 flex-wrap items-center gap-2 rounded border border-subtle p-2"
                key={option.id}
              >
                <input
                  aria-label="Nome da opção"
                  className={`${fieldInputClass} min-h-11 w-full min-w-0 sm:min-h-8 sm:w-auto sm:flex-1`}
                  value={option.label}
                  required
                  maxLength={100}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      options: form.options?.map((o) => (o.id === option.id ? { ...o, label: e.target.value } : o)),
                    })
                  }
                />
                <label className="flex items-center gap-2 text-13">
                  Cor de fundo
                  <input
                    type="color"
                    className="h-11 w-11 cursor-pointer rounded border border-subtle sm:h-8 sm:w-10"
                    aria-label={`Cor de fundo de ${option.label || "nova opção"}`}
                    value={optionBackground(option)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        options: form.options?.map((item) =>
                          item.id === option.id ? { ...item, color: e.target.value } : item
                        ),
                      })
                    }
                  />
                </label>
                <OptionBadge option={{ ...option, label: option.label || "Prévia" }} />
                <button
                  type="button"
                  className="min-h-11 rounded px-2 sm:min-h-8"
                  onClick={() => setForm({ ...form, options: form.options?.filter((o) => o.id !== option.id) })}
                >
                  Remover
                </button>
              </div>
            ))}
            <button
              type="button"
              className="min-h-11 rounded px-2 sm:min-h-8"
              disabled={(form.options?.length ?? 0) >= 50}
              onClick={() =>
                setForm({
                  ...form,
                  options: [
                    ...(form.options ?? []),
                    {
                      id: crypto.randomUUID(),
                      label: "",
                      color: OPTION_PALETTE[(form.options?.length ?? 0) % OPTION_PALETTE.length],
                    },
                  ],
                })
              }
            >
              + Adicionar opção
            </button>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <button className={fieldInputClass} disabled={busy} type="submit">
            {busy ? "Salvando…" : "Salvar campo"}
          </button>
          {form.id && (
            <button type="button" onClick={() => setForm(blank())}>
              Cancelar edição
            </button>
          )}
        </div>
      </form>
      {error && (
        <p role="alert" className="text-red-600 mt-2 text-13">
          {error}
        </p>
      )}
    </details>
  );
}
