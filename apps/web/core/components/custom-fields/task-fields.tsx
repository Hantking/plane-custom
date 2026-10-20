import { useState } from "react";
import useSWR from "swr";
import type { Control } from "react-hook-form";
import { Controller } from "react-hook-form";
import type { TIssue } from "@plane/types";
import { FieldInput } from "./inputs";
import { fieldError, fieldsService } from "./service";
import type { FieldValues } from "./service";

export function TaskCustomFields({
  workspaceSlug,
  projectId,
  issueId,
  disabled,
}: {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled: boolean;
}) {
  const { data: meta } = useSWR(["hentis-fields", workspaceSlug, projectId], () =>
    fieldsService.metadata(workspaceSlug, projectId)
  );
  const { data, mutate } = useSWR(["hentis-values", workspaceSlug, projectId, issueId], () =>
    fieldsService.values(workspaceSlug, projectId, issueId)
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fields = meta?.fields.filter((f) => f.active) ?? [];
  if (!fields.length) return null;
  const save = async (id: string, value: string | boolean | null) => {
    setSaving(true);
    setError("");
    try {
      await fieldsService.save(workspaceSlug, projectId, issueId, { [id]: value });
      await mutate();
    } catch (e) {
      setError(fieldError(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="mt-5 space-y-3 border-t border-subtle pt-4">
      <h3 className="text-13 font-semibold">Campos personalizados</h3>
      {fields.map((field) => (
        <label key={field.id} className="block space-y-1 text-13">
          <span>
            {field.name}
            {field.required ? " *" : ""}
          </span>
          <FieldInput
            field={field}
            value={data?.values[field.id]}
            disabled={disabled || !meta?.can_edit || !data || saving}
            onChange={(value) => void save(field.id, value)}
          />
        </label>
      ))}
      {error && (
        <p role="alert" className="text-red-600 text-13">
          {error}
        </p>
      )}
      <details className="text-13">
        <summary>Histórico dos campos</summary>
        {data?.history.map((change) => (
          <p key={change.id} className="py-1">
            {change.name}: {JSON.stringify(change.old)} → {JSON.stringify(change.new)} ·{" "}
            {change.actor ?? "Usuário removido"} · {new Date(change.created_at).toLocaleString()}
          </p>
        ))}
      </details>
    </section>
  );
}

function FieldsFormContent({
  workspace,
  project,
  issue,
  value,
  onChange,
}: {
  workspace: string;
  project: string;
  issue?: string;
  value: FieldValues | undefined;
  onChange: (value: FieldValues) => void;
}) {
  const { data: meta, error } = useSWR(["hentis-fields", workspace, project], () =>
    fieldsService.metadata(workspace, project)
  );
  const { data: existing } = useSWR(issue ? ["hentis-values", workspace, project, issue] : null, () =>
    fieldsService.values(workspace, project, issue!)
  );
  const current = { ...existing?.values, ...value };
  return (
    <div className="mt-3 w-full space-y-2">
      {meta?.fields
        .filter((field) => field.active)
        .map((field) => (
          <label key={field.id} className="block text-13">
            <span>
              {field.name}
              {field.required ? " *" : ""}
            </span>
            <FieldInput
              field={field}
              value={current[field.id]}
              immediate
              onChange={(next) => onChange({ ...value, [field.id]: next })}
            />
          </label>
        ))}
      {error && (
        <p role="alert" className="text-red-600">
          Não foi possível carregar os campos personalizados.
        </p>
      )}
    </div>
  );
}

export function CustomFieldsForm({
  control,
  workspace,
  project,
  issue,
}: {
  control: Control<TIssue>;
  workspace: string;
  project: string;
  issue?: string;
}) {
  return (
    <Controller
      name="custom_fields"
      control={control}
      render={({ field }) => (
        <FieldsFormContent
          workspace={workspace}
          project={project}
          issue={issue}
          value={field.value}
          onChange={field.onChange}
        />
      )}
    />
  );
}
