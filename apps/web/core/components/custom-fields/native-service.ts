import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";
import type { FieldValues } from "./service";
import type { NativeField, NativePreference, NativeRequest } from "./native-display-helpers";

export type NativeMetadata = {
  fields: NativeField[];
  preference: NativePreference;
  editable_project_ids: string[];
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
