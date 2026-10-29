import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export type PersonalPagesResult = {
  count: number;
  page: number;
  page_size: number;
  results: {
    id: string;
    name: string;
    project_id: string;
    project_name: string;
    project_identifier: string;
    updated_at: string;
    archived: boolean;
    mine: boolean;
    url: string;
  }[];
};
class PersonalPagesService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }
  async list(
    workspace: string,
    params: { page: number; search: string; scope: string; archived: string }
  ): Promise<PersonalPagesResult> {
    return (await this.get(`/api/workspaces/${encodeURIComponent(workspace)}/personal-pages/`, { params })).data;
  }
}
export const personalPagesService = new PersonalPagesService();
