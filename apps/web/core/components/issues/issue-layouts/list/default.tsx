/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { observer } from "mobx-react";
// plane constants
import { ALL_ISSUES } from "@plane/constants";
// types
import type {
  GroupByColumnTypes,
  TGroupedIssues,
  TIssue,
  IIssueDisplayProperties,
  TIssueMap,
  TIssueGroupByOptions,
  TIssueOrderByOptions,
  IGroupByColumn,
  TIssueKanbanFilters,
} from "@plane/types";
// components
import { MultipleSelectGroup } from "@/components/core/multiple-select";
// hooks
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
// plane web components
import { IssueBulkOperationsRoot } from "@/components/issues/bulk-operations";
// plane web hooks
import { useBulkOperationStatus } from "@/hooks/use-bulk-operation-status";
// utils
import type { GroupDropLocation } from "../utils";
import { getGroupByColumns, isWorkspaceLevel, isSubGrouped } from "../utils";
import { ListGroup } from "./list-group";
import type { TRenderQuickActions } from "./list-view-types";
import { NativeListController } from "@/components/custom-fields/native-list-controller";
import { NativeListHeaders } from "@/components/custom-fields/native-list-cells";
import { NativeListBulkTools } from "@/components/custom-fields/native-list-toolbar";
import { useNativeList } from "@/components/custom-fields/native-list-context";
import { compatibleGroup } from "@/components/custom-fields/native-list-model";
import { OptionBadge } from "@/components/custom-fields/inputs";
import { useIssues } from "@/hooks/store/use-issues";
import { ListLayoutLoader } from "@/components/ui/loader/layouts/list-layout-loader";

export interface IList {
  viewId?: string;
  groupedIssueIds: TGroupedIssues;
  issuesMap: TIssueMap;
  group_by: TIssueGroupByOptions | null;
  orderBy: TIssueOrderByOptions | undefined;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  quickActions: TRenderQuickActions;
  displayProperties: IIssueDisplayProperties | undefined;
  enableIssueQuickAdd: boolean;
  showEmptyGroup?: boolean;
  canEditProperties: (projectId: string | undefined) => boolean;
  quickAddCallback?: (projectId: string | null | undefined, data: TIssue) => Promise<TIssue | undefined>;
  disableIssueCreation?: boolean;
  handleOnDrop: (source: GroupDropLocation, destination: GroupDropLocation) => Promise<void>;
  addIssuesToView?: (issueIds: string[]) => Promise<TIssue>;
  isCompletedCycle?: boolean;
  loadMoreIssues: (groupId?: string) => void;
  handleCollapsedGroups: (value: string) => void;
  collapsedGroups: TIssueKanbanFilters;
  isEpic?: boolean;
}

export const List = observer(function List(props: IList) {
  return (
    <NativeListController props={props}>
      <ListContent {...props} />
    </NativeListController>
  );
});

