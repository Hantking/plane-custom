/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { MutableRefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { observer } from "mobx-react";
// plane imports
import { DRAG_ALLOWED_GROUPS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type {
  IGroupByColumn,
  TIssueMap,
  TIssueGroupByOptions,
  TIssueOrderByOptions,
  TIssue,
  IIssueDisplayProperties,
  TIssueKanbanFilters,
} from "@plane/types";
import { EIssueLayoutTypes } from "@plane/types";
import { Row } from "@plane/ui";
import { cn } from "@plane/utils";
// components
import { ListLoaderItemRow } from "@/components/ui/loader/layouts/list-layout-loader";
import { useWorkFlowFDragNDrop } from "@/components/workflow";
// hooks
import { useProjectState } from "@/hooks/store/use-project-state";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useIssuesStore } from "@/hooks/use-issue-layout-store";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
// local imports
import { GroupDragOverlay } from "../group-drag-overlay";
import { ListQuickAddIssueButton, QuickAddIssueRoot } from "../quick-add";
import type { GroupDropLocation } from "../utils";
import {
  getDestinationFromDropPayload,
  getIssueBlockId,
  getSourceFromDropPayload,
  highlightIssueOnDrop,
} from "../utils";
import { IssueBlocksList } from "./blocks-list";
import { HeaderGroupByCard } from "./headers/group-by-card";
import type { TRenderQuickActions } from "./list-view-types";
import { useNativeList } from "@/components/custom-fields/native-list-context";
import { useNativeFieldsContext } from "@/components/custom-fields/native-context";
import { NativeListCreateButton } from "@/components/custom-fields/native-list-create";

interface Props {
  groupIssueIds: string[] | undefined;
  group: IGroupByColumn;
  issuesMap: TIssueMap;
  group_by: TIssueGroupByOptions | null;
  orderBy: TIssueOrderByOptions | undefined;
  getGroupIndex: (groupId: string | undefined) => number;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  quickActions: TRenderQuickActions;
  displayProperties: IIssueDisplayProperties | undefined;
  enableIssueQuickAdd: boolean;
  canEditProperties: (projectId: string | undefined) => boolean;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  quickAddCallback?: ((projectId: string | null | undefined, data: TIssue) => Promise<TIssue | undefined>) | undefined;
  handleOnDrop: (source: GroupDropLocation, destination: GroupDropLocation) => Promise<void>;
  disableIssueCreation?: boolean;
  addIssuesToView?: (issueIds: string[]) => Promise<TIssue>;
  isCompletedCycle?: boolean;
  showEmptyGroup?: boolean;
  loadMoreIssues: (groupId?: string) => void;
  selectionHelpers: TSelectionHelper;
  handleCollapsedGroups: (value: string) => void;
  collapsedGroups: TIssueKanbanFilters;
  isEpic?: boolean;
}

export const ListGroup = observer(function ListGroup(props: Props) {
  const {
    groupIssueIds = [],
    group,
    issuesMap,
    group_by,
    orderBy,
    getGroupIndex,
    updateIssue,
    quickActions,
    displayProperties,
    enableIssueQuickAdd,
    canEditProperties,
    containerRef,
    quickAddCallback,
    handleOnDrop,
    disableIssueCreation,
    addIssuesToView,
    isCompletedCycle,
    showEmptyGroup,
    loadMoreIssues,
    selectionHelpers,
    handleCollapsedGroups,
    collapsedGroups,
    isEpic = false,
  } = props;

  const [isDraggingOverColumn, setIsDraggingOverColumn] = useState(false);
  const [dragColumnOrientation, setDragColumnOrientation] = useState<"justify-start" | "justify-end">("justify-start");
  const native = useNativeList();
  const custom = useNativeFieldsContext();
  const personalCollapsed = native?.enabled
    ? (native.query.collapsed_groups ?? collapsedGroups?.group_by)
    : collapsedGroups?.group_by;
  const isExpanded = !personalCollapsed?.includes(group.id);
  const collapse = native?.enabled
    ? (key: string) => {
        const previous = native.query.collapsed_groups ?? collapsedGroups?.group_by ?? [];
        void native
          .patch({
            collapsed_groups: previous.includes(key) ? previous.filter((id) => id !== key) : [...previous, key],
          })
          .catch(() => undefined);
      }
    : handleCollapsedGroups;
  const required = !!custom?.display.data?.fields.some((field) => field.required);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const { t } = useTranslation();
  const projectState = useProjectState();

  const {
    issues: { getGroupIssueCount, getPaginationData, getIssueLoader },
  } = useIssuesStore();

  const [intersectionElement, setIntersectionElement] = useState<HTMLDivElement | null>(null);

  const { workflowDisabledSource, isWorkflowDropDisabled, handleWorkFlowState, getIsWorkflowWorkItemCreationDisabled } =
    useWorkFlowFDragNDrop(native?.customGroup ? null : group_by);
  const isWorkflowIssueCreationDisabled = getIsWorkflowWorkItemCreationDisabled(group.id);

  const groupIssueCount = getGroupIssueCount(group.id, undefined, false) ?? 0;
  const nextPageResults = getPaginationData(group.id, undefined)?.nextPageResults;
  const isPaginating = !!getIssueLoader(group.id);

  const loadGroupPage = useCallback(() => loadMoreIssues(group.id), [loadMoreIssues, group.id]);
  useIntersectionObserver(containerRef, isPaginating ? null : intersectionElement, loadGroupPage, `100% 0% 100% 0%`);

  const shouldLoadMore =
    nextPageResults === undefined && groupIssueCount !== undefined && groupIssueIds
      ? groupIssueIds.length < groupIssueCount
      : !!nextPageResults;

  const loadMore = isPaginating ? (
    <ListLoaderItemRow />
  ) : (
    <button
      type="button"
      className={
        "relative flex h-11 w-full cursor-pointer items-center gap-3 border border-transparent border-t-subtle-1 bg-surface-1 p-3 pl-8 text-left text-13 font-medium text-accent-primary hover:text-accent-secondary hover:underline"
      }
      onClick={() => loadMoreIssues(group.id)}
    >
      {t("common.load_more")} &darr;
    </button>
  );

  const validateEmptyIssueGroups = (issueCount: number = 0) => {
    if (!showEmptyGroup && issueCount <= 0) return false;
    return true;
  };

  const prePopulateQuickAddData = (groupByKey: string | null, value: any) => {
    const defaultState = projectState.projectStates?.find((state) => state.default);
    let preloadedData: object = { state_id: defaultState?.id };

    if (groupByKey === null) {
      preloadedData = { ...preloadedData };
    } else {
      if (groupByKey === "state") {
        preloadedData = { ...preloadedData, state_id: value };
      } else if (groupByKey === "priority") {
        preloadedData = { ...preloadedData, priority: value };
      } else if (groupByKey === "labels" && value != "None") {
        preloadedData = { ...preloadedData, label_ids: [value] };
      } else if (groupByKey === "assignees" && value != "None") {
        preloadedData = { ...preloadedData, assignee_ids: [value] };
      } else if (groupByKey === "cycle" && value != "None") {
        preloadedData = { ...preloadedData, cycle_id: value };
      } else if (groupByKey === "module" && value != "None") {
        preloadedData = { ...preloadedData, module_ids: [value] };
      } else if (groupByKey === "created_by") {
        preloadedData = { ...preloadedData };
      } else {
        preloadedData = { ...preloadedData, [groupByKey]: value };
      }
    }

    return preloadedData;
  };

  useEffect(() => {
    const element = groupRef.current;

    if (!element) return;

    return combine(
      dropTargetForElements({
        element,
        getData: () => ({ groupId: group.id, type: "COLUMN" }),
        onDragEnter: () => {
          setIsDraggingOverColumn(true);
        },
        onDragLeave: () => {
          setIsDraggingOverColumn(false);
        },
        onDragStart: () => {
          setIsDraggingOverColumn(true);
        },
        onDrag: ({ source }) => {
          const sourceGroupId = source?.data?.groupId as string | undefined;
          const currentGroupId = group.id;

          // oxlint-disable-next-line no-unused-expressions
          sourceGroupId && handleWorkFlowState(sourceGroupId, currentGroupId);

          const sourceIndex = getGroupIndex(sourceGroupId);
          const currentIndex = getGroupIndex(currentGroupId);

          if (sourceIndex > currentIndex) {
            setDragColumnOrientation("justify-end");
          } else {
            setDragColumnOrientation("justify-start");
          }
        },
        onDrop: (payload) => {
          setIsDraggingOverColumn(false);
          const source = getSourceFromDropPayload(payload);
          const destination = getDestinationFromDropPayload(payload);

          if (!source || !destination) return;

          if (isWorkflowDropDisabled || group.isDropDisabled) {
            if (group.dropErrorMessage)
              setToast({
                type: TOAST_TYPE.WARNING,
                title: t("common.warning"),
                message: group.dropErrorMessage,
              });
            return;
          }

          handleOnDrop(source, destination);

          highlightIssueOnDrop(getIssueBlockId(source.id, destination?.groupId), orderBy !== "sort_order");

          if (!isExpanded) {
            collapse(group.id);
          }
        },
      })
    );
  }, [
    // oxlint-disable-next-line eslint-plugin-react-hooks/exhaustive-deps
    groupRef?.current,
    group,
    orderBy,
    getGroupIndex,
    setDragColumnOrientation,
    setIsDraggingOverColumn,
    isWorkflowDropDisabled,
  ]);

  const isDragAllowed = group_by ? DRAG_ALLOWED_GROUPS.includes(group_by) : true;
  const canOverlayBeVisible = isWorkflowDropDisabled || orderBy !== "sort_order" || !!group.isDropDisabled;
  const isDropDisabled = isWorkflowDropDisabled || !!group.isDropDisabled;

  const isGroupByCreatedBy = group_by === "created_by";
  const shouldExpand = (!!groupIssueCount && isExpanded) || !group_by;

  return validateEmptyIssueGroups(groupIssueCount) ? (
    <div
      ref={groupRef}
      className={cn(`relative flex flex-shrink-0 flex-col`, {
        "border-accent-strong": isDraggingOverColumn,
        "border-danger-subtle": isDraggingOverColumn && isDropDisabled,
      })}
    >
      <Row
        className={cn("w-full flex-shrink-0 border-b border-subtle bg-layer-1 py-1 pr-3 hover:bg-layer-1-hover", {
          "sticky top-0 z-[2]": !native?.enabled && isExpanded && groupIssueCount > 0,
          "sticky top-11 z-[2]": native?.enabled && isExpanded && groupIssueCount > 0,
        })}
      >
        <HeaderGroupByCard
          isExpanded={isExpanded}
          disabled={native?.enabled && native.busy}
          groupID={group.id}
          groupBy={group_by}
          icon={group.icon}
          title={group.name}
          count={groupIssueCount}
          issuePayload={native?.enabled ? { ...group.payload, ...native.createDefaults(group.id) } : group.payload}
          canEditProperties={canEditProperties}
          disableIssueCreation={
            disableIssueCreation ||
            isGroupByCreatedBy ||
            isCompletedCycle ||
            isWorkflowIssueCreationDisabled ||
            !!(native?.customGroup?.required && group.id === "__empty__")
          }
          addIssuesToView={addIssuesToView}
          selectionHelpers={selectionHelpers}
          handleCollapsedGroups={collapse}
          isEpic={isEpic}
        />
      </Row>
      {shouldExpand && (
        <div className="relative">
          <GroupDragOverlay
            dragColumnOrientation={dragColumnOrientation}
            canOverlayBeVisible={canOverlayBeVisible}
            isDropDisabled={isDropDisabled}
            workflowDisabledSource={workflowDisabledSource}
            dropErrorMessage={group.dropErrorMessage}
            orderBy={orderBy}
            isDraggingOverColumn={isDraggingOverColumn}
            isEpic={isEpic}
          />
          {groupIssueIds && (
            <IssueBlocksList
              issueIds={groupIssueIds}
              groupId={group.id}
              issuesMap={issuesMap}
              updateIssue={updateIssue}
              quickActions={quickActions}
              displayProperties={displayProperties}
              canEditProperties={canEditProperties}
              containerRef={containerRef}
              isDragAllowed={isDragAllowed}
              canDropOverIssue={!canOverlayBeVisible}
              selectionHelpers={selectionHelpers}
              isEpic={isEpic}
            />
          )}

          {shouldLoadMore &&
            (group_by ? (
              <>{loadMore}</>
            ) : (
              <>
                {Array.from({ length: 2 }).map((_, index) => (
                  // oxlint-disable-next-line react/no-array-index-key
                  <ListLoaderItemRow key={index} />
                ))}
                <ListLoaderItemRow ref={setIntersectionElement} />
              </>
            ))}

          {enableIssueQuickAdd &&
            !disableIssueCreation &&
            !isGroupByCreatedBy &&
            !isCompletedCycle &&
            !isWorkflowIssueCreationDisabled &&
            !(native?.customGroup?.required && group.id === "__empty__") && (
              <div className="w-full flex-shrink-0">
                {native?.enabled && required ? (
                  <NativeListCreateButton
                    defaults={{
                      ...prePopulateQuickAddData(native.customGroup ? null : group_by, group.id),
                      ...native.createDefaults(group.id),
                    }}
                  />
                ) : (
                  <QuickAddIssueRoot
                    layout={EIssueLayoutTypes.LIST}
                    QuickAddButton={ListQuickAddIssueButton}
                    prePopulatedData={
                      native?.enabled
                        ? {
                            ...prePopulateQuickAddData(native.customGroup ? null : group_by, group.id),
                            ...native.createDefaults(group.id),
                          }
                        : prePopulateQuickAddData(group_by, group.id)
                    }
                    containerClassName="border-b border-t border-subtle bg-surface-1 "
                    quickAddCallback={
                      native?.enabled && quickAddCallback
                        ? async (project, data) => {
                            const result = await quickAddCallback(project, data);
                            await native.reload();
                            return result;
                          }
                        : quickAddCallback
                    }
                    isEpic={isEpic}
                  />
                )}
              </div>
            )}
        </div>
      )}
    </div>
  ) : null;
});
