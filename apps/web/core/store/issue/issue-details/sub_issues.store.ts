/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { pull, concat, uniq, set, update } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// Plane Imports
import type {
  TIssue,
  TIssueSubIssues,
  TIssueSubIssuesStateDistributionMap,
  TIssueSubIssuesIdMap,
  TSubIssuesStateDistribution,
  TIssueServiceType,
  TLoader,
} from "@plane/types";
// services
import { IssueService } from "@/services/issue";
import { nativeDisplayService } from "@/components/custom-fields/native-service";
import type { NativeRequest } from "@/components/custom-fields/native-display-helpers";
// store
import type { IIssueDetail } from "./root.store";
import type { IWorkItemSubIssueFiltersStore } from "./sub_issues_filter.store";
import { WorkItemSubIssueFiltersStore } from "./sub_issues_filter.store";

export interface IIssueSubIssuesStoreActions {
  fetchSubIssues: (workspaceSlug: string, projectId: string, parentIssueId: string) => Promise<TIssueSubIssues>;
  createSubIssues: (
    workspaceSlug: string,
    projectId: string,
    parentIssueId: string,
    issueIds: string[]
  ) => Promise<void>;
  updateSubIssue: (
    workspaceSlug: string,
    projectId: string,
    parentIssueId: string,
    issueId: string,
    issueData: Partial<TIssue>,
    oldIssue?: Partial<TIssue>,
    fromModal?: boolean
  ) => Promise<void>;
  removeSubIssue: (workspaceSlug: string, projectId: string, parentIssueId: string, issueId: string) => Promise<void>;
  deleteSubIssue: (workspaceSlug: string, projectId: string, parentIssueId: string, issueId: string) => Promise<void>;
}

type TSubIssueHelpersKeys = "issue_visibility" | "preview_loader" | "issue_loader";
type TSubIssueHelpers = Record<TSubIssueHelpersKeys, string[]>;
export interface IIssueSubIssuesStore extends IIssueSubIssuesStoreActions {
  fetchSubIssuesBatch: (workspaceSlug: string, context: NativeRequest, ids: string[]) => Promise<string[]>;
  invalidateBatch: (ids: string[]) => void;
  // observables
  subIssuesStateDistribution: TIssueSubIssuesStateDistributionMap;
  subIssues: TIssueSubIssuesIdMap;
  subIssueHelpers: Record<string, TSubIssueHelpers>; // parent_issue_id -> TSubIssueHelpers
  loader: TLoader;
  filters: IWorkItemSubIssueFiltersStore;
  // helper methods
  stateDistributionByIssueId: (issueId: string) => TSubIssuesStateDistribution | undefined;
  subIssuesByIssueId: (issueId: string) => string[] | undefined;
  subIssueHelpersByIssueId: (issueId: string) => TSubIssueHelpers;
  // actions
  fetchOtherProjectProperties: (workspaceSlug: string, projectIds: string[]) => Promise<void>;
  setSubIssueHelpers: (parentIssueId: string, key: TSubIssueHelpersKeys, value: string) => void;
}

export class IssueSubIssuesStore implements IIssueSubIssuesStore {
  private pendingParents = new Set<string>();
  // observables
  subIssuesStateDistribution: TIssueSubIssuesStateDistributionMap = {};
  subIssues: TIssueSubIssuesIdMap = {};
  subIssueHelpers: Record<string, TSubIssueHelpers> = {};
  loader: TLoader = undefined;

  filters: IWorkItemSubIssueFiltersStore;
  // root store
  rootIssueDetailStore: IIssueDetail;
  // services
  serviceType;
  issueService;

  constructor(rootStore: IIssueDetail, serviceType: TIssueServiceType) {
    makeObservable(this, {
      // observables
      subIssuesStateDistribution: observable,
      subIssues: observable,
      subIssueHelpers: observable,
      loader: observable.ref,
      // actions
      setSubIssueHelpers: action,
      fetchSubIssues: action,
      createSubIssues: action,
      updateSubIssue: action,
      removeSubIssue: action,
      deleteSubIssue: action,
      fetchOtherProjectProperties: action,
    });
    this.filters = new WorkItemSubIssueFiltersStore(this);
    // root store
    this.rootIssueDetailStore = rootStore;
    // services
    this.serviceType = serviceType;
    this.issueService = new IssueService(serviceType);
  }

