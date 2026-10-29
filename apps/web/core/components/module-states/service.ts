import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export type ModuleStateConfig = { state_ids: string[] | null; occupied_state_ids: string[] };
export type ModuleStateSettings = {
  can_manage: boolean;
  states: { id: string; name: string; color: string; group: string }[];
  modules: { id: string; name: string; state_ids: string[] | null }[];
};
export const moduleStatesKey = (workspace: string, project: string, module?: string) => [
  "module-state-visibility",
  workspace,
  project,
  module ?? "settings",
];

class ModuleStatesService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }
  path(workspace: string, project: string) {
    return `/api/workspaces/${encodeURIComponent(workspace)}/projects/${project}/module-states/`;
  }
  async settings(workspace: string, project: string): Promise<ModuleStateSettings> {
    return (await this.get(this.path(workspace, project))).data;
  }
  async getModule(workspace: string, project: string, module: string): Promise<ModuleStateConfig> {
    return (await this.get(`${this.path(workspace, project)}${module}/`)).data;
  }
  async save(workspace: string, project: string, module: string, stateIds: string[] | null) {
    return (await this.patch(`${this.path(workspace, project)}${module}/`, { state_ids: stateIds })).data;
  }
}
export const moduleStatesService = new ModuleStatesService();
