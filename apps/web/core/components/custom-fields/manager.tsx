import { useState } from "react";
import type { CustomField } from "./service";
import { fieldError, fieldInputClass, fieldsService } from "./service";
import { OptionBadge } from "./inputs";
import { optionBackground, OPTION_PALETTE } from "./option-colors";

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
  number: "Número",
  date: "Data",
  boolean: "Sim/não",
  select: "Seleção única",
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
    <details className="rounded border border-subtle p-3">
      <summary className="cursor-pointer font-medium">Gerenciar campos do projeto</summary>
      <p className="my-2 text-13 text-secondary">
        Arquivar preserva os dados. Campos obrigatórios são exigidos nas novas tarefas; o tipo não pode ser trocado
        depois de criado.
      </p>
      <div className="space-y-2">
        {fields.map((field) => (
          <div key={field.id} className="flex flex-wrap items-center gap-3 text-13">
            <span>
              {field.name} · {labels[field.kind]} {field.active ? "" : "(arquivado)"}
            </span>
            <button
              className="text-accent-primary"
              onClick={() => setForm({ ...field, options: field.options.map((o) => ({ ...o })) })}
            >
              Editar
            </button>
            <button disabled={busy} onClick={() => void save({ id: field.id, active: !field.active })}>
              {field.active ? "Arquivar" : "Reativar"}
            </button>
          </div>
        ))}
      </div>
      <form
        className="mt-4 flex max-w-2xl flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save(form);
        }}
      >
        <h3 className="font-semibold">{form.id ? "Editar campo" : "Novo campo"}</h3>
        <label className="text-13">
          Nome
          <input
            className={`${fieldInputClass} ml-2`}
            required
            maxLength={100}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label className="text-13">
          Tipo
          <select
            disabled={!!form.id}
            className={`${fieldInputClass} ml-2`}
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as CustomField["kind"], options: [] })}
          >
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-13">
          Descrição
          <input
            className={`${fieldInputClass} ml-2`}
            maxLength={500}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <label className="text-13">
          <input
            type="checkbox"
            checked={form.required}
            onChange={(e) => setForm({ ...form, required: e.target.checked })}
          />{" "}
          Obrigatório
        </label>
        {form.kind === "select" && (
          <div className="space-y-2">
            <h4 className="text-13">Opções (máximo 50)</h4>
            <p className="text-13 text-secondary">
              Escolha a cor de fundo da caixa de cada opção. A cor do texto é ajustada automaticamente para manter a
              leitura.
            </p>
            {form.options?.map((option) => (
              <div className="flex flex-wrap items-center gap-2" key={option.id}>
                <input
                  aria-label="Nome da opção"
                  className={fieldInputClass}
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
                    className="h-8 w-10 cursor-pointer rounded border border-subtle"
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
                  onClick={() => setForm({ ...form, options: form.options?.filter((o) => o.id !== option.id) })}
                >
                  Remover
                </button>
              </div>
            ))}
            <button
              type="button"
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
        <div className="flex gap-3">
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