  // helper methods
  stateDistributionByIssueId = (issueId: string) => {
    if (!issueId) return undefined;
    return this.subIssuesStateDistribution[issueId] ?? undefined;
  };

  subIssuesByIssueId = computedFn((issueId: string) => this.subIssues[issueId]);

  subIssueHelpersByIssueId = (issueId: string) => ({
    preview_loader: this.subIssueHelpers?.[issueId]?.preview_loader || [],
    issue_visibility: this.subIssueHelpers?.[issueId]?.issue_visibility || [],
    issue_loader: this.subIssueHelpers?.[issueId]?.issue_loader || [],
  });

  // actions
  setSubIssueHelpers = (parentIssueId: string, key: TSubIssueHelpersKeys, value: string) => {
    if (!parentIssueId || !key || !value) return;

    update(this.subIssueHelpers, [parentIssueId, key], (_subIssueHelpers: string[] = []) => {
      if (_subIssueHelpers.includes(value)) return pull(_subIssueHelpers, value);
      return concat(_subIssueHelpers, value);
    });
  };

  fetchSubIssues = async (workspaceSlug: string, projectId: string, parentIssueId: string) => {
    this.loader = "init-loader";
    const response = await this.issueService.subIssues(workspaceSlug, projectId, parentIssueId);

    const subIssuesStateDistribution = response?.state_distribution ?? {};

    const issueList = (response.sub_issues ?? []) as TIssue[];

    this.rootIssueDetailStore.rootIssueStore.issues.addIssue(issueList);

    // fetch other issues states and members when sub-issues are from different project
    if (issueList && issueList.length > 0) {
      const otherProjectIds = uniq(
        issueList.map((issue) => issue.project_id).filter((id) => !!id && id !== projectId)
      ) as string[];
      this.fetchOtherProjectProperties(workspaceSlug, otherProjectIds);
    }
    if (issueList) {
      this.rootIssueDetailStore.rootIssueStore.issues.updateIssue(parentIssueId, {
        sub_issues_count: issueList.length,
      });
    }

    runInAction(() => {
      set(this.subIssuesStateDistribution, parentIssueId, subIssuesStateDistribution);
      set(
        this.subIssues,
        parentIssueId,
        issueList.map((issue) => issue.id)
      );
    });

    this.loader = undefined;
    return response;
  };

  fetchSubIssuesBatch = async (workspaceSlug: string, context: NativeRequest, ids: string[]) => {
    const editable = new Set<string>();
    const parents = [...new Set(ids)].filter((id) => !this.pendingParents.has(id) && this.subIssues[id] === undefined);
    for (const id of parents) this.pendingParents.add(id);
    try {
      for (let offset = 0; offset < parents.length; offset += 100) {
        // oxlint-disable-next-line no-await-in-loop -- Keep only one bounded batch of parents in flight.
        const response = await nativeDisplayService.listOperation<{
          results: (TIssue & { state__group?: keyof TSubIssuesStateDistribution })[];
          parents: string[];
          editable_project_ids: string[];
        }>(
          workspaceSlug,
          "children",
          context,
          {
            filters: [],
            match: "all",
            group_by: "",
            sorts: [],
            order_by: "-created_at",
            columns: [],
            layout: "list",
            search: "",
            priority: "",
          },
          {},
          { ids: parents.slice(offset, offset + 100) }
        );
        this.rootIssueDetailStore.rootIssueStore.issues.addIssue(response.results);
        for (const project of response.editable_project_ids) editable.add(project);
        const otherProjects = uniq(
          response.results
            .map((issue) => issue.project_id)
            .filter((id): id is string => !!id && id !== context.project_id)
        );
        // oxlint-disable-next-line no-await-in-loop -- Hydrate dependencies before publishing this batch to the store.
        await this.fetchOtherProjectProperties(workspaceSlug, otherProjects);
        runInAction(() => {
          for (const parent of response.parents) {
            const children = response.results.filter((issue) => issue.parent_id === parent);
            const distribution: TSubIssuesStateDistribution = {
              backlog: [],
              unstarted: [],
              started: [],
              completed: [],
              cancelled: [],
            };
            for (const child of children) {
              const group = child["state__group"];
              if (group && distribution[group]) distribution[group].push(child.id);
            }
            set(
              this.subIssues,
              parent,
              children.map((issue) => issue.id)
            );
            set(this.subIssuesStateDistribution, parent, distribution);
          }
        });
      }
    } finally {
      for (const id of parents) this.pendingParents.delete(id);
    }
    return [...editable];
  };

