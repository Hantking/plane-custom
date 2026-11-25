/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export const TODO_PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type TodoPriority = (typeof TODO_PRIORITIES)[number];
export type TodoView = "today" | "upcoming" | "unscheduled" | "all" | "completed";

export type TodoWorkItem = {
  id: string;
  name: string;
  project_id: string;
  project_identifier: string;
  sequence_id: number;
};

export type TodoFields = {
  title: string;
  due_date: string | null;
  priority: TodoPriority;
  linked_issue_ids: string[];
};

export type PersonalTodo = Omit<TodoFields, "linked_issue_ids"> & {
  id: string;
  is_completed: boolean;
  linked_issues: TodoWorkItem[];
};

export type TodoUpdate = Partial<Omit<TodoFields, "linked_issue_ids"> & Pick<PersonalTodo, "is_completed">> & {
  link_changes?: { add: string[]; remove: string[] };
};

export type TodoPage = {
  next: string | null;
  results: PersonalTodo[];
  today: string;
};

class PersonalTodoService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private endpoint(workspaceSlug: string) {
    return "/api/workspaces/" + encodeURIComponent(workspaceSlug) + "/to-do/";
  }

  async list(workspaceSlug: string, view: TodoView, page: number): Promise<TodoPage> {
    const response = await this.get(this.endpoint(workspaceSlug), { params: { view, page } });
    return response.data;
  }

  async create(workspaceSlug: string, payload: TodoFields): Promise<PersonalTodo> {
    const { linked_issue_ids, ...fields } = payload;
    const response = await this.post(this.endpoint(workspaceSlug), {
      ...fields,
      link_changes: { add: linked_issue_ids },
    });
    return response.data;
  }

  async searchWorkItems(workspaceSlug: string, search: string): Promise<TodoWorkItem[]> {
    const response = await this.get(this.endpoint(workspaceSlug) + "work-items/", { params: { search } });
    return response.data;
  }

  async update(workspaceSlug: string, id: string, payload: TodoUpdate): Promise<PersonalTodo> {
    const response = await this.patch(this.endpoint(workspaceSlug) + id + "/", payload);
    return response.data;
  }
}

export const personalTodoService = new PersonalTodoService();
