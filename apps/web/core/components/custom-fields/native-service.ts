import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";
import type { FieldValues } from "./service";
import type { ViewConfig } from "./service";
import type { NativeField, NativePreference, NativeRequest } from "./native-display-helpers";

export type NativeMetadata = {
  fields: NativeField[];
  preference: NativePreference;
  editable_project_ids: string[];
  manageable_project_ids?: string[];
  context_label: string;
};
export type NativeBatch = { values: Record<string, FieldValues>; projects: Record<string, string> };

class NativeDisplayService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }
  path(workspace: string) {
    return `/api/workspaces/${encodeURIComponent(workspace)}/custom-fields/`;
  }
  async metadata(workspace: string, context: NativeRequest): Promise<NativeMetadata> {
    return (await this.get(this.path(workspace) + "native-display/", { params: context })).data;
  }
  async save(workspace: string, context: NativeRequest, preference: NativePreference): Promise<NativeMetadata> {
    return (
      await this.patch(this.path(workspace) + "native-display/", {
        ...context,
        order: preference.order,
        visible: preference.visible,
      })
    ).data;
  }
  async resizeColumn(
    workspace: string,
    context: NativeRequest,
    key: string,
    width: number | null
  ): Promise<NativeMetadata> {
    return (await this.patch(this.path(workspace) + "native-display/", { ...context, widths: { [key]: width } })).data;
  }
  async saveQuery(workspace: string, context: NativeRequest, query: ViewConfig): Promise<NativeMetadata> {
    return (await this.patch(this.path(workspace) + "native-display/", { ...context, query })).data;
  }
  async listOperation<T>(
    workspace: string,
    operation: string,
    context: NativeRequest,
    query: ViewConfig,
    standard: object,
    extra: object = {}
  ): Promise<T> {
    return (await this.post(this.path(workspace) + `native-list/${operation}/`, { context, query, standard, ...extra }))
      .data;
  }
  async exportList(workspace: string, context: NativeRequest, query: ViewConfig, standard: object, mode: string) {
    return (
      await this.post(
        this.path(workspace) + "native-list/export/",
        { context, query, standard, mode },
        { responseType: "blob" }
      )
    ).data as Blob;
  }
  async batch(workspace: string, context: NativeRequest, ids: string[]): Promise<NativeBatch> {
    const chunks = Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) =>
      ids.slice(index * 100, (index + 1) * 100)
    );
    const result: NativeBatch = { values: {}, projects: {} };
    const responses = await Promise.all(
      chunks.map(
        async (chunk): Promise<NativeBatch> =>
          (await this.post(this.path(workspace) + "native-values/", { ...context, ids: chunk })).data
      )
    );
    for (const response of responses) {
      Object.assign(result.values, response.values);
      Object.assign(result.projects, response.projects);
    }
    return result;
  }
}
export const nativeDisplayService = new NativeDisplayService();