  invalidateBatch = (ids: string[]) =>
    runInAction(() => {
      for (const id of ids) {
        delete this.subIssues[id];
        delete this.subIssuesStateDistribution[id];
      }
    });

  createSubIssues = async (workspaceSlug: string, projectId: string, parentIssueId: string, issueIds: string[]) => {
    const response = await this.issueService.addSubIssues(workspaceSlug, projectId, parentIssueId, {
      sub_issue_ids: issueIds,
    });

    const subIssuesStateDistribution = response?.state_distribution ?? {};
    const subIssues = Array.isArray(response?.sub_issues) ? response.sub_issues : [];

    // fetch other issues states and members when sub-issues are from different project
    if (subIssues && subIssues.length > 0) {
      const otherProjectIds = uniq(
        subIssues.map((issue) => issue.project_id).filter((id) => !!id && id !== projectId)
      ) as string[];
      this.fetchOtherProjectProperties(workspaceSlug, otherProjectIds);
    }

    runInAction(() => {
      Object.keys(subIssuesStateDistribution).forEach((key) => {
        const stateGroup = key as keyof TSubIssuesStateDistribution;
        update(this.subIssuesStateDistribution, [parentIssueId, stateGroup], (stateDistribution) => {
          if (!stateDistribution) return subIssuesStateDistribution[stateGroup];
          return concat(stateDistribution, subIssuesStateDistribution[stateGroup]);
        });
      });

      const createdIssueIds = subIssues.map((issue) => issue.id);
      update(this.subIssues, [parentIssueId], (issues) => {
        if (!issues) return createdIssueIds;
        return concat(issues, createdIssueIds);
      });
    });

    this.rootIssueDetailStore.rootIssueStore.issues.addIssue(subIssues);

    // update sub-issues_count of the parent issue
    set(
      this.rootIssueDetailStore.rootIssueStore.issues.issuesMap,
      [parentIssueId, "sub_issues_count"],
      this.subIssues[parentIssueId].length
    );

    return;
  };

  updateSubIssue = async (
    workspaceSlug: string,
    projectId: string,
    parentIssueId: string,
    issueId: string,
    issueData: Partial<TIssue>,
    oldIssue: Partial<TIssue> = {},
    fromModal: boolean = false
  ) => {
    if (!fromModal)
      await this.rootIssueDetailStore.rootIssueStore.projectIssues.updateIssue(
        workspaceSlug,
        projectId,
        issueId,
        issueData
      );

    // parent update
    if (issueData.hasOwnProperty("parent_id") && issueData.parent_id !== oldIssue.parent_id) {
      runInAction(() => {
        if (oldIssue.parent_id) pull(this.subIssues[oldIssue.parent_id], issueId);
        if (issueData.parent_id)
          set(this.subIssues, [issueData.parent_id], concat(this.subIssues[issueData.parent_id], issueId));
      });
    }

    // state update
    if (issueData.hasOwnProperty("state_id") && issueData.state_id !== oldIssue.state_id) {
      let oldIssueStateGroup: string | undefined = undefined;
      let issueStateGroup: string | undefined = undefined;

      if (oldIssue.state_id) {
        const state = this.rootIssueDetailStore.rootIssueStore.rootStore.state.getStateById(oldIssue.state_id);
        if (state?.group) oldIssueStateGroup = state.group;
      }

      if (issueData.state_id) {
        const state = this.rootIssueDetailStore.rootIssueStore.rootStore.state.getStateById(issueData.state_id);
        if (state?.group) issueStateGroup = state.group;
      }

      if (oldIssueStateGroup && issueStateGroup && issueStateGroup !== oldIssueStateGroup) {
        runInAction(() => {
          if (oldIssueStateGroup)
            update(this.subIssuesStateDistribution, [parentIssueId, oldIssueStateGroup], (stateDistribution) => {
              if (!stateDistribution) return;
              return pull(stateDistribution, issueId);
            });

          if (issueStateGroup)
            update(this.subIssuesStateDistribution, [parentIssueId, issueStateGroup], (stateDistribution) => {
              if (!stateDistribution) return [issueId];
              return concat(stateDistribution, issueId);
            });
        });
      }
    }

    return;
  };

