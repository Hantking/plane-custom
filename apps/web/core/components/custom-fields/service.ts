import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";
import { mutate as revalidateCache } from "swr";

async function refreshNativeCaches(
  workspace: string,
  project: string,
  definitions = false,
  issue?: string,
  error?: string
) {
  const matches = (key: unknown) => {
    if (!Array.isArray(key)) return false;
    if (key[0] === "hentis-native-display") return key[2] === workspace;
    if (["hentis-native-batch", "hentis-native-summary"].includes(key[0]))
      return typeof key[1] === "string" && key[1].split("/")[2] === workspace;
    return (
      ["hentis-fields", "hentis-values", "hentis-items", "hentis-views"].includes(key[0]) &&
      key[1] === workspace &&
      key[2] === project
    );
  };
  const refresh = revalidateCache(matches);
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent("hentis-fields-changed", { detail: { workspace, project, definitions, issue, error } })
    );
  return refresh.catch((failure: unknown) => console.error("Falha ao atualizar as propriedades nativas", failure));
}

const pendingFields = new Set<string>();
const fieldListeners = new Set<() => void>();
export const fieldMutationKey = (workspace: string, project: string, issue: string, field: string) =>
  [workspace, project, issue, field].join("/");
export const isFieldSaving = (key: string) => pendingFields.has(key);
export const subscribeFieldSaves = (listener: () => void) => {
  fieldListeners.add(listener);
  return () => {
    fieldListeners.delete(listener);
  };
};
function notifySaves() {
  for (const listener of fieldListeners) listener();
}

export type FieldValue = string | boolean | string[] | null;
export type FieldValues = Record<string, FieldValue>;
export type SelectOption = { id: string; label: string; color?: string };
export type CustomField = {
  id: string;
  name: string;
  kind:
    | "text"
    | "long_text"
    | "number"
    | "date"
    | "datetime"
    | "boolean"
    | "select"
    | "multiselect"
    | "url"
    | "phone"
    | "site";
  description: string;
  required: boolean;
  active: boolean;
  position: number;
  options: SelectOption[];
};
export type FieldMeta = { fields: CustomField[]; can_manage: boolean; can_edit: boolean };
export type Condition = { id: string; field: string; operator: string; value?: FieldValue };
export type FilterTree = Condition | { op: "and" | "or" | "not"; children: FilterTree[]; id?: string };
export type SortCriterion = { field: string; direction: "asc" | "desc"; nulls: "first" | "last" };
export type ViewConfig = {
  schema_version?: number;
  filter_tree?: FilterTree;
  sorts?: SortCriterion[];
  search_hidden?: boolean;
  subtasks?: "collapsed" | "expanded" | "separate";
  collapsed_groups?: string[];
  view_id?: string;
  calculations?: { field: string; operation: "count" | "sum" | "avg" | "min" | "max" }[];
  manual?: boolean;
  manual_order?: Record<string, string[]>;
  native_group?:
    | "inherit"
    | "none"
    | "state"
    | "priority"
    | "assignees"
    | "labels"
    | "cycle"
    | "module"
    | "project"
    | "created_by";
  filters: Condition[];
  match: "all" | "any";
  group_by: string;
  order_by: string;
  layout: "table" | "list" | "kanban";
  columns: string[];
  search: string;
  priority: string;
};
export type SavedView = {
  id: string;
  name: string;
  shared: boolean;
  owner_id: string;
  config: ViewConfig;
  revision: number;
  locked: boolean;
  schema_version: number;
};
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
  async refresh(workspace: string, project: string) {
    await refreshNativeCaches(workspace, project);
  }
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
    void refreshNativeCaches(workspace, project, true);
    return response.data;
  }
  async deleteDefinition(workspace: string, project: string, id: string) {
    await this.delete(`${this.path(workspace, project)}definitions/${id}/`);
    void refreshNativeCaches(workspace, project, true);
  }
  async moveSelection(workspace: string, project: string, issue: string, field: string, from: string, to: string) {
    const response = (
      await this.patch(`${this.path(workspace, project)}issues/${issue}/`, { selection_move: { field, from, to } })
    ).data;
    await refreshNativeCaches(workspace, project, false, issue);
    return response;
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
  async save(workspace: string, project: string, issue: string, values: FieldValues, expected?: FieldValues) {
    const keys = Object.keys(values).map((field) => fieldMutationKey(workspace, project, issue, field));
    if (keys.some((key) => pendingFields.has(key))) throw new Error("Salvamento em andamento nesta célula. Aguarde.");
    for (const key of keys) pendingFields.add(key);
    notifySaves();
    try {
      const response = await this.patch(`${this.path(workspace, project)}issues/${issue}/`, {
        values,
        ...(expected ? { expected } : {}),
      });
      await refreshNativeCaches(workspace, project, false, issue);
      return response.data;
    } catch (failure) {
      if ((failure as { response?: { status?: number } }).response?.status === 409)
        await refreshNativeCaches(workspace, project, false, issue, fieldError(failure));
      throw failure;
    } finally {
      for (const key of keys) pendingFields.delete(key);
      notifySaves();
    }
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
  async updateView(workspace: string, project: string, view: SavedView, data: Partial<SavedView>) {
    return (await this.patch(`${this.path(workspace, project)}views/${view.id}/`, { ...data, revision: view.revision }))
      .data as SavedView;
  }
}
export const fieldsService = new FieldsService();
export const fieldInputClass =
  "min-h-11 min-w-0 max-w-full rounded border border-subtle bg-surface-1 px-2 py-1.5 text-base text-primary disabled:opacity-50 md:min-h-8 md:text-13";
export function fieldError(error: unknown): string {
  const e = error as { response?: { data?: unknown }; message?: string };
  return JSON.stringify(e?.response?.data ?? e?.message ?? "Não foi possível concluir a operação.");
}
