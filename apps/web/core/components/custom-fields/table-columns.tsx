import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { FieldInput } from "./inputs";
import { fieldError, fieldsService } from "./service";
import type { CustomField, FieldValue, FieldValues } from "./service";

type Context = {
  workspace: string;
  project: string;
  fields: CustomField[];
  values: Record<string, FieldValues>;
  refresh: () => Promise<unknown>;
  ready: boolean;
  canEdit: boolean;
};
const FieldsContext = createContext<Context | null>(null);

export function CustomTableProvider({ issueIds, children }: { issueIds: string[]; children: ReactNode }) {
  const params = useParams();
  const workspace = params.workspaceSlug?.toString() ?? "";
  const project = params.projectId?.toString() ?? "";
  const ids = useMemo(() => [...new Set(issueIds)], [issueIds]);
  const { data: meta } = useSWR(project ? ["hentis-fields", workspace, project] : null, () =>
    fieldsService.metadata(workspace, project)
  );
  const { data: values, mutate } = useSWR(
    project && ids.length ? ["hentis-batch", workspace, project, ids.join(",")] : null,
    () => fieldsService.batch(workspace, project, ids)
  );
  const context = useMemo(
    () => ({
      workspace,
      project,
      fields: meta?.fields.filter((f) => f.active) ?? [],
      values: values ?? {},
      refresh: mutate,
      ready: !!values,
      canEdit: !!meta?.can_edit,
    }),
    [workspace, project, meta, values, mutate]
  );
  return <FieldsContext.Provider value={context}>{children}</FieldsContext.Provider>;
}

export function CustomTableHeaders() {
  const context = useContext(FieldsContext);
  return (
    <>
      {context?.fields.map((field) => (
        <th
          key={field.id}
          className="min-w-44 border-r border-subtle bg-layer-1 px-2 py-2 text-left text-13 font-medium"
        >
          {field.name}
        </th>
      ))}
    </>
  );
}

export function CustomTableCells({ issueId, disabled }: { issueId: string; disabled: boolean }) {
  const context = useContext(FieldsContext);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  if (!context) return null;
  const save = async (field: string, value: FieldValue) => {
    setSaving(true);
    setError("");
    try {
      await fieldsService.save(context.workspace, context.project, issueId, { [field]: value });
      await context.refresh();
    } catch (e) {
      setError(fieldError(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      {context.fields.map((field, i) => (
        <td
          key={field.id}
          className="min-w-44 border-r border-subtle px-2 text-13"
          onClick={(e) => e.stopPropagation()}
        >
          <FieldInput
            field={field}
            value={context.values[issueId]?.[field.id]}
            disabled={disabled || !context.canEdit || !context.ready || saving}
            onChange={(value) => void save(field.id, value)}
          />
          {i === 0 && error && (
            <span role="alert" className="text-red-600">
              {error}
            </span>
          )}
        </td>
      ))}
    </>
  );
}