  removeSubIssue = async (workspaceSlug: string, projectId: string, parentIssueId: string, issueId: string) => {
    await this.rootIssueDetailStore.rootIssueStore.projectIssues.updateIssue(workspaceSlug, projectId, issueId, {
      parent_id: null,
    });

    const issue = this.rootIssueDetailStore.issue.getIssueById(issueId);
    if (issue && issue.state_id) {
      let issueStateGroup: string | undefined = undefined;
      const state = this.rootIssueDetailStore.rootIssueStore.rootStore.state.getStateById(issue.state_id);
      if (state?.group) issueStateGroup = state.group;

      if (issueStateGroup) {
        runInAction(() => {
          if (issueStateGroup)
            update(this.subIssuesStateDistribution, [parentIssueId, issueStateGroup], (stateDistribution) => {
              if (!stateDistribution) return;
              return pull(stateDistribution, issueId);
            });
        });
      }
    }

    runInAction(() => {
      pull(this.subIssues[parentIssueId], issueId);
      // update sub-issues_count of the parent issue
      set(
        this.rootIssueDetailStore.rootIssueStore.issues.issuesMap,
        [parentIssueId, "sub_issues_count"],
        this.subIssues[parentIssueId]?.length
      );
    });

    return;
  };

  deleteSubIssue = async (workspaceSlug: string, projectId: string, parentIssueId: string, issueId: string) => {
    await this.rootIssueDetailStore.rootIssueStore.projectIssues.removeIssue(workspaceSlug, projectId, issueId);

    const issue = this.rootIssueDetailStore.issue.getIssueById(issueId);
    if (issue && issue.state_id) {
      let issueStateGroup: string | undefined = undefined;
      const state = this.rootIssueDetailStore.rootIssueStore.rootStore.state.getStateById(issue.state_id);
      if (state?.group) issueStateGroup = state.group;

      if (issueStateGroup) {
        runInAction(() => {
          if (issueStateGroup)
            update(this.subIssuesStateDistribution, [parentIssueId, issueStateGroup], (stateDistribution) => {
              if (!stateDistribution) return;
              return pull(stateDistribution, issueId);
            });
        });
      }
    }

    runInAction(() => {
      pull(this.subIssues[parentIssueId], issueId);
      // update sub-issues_count of the parent issue
      set(
        this.rootIssueDetailStore.rootIssueStore.issues.issuesMap,
        [parentIssueId, "sub_issues_count"],
        this.subIssues[parentIssueId]?.length
      );
    });

    return;
  };

  fetchOtherProjectProperties = async (workspaceSlug: string, projectIds: string[]) => {
    if (projectIds.length > 0) {
      for (const projectId of projectIds) {
        // fetching other project states
        this.rootIssueDetailStore.rootIssueStore.rootStore.state.fetchProjectStates(workspaceSlug, projectId);
        // fetching other project members
        this.rootIssueDetailStore.rootIssueStore.rootStore.memberRoot.project.fetchProjectMembers(
          workspaceSlug,
          projectId
        );
        // fetching other project labels
        this.rootIssueDetailStore.rootIssueStore.rootStore.label.fetchProjectLabels(workspaceSlug, projectId);
        // fetching other project cycles
        this.rootIssueDetailStore.rootIssueStore.rootStore.cycle.fetchAllCycles(workspaceSlug, projectId);
        // fetching other project modules
        this.rootIssueDetailStore.rootIssueStore.rootStore.module.fetchModules(workspaceSlug, projectId);
        // fetching other project estimates
        this.rootIssueDetailStore.rootIssueStore.rootStore.projectEstimate.getProjectEstimates(
          workspaceSlug,
          projectId
        );
      }
    }
  };
}