const ListContent = observer(function ListContent(props: IList) {
  const {
    groupedIssueIds,
    issuesMap,
    group_by: originalGroupBy,
    orderBy: originalOrder,
    updateIssue,
    quickActions,
    displayProperties,
    enableIssueQuickAdd,
    showEmptyGroup,
    canEditProperties,
    quickAddCallback,
    disableIssueCreation,
    handleOnDrop,
    addIssuesToView,
    isCompletedCycle = false,
    loadMoreIssues,
    handleCollapsedGroups,
    collapsedGroups,
    isEpic = false,
  } = props;

  const storeType = useIssueStoreType();
  const native = useNativeList();
  const { issues } = useIssues(storeType);
  const group_by = (
    native?.enabled
      ? native.customGroup
        ? "state"
        : native.query.native_group && native.query.native_group !== "inherit"
          ? native.query.native_group === "none"
            ? null
            : native.query.native_group
          : originalGroupBy
      : originalGroupBy
  ) as TIssueGroupByOptions;
  const orderBy = native?.enabled ? (native.canReorder ? "sort_order" : "-created_at") : originalOrder;
  // plane web hooks
  const isBulkOperationsEnabled = useBulkOperationStatus();

  const containerRef = useRef<HTMLDivElement | null>(null);

  const normalGroups = getGroupByColumns({
    groupBy: group_by as GroupByColumnTypes,
    includeNone: true,
    isWorkspaceLevel: isWorkspaceLevel(storeType),
    isEpic: isEpic,
  });
  const field = native?.enabled ? native.customGroup : undefined;
  const groups: IGroupByColumn[] | undefined = field
    ? ([
        ...(field.kind === "boolean"
          ? [
              { id: "true", name: "Sim" },
              { id: "false", name: "Não" },
            ]
          : field.options.map((option) => ({
              id: option.id,
              name: option.label,
              icon: <OptionBadge option={option} />,
            }))),
        { id: "__empty__", name: "Sem valor" },
      ]
        .filter((group) => compatibleGroup(native!.query.filter_tree!, field.id, group.id))
        .map((group) =>
          Object.assign(group, {
            payload: native!.createDefaults(group.id),
            isDropDisabled: false,
          })
        ) as IGroupByColumn[])
    : normalGroups;

  // Enable Auto Scroll for Main Kanban
  useEffect(() => {
    const element = containerRef.current;

    if (!element) return;

    return combine(
      autoScrollForElements({
        element,
      })
    );
  }, [containerRef]);

  if (!groups) return null;

  const getGroupIndex = (groupId: string | undefined) => groups.findIndex(({ id }) => id === groupId);

  const is_list = group_by === null;

  // create groupIds array and entities object for bulk ops
  const groupIds = groups.map((g) => g.id);
  const orderedGroups: Record<string, string[]> = {};
  groupIds.forEach((gID) => {
    orderedGroups[gID] = [];
  });
  let entities: Record<string, string[]> = {};

  if (is_list) {
    entities = Object.assign(orderedGroups, { [groupIds[0]]: groupedIssueIds[ALL_ISSUES] ?? [] });
  } else if (!isSubGrouped(groupedIssueIds)) {
    entities = Object.assign(orderedGroups, { ...groupedIssueIds });
  } else {
    entities = orderedGroups;
  }
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {groups && (
        <MultipleSelectGroup
          containerRef={containerRef}
          entities={entities}
          disabled={!isBulkOperationsEnabled || isEpic}
        >
          {(helpers) => (
            <>
              <div
                ref={containerRef}
                // Keep sticky column/group layers below the page header's menus.
                className="vertical-scrollbar relative isolate scrollbar-lg size-full overflow-auto bg-surface-1"
                role={native?.enabled ? "treegrid" : undefined}
                aria-label={native?.enabled ? "Lista de tarefas por colunas" : undefined}
              >
                <NativeListHeaders />
                {issues?.getIssueLoader() === "init-loader" ? <ListLayoutLoader /> : null}
                {!issues?.getIssueLoader() && issues?.getGroupIssueCount(undefined, undefined, false) === 0 && (
                  <p className="p-4 text-13 text-secondary">
                    Nenhum item corresponde à consulta. Ajuste os filtros ou crie uma tarefa.
                  </p>
                )}
                {groups.map((group: IGroupByColumn) => (
                  <ListGroup
                    key={group.id}
                    groupIssueIds={groupedIssueIds?.[group.id]}
                    issuesMap={issuesMap}
                    group_by={group_by}
                    group={group}
                    updateIssue={updateIssue}
                    quickActions={quickActions}
                    orderBy={orderBy}
                    getGroupIndex={getGroupIndex}
                    handleOnDrop={native?.enabled ? native.drop : handleOnDrop}
                    displayProperties={displayProperties}
                    enableIssueQuickAdd={enableIssueQuickAdd}
                    showEmptyGroup={showEmptyGroup}
                    canEditProperties={canEditProperties}
                    quickAddCallback={quickAddCallback}
                    disableIssueCreation={disableIssueCreation}
                    addIssuesToView={addIssuesToView}
                    isCompletedCycle={isCompletedCycle}
                    loadMoreIssues={native?.enabled ? native.loadMore : loadMoreIssues}
                    containerRef={containerRef}
                    selectionHelpers={helpers}
                    handleCollapsedGroups={handleCollapsedGroups}
                    collapsedGroups={collapsedGroups}
                    isEpic={isEpic}
                  />
                ))}
              </div>

              <IssueBulkOperationsRoot selectionHelpers={helpers} />
              <NativeListBulkTools helpers={helpers} />
            </>
          )}
        </MultipleSelectGroup>
      )}
    </div>
  );
});
