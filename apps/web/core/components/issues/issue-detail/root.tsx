/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import { observer } from "mobx-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setPromiseToast, setToast } from "@plane/propel/toast";
import type { TIssue } from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
// assets
import emptyIssue from "@/app/assets/empty-state/issue.svg?url";
// components
import { EmptyState } from "@/components/common/empty-state";
// hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
import { useAppRouter } from "@/hooks/use-app-router";
import useSize from "@/hooks/use-window-size";
// local components
import { IssuePeekOverview } from "../peek-overview";
import { IssueMainContent } from "./main-content";
import { PeekOverviewProperties } from "../peek-overview/properties";
import { isIssueMobileViewport } from "./mobile-panels";
import {
  IssueMobilePanelContent,
  IssueMobileTabs,
  IssueQuickAccessPanels,
  IssueQuickAccessRail,
  useIssueMobilePanel,
  useIssueQuickPanel,
} from "./quick-access";

export type TIssueOperations = {
  fetch: (workspaceSlug: string, projectId: string, issueId: string, loader?: boolean) => Promise<void>;
  update: (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssue>) => Promise<void>;
  remove: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  archive?: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  restore?: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  addCycleToIssue?: (workspaceSlug: string, projectId: string, cycleId: string, issueId: string) => Promise<void>;
  addIssueToCycle?: (workspaceSlug: string, projectId: string, cycleId: string, issueIds: string[]) => Promise<void>;
  removeIssueFromCycle?: (workspaceSlug: string, projectId: string, cycleId: string, issueId: string) => Promise<void>;
  removeIssueFromModule?: (
    workspaceSlug: string,
    projectId: string,
    moduleId: string,
    issueId: string
  ) => Promise<void>;
  changeModulesInIssue?: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    addModuleIds: string[],
    removeModuleIds: string[]
  ) => Promise<void>;
};

export type TIssueDetailRoot = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  is_archived?: boolean;
};

