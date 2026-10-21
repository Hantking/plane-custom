import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";
import { mutate as revalidateCache } from "swr";

function refreshNativeCaches(definitions = false) {
  const matches = (key: unknown) =>
    Array.isArray(key) && (key[0] === "hentis-native-batch" || (definitions && key[0] === "hentis-native-display"));
  const refresh = definitions ? revalidateCache(matches, undefined, { revalidate: true }) : revalidateCache(matches);
  return refresh.catch((error: unknown) => console.error("Falha ao atualizar as propriedades nativas", error));
}

export type FieldValue = string | boolean | string[] | null;
export type FieldValues = Record<string, FieldValue>;
export type SelectOption = { id: string; label: string; color?: string };
export type CustomField = {
  id: string;
  name: string;
  kind: "text" | "number" | "date" | "boolean" | "select" | "multiselect" | "url";
  description: string;
  required: boolean;
  active: boolean;
  position: number;
  options: SelectOption[];
};
export type FieldMeta = { fields: CustomField[]; can_manage: boolean; can_edit: boolean };
export type Condition = { id: string; field: string; operator: string; value?: FieldValue };
export type ViewConfig = {
  filters: Condition[];
  match: "all" | "any";
  group_by: string;
  order_by: string;
  layout: "table" | "list" | "kanban";
  columns: string[];
  search: string;
  priority: string;
};
export type SavedView = { id: string; name: string; shared: boolean; owner_id: string; config: ViewConfig };
export type CustomItem = {
  id: string;
  name: string;
  identifier: string;
  state: string;
  priority: string;
  custom_fields: FieldValues;
};
export type Group = { key: string; label: string; count: number; results: CustomItem[]; has_more: boolean };
export type ItemResults = { results?: CustomItem[]; groups?: Group[]; count: number; page: number; has_more?: boolean };

class FieldsService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }
  path(workspace: string, project: string) {
    return `/api/workspaces/${encodeURIComponent(workspace)}/projects/${project}/custom-fields/`;
  }
  async metadata(workspace: string, project: string): Promise<FieldMeta> {
    return (await this.get(this.path(workspace, project))).data;
  }
  async definition(workspace: string, project: string, field: Partial<CustomField>) {
    const base = this.path(workspace, project);
    const response = await (field.id ? this.patch(`${base}definitions/${field.id}/`, field) : this.post(base, field));
    void refreshNativeCaches(true);
    return response.data;
  }
  async deleteDefinition(workspace: string, project: string, id: string) {
    await this.delete(`${this.path(workspace, project)}definitions/${id}/`);
    void refreshNativeCaches(true);
  }
  async moveSelection(workspace: string, project: string, issue: string, field: string, from: string, to: string) {
    return (
      await this.patch(`${this.path(workspace, project)}issues/${issue}/`, { selection_move: { field, from, to } })
    ).data;
  }
  async values(
    workspace: string,
    project: string,
    issue: string
  ): Promise<{
    values: FieldValues;
    history: { id: number; name: string; old: FieldValue; new: FieldValue; actor: string | null; created_at: string }[];
  }> {
    return (await this.get(`${this.path(workspace, project)}issues/${issue}/`)).data;
  }
  async save(workspace: string, project: string, issue: string, values: FieldValues) {
    const response = await this.patch(`${this.path(workspace, project)}issues/${issue}/`, { values });
    await refreshNativeCaches();
    return response.data;
  }
  async batch(workspace: string, project: string, issues: string[]): Promise<Record<string, FieldValues>> {
    const chunks = Array.from({ length: Math.ceil(issues.length / 100) }, (_, i) =>
      issues.slice(i * 100, (i + 1) * 100)
    );
    const responses = await Promise.all(
      chunks.map(
        async (chunk) =>
          (await this.get(`${this.path(workspace, project)}values/`, { params: { ids: chunk.join(",") } })).data
      )
    );
    return Object.assign({}, ...responses);
  }
  async items(workspace: string, project: string, config: ViewConfig, page = 1, group?: string): Promise<ItemResults> {
    return (
      await this.get(`${this.path(workspace, project)}items/`, {
        params: { config: JSON.stringify(config), page, ...(group !== undefined ? { group_value: group } : {}) },
      })
    ).data;
  }
  async views(workspace: string, project: string): Promise<SavedView[]> {
    return (await this.get(`${this.path(workspace, project)}views/`)).data;
  }
  async saveView(workspace: string, project: string, name: string, shared: boolean, config: ViewConfig) {
    return (await this.post(`${this.path(workspace, project)}views/`, { name, shared, config })).data;
  }
  async deleteView(workspace: string, project: string, id: string) {
    await this.delete(`${this.path(workspace, project)}views/${id}/`);
  }
}
export const fieldsService = new FieldsService();
export const fieldInputClass =
  "rounded border border-subtle bg-surface-1 px-2 py-1.5 text-13 text-primary disabled:opacity-50";
export function fieldError(error: unknown): string {
  const e = error as { response?: { data?: unknown }; message?: string };
  return JSON.stringify(e?.response?.data ?? e?.message ?? "Não foi possível concluir a operação.");
}