export const IssueDetailRoot = observer(function IssueDetailRoot(props: TIssueDetailRoot) {
  const { t } = useTranslation();
  const {
    workspaceSlug: currentWorkspaceSlug,
    projectId: currentProjectId,
    issueId: currentIssueId,
    is_archived = false,
  } = props;
  // router
  const router = useAppRouter();
  // hooks
  const {
    issue: { getIssueById },
    fetchIssue,
    updateIssue,
    removeIssue,
    archiveIssue,
    addCycleToIssue,
    addIssueToCycle,
    removeIssueFromCycle,
    changeModulesInIssue,
    removeIssueFromModule,
  } = useIssueDetail();
  const {
    issues: { removeIssue: removeArchivedIssue },
  } = useIssues(EIssuesStoreType.ARCHIVED);
  const { allowPermissions } = useUserPermissions();
  const { issueDetailSidebarCollapsed, toggleIssueDetailSidebar } = useAppTheme();
  const [quickPanel, setQuickPanel] = useIssueQuickPanel(currentIssueId);
  const [mobilePanel, setMobilePanel] = useIssueMobilePanel(currentIssueId);
  const [viewportWidth] = useSize();
  const isCompact = isIssueMobileViewport(viewportWidth);

  const issueOperations: TIssueOperations = useMemo(
    () => ({
      fetch: async (workspaceSlug: string, projectId: string, issueId: string) => {
        try {
          await fetchIssue(workspaceSlug, projectId, issueId);
        } catch (error) {
          console.error("Error fetching the parent issue:", error);
        }
      },
      update: async (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssue>) => {
        try {
          await updateIssue(workspaceSlug, projectId, issueId, data);
        } catch (error) {
          console.log("Error in updating issue:", error);
          setToast({
            title: t("common.error.label"),
            type: TOAST_TYPE.ERROR,
            message: t("entity.update.failed", { entity: t("issue.label") }),
          });
        }
      },
      remove: async (workspaceSlug: string, projectId: string, issueId: string) => {
        try {
          if (is_archived) await removeArchivedIssue(workspaceSlug, projectId, issueId);
          else await removeIssue(workspaceSlug, projectId, issueId);
          setToast({
            title: t("common.success"),
            type: TOAST_TYPE.SUCCESS,
            message: t("entity.delete.success", { entity: t("issue.label") }),
          });
        } catch (error) {
          console.log("Error in deleting issue:", error);
          setToast({
            title: t("common.error.label"),
            type: TOAST_TYPE.ERROR,
            message: t("entity.delete.failed", { entity: t("issue.label") }),
          });
        }
      },
      archive: async (workspaceSlug: string, projectId: string, issueId: string) => {
        try {
          await archiveIssue(workspaceSlug, projectId, issueId);
        } catch (error) {
          console.log("Error in archiving issue:", error);
        }
      },
      addCycleToIssue: async (workspaceSlug: string, projectId: string, cycleId: string, issueId: string) => {
        try {
          await addCycleToIssue(workspaceSlug, projectId, cycleId, issueId);
        } catch (_error) {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("common.error.label"),
            message: t("issue.add.cycle.failed"),
          });
        }
      },
      addIssueToCycle: async (workspaceSlug: string, projectId: string, cycleId: string, issueIds: string[]) => {
        try {
          await addIssueToCycle(workspaceSlug, projectId, cycleId, issueIds);
        } catch (_error) {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("common.error.label"),
            message: t("issue.add.cycle.failed"),
          });
        }
      },
      removeIssueFromCycle: async (workspaceSlug: string, projectId: string, cycleId: string, issueId: string) => {
        try {
          const removeFromCyclePromise = removeIssueFromCycle(workspaceSlug, projectId, cycleId, issueId);
          setPromiseToast(removeFromCyclePromise, {
            loading: t("issue.remove.cycle.loading"),
            success: {
              title: t("common.success"),
              message: () => t("issue.remove.cycle.success"),
            },
            error: {
              title: t("common.error.label"),
              message: () => t("issue.remove.cycle.failed"),
            },
          });
          await removeFromCyclePromise;
        } catch (error) {
          console.log("Error in removing issue from cycle:", error);
        }
      },
      removeIssueFromModule: async (workspaceSlug: string, projectId: string, moduleId: string, issueId: string) => {
        try {
          const removeFromModulePromise = removeIssueFromModule(workspaceSlug, projectId, moduleId, issueId);
          setPromiseToast(removeFromModulePromise, {
            loading: t("issue.remove.module.loading"),
            success: {
              title: t("common.success"),
              message: () => t("issue.remove.module.success"),
            },
            error: {
              title: t("common.error.label"),
              message: () => t("issue.remove.module.failed"),
            },
          });
          await removeFromModulePromise;
        } catch (error) {
          console.log("Error in removing issue from module:", error);
        }
      },
      changeModulesInIssue: async (
        workspaceSlug: string,
        projectId: string,
        issueId: string,
        addModuleIds: string[],
        removeModuleIds: string[]
      ) => {
        const promise = await changeModulesInIssue(workspaceSlug, projectId, issueId, addModuleIds, removeModuleIds);
        return promise;
      },
    }),
    [
      is_archived,
      fetchIssue,
      updateIssue,
      removeIssue,
      archiveIssue,
      removeArchivedIssue,
      addIssueToCycle,
      addCycleToIssue,
      removeIssueFromCycle,
      changeModulesInIssue,
      removeIssueFromModule,
      t,
    ]
  );

  // issue details
  const issue = getIssueById(currentIssueId);
  // checking if issue is editable, based on user role
  const isEditable = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT,
    currentWorkspaceSlug,
    currentProjectId
  );

  return (
    <>
      {!issue ? (
        <EmptyState
          image={emptyIssue}
          title={t("issue.empty_state.issue_detail.title")}
          description={t("issue.empty_state.issue_detail.description")}
          primaryButton={{
            text: t("issue.empty_state.issue_detail.primary_button.text"),
            onClick: () => router.push(`/${currentWorkspaceSlug}/projects/${currentProjectId}/issues`),
          }}
        />
      ) : (
        <div
          className={`relative flex h-full min-h-0 w-full min-w-0 overflow-hidden ${isCompact ? "flex-col" : "flex-row"}`}
          data-mobile-issue-detail={isCompact || undefined}
        >
          {isCompact && (
            <IssueMobileTabs
              issueId={currentIssueId}
              panel={mobilePanel}
              onChange={setMobilePanel}
              idPrefix="issue-detail"
            />
          )}
          <IssueMobilePanelContent
            key="content"
            issueId={currentIssueId}
            panel="content"
            activePanel={mobilePanel}
            idPrefix="issue-detail"
            isMobile={isCompact}
            className="h-full w-full"
          >
            <div className={`min-w-0 space-y-6 py-5 ${isCompact ? "px-4" : "px-9"}`}>
              <IssueMainContent
                workspaceSlug={currentWorkspaceSlug}
                projectId={currentProjectId}
                issueId={currentIssueId}
                issueOperations={issueOperations}
                isEditable={isEditable}
                isArchived={is_archived}
                quickPanel={isCompact ? undefined : quickPanel}
                showInlineProperties={false}
                showActivity={false}
                hideAttachments
              />
            </div>
          </IssueMobilePanelContent>
          <div
            key="access-panels"
            hidden={!isCompact && issueDetailSidebarCollapsed}
            className={
              isCompact
                ? "contents"
                : issueDetailSidebarCollapsed
                  ? "hidden"
                  : "relative z-[5] flex h-full w-1/4 min-w-[300px] shrink-0 flex-col overflow-hidden border-l border-subtle bg-surface-1 lg:min-w-80 xl:min-w-96"
            }
          >
            <IssueQuickAccessPanels
              key={currentIssueId}
              issueId={currentIssueId}
              idPrefix="issue-detail"
              activePanel={isCompact ? mobilePanel : quickPanel}
              isMobile={isCompact}
              workspaceSlug={currentWorkspaceSlug}
              projectId={currentProjectId}
              disabled={!isEditable || is_archived}
              isArchived={is_archived}
              properties={
                <PeekOverviewProperties
                  workspaceSlug={currentWorkspaceSlug}
                  projectId={currentProjectId}
                  issueId={currentIssueId}
                  issueOperations={issueOperations}
                  disabled={!isEditable || is_archived}
                />
              }
            />
          </div>
          {!isCompact && (
            <IssueQuickAccessRail
              issueId={currentIssueId}
              panel={quickPanel}
              onChange={(panel) => {
                setQuickPanel(panel);
                toggleIssueDetailSidebar(false);
              }}
            />
          )}
        </div>
      )}

      {/* peek overview */}
      <IssuePeekOverview />
    </>
  );
});
