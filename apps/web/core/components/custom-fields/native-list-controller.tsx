import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { observer } from "mobx-react";
import useSWR, { mutate as refreshCache } from "swr";
import type { IIssueDisplayProperties, TIssue } from "@plane/types";
import { EIssueFilterType, ALL_ISSUES } from "@plane/constants";
import { useIssues } from "@/hooks/store/use-issues";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { useIssuesActions } from "@/hooks/use-issues-actions";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import type { IList } from "@/components/issues/issue-layouts/list/default";
import type { GroupDropLocation } from "@/components/issues/issue-layouts/utils";
import { SPREADSHEET_COLUMNS } from "@/components/issues/issue-layouts/utils";
import { bindNativeList, nativeListBaseParams, withNativeListGroup } from "@/services/native-list-query-context";
import { useNativeFieldsContext } from "./native-context";
import { useNativeColumns } from "./native-layout";
import { NativeListContext } from "./native-list-context";
import type { NativeListState } from "./native-list-context";
import { nativeDisplayService } from "./native-service";
import { TableColumnWidthsProvider } from "./table-column-widths";
import { visibleTableColumns } from "./column-width-helpers";
import { normalizeListQuery, filterDefaults, manualGroupKey, moveListRow, mergeManualOrder } from "./native-list-model";
import { fieldError, fieldsService } from "./service";
import type { ViewConfig } from "./service";
import { NativeListToolbar } from "./native-list-toolbar";

export type ListSummary = {
  count: number;
  calculations: { field: string; operation: string; value: string | number | null }[];
  counts: string;
  subtasks: string;
};

export const NativeListController = observer(function NativeListController({
  props,
  children,
}: {
  props: IList;
  children: ReactNode;
}) {
  const native = useNativeFieldsContext();
  const storeType = useIssueStoreType();
  const { issues } = useIssues(storeType);
  const nativeLoading = !!issues?.getIssueLoader();
  const actions = useIssuesActions(storeType);
  const issueDetail = useIssueDetail();
  const ref = useRef({ native, props, actions, issueDetail });
  ref.current = { native, props, actions, issueDetail };
  const raw = JSON.stringify(native?.display.data?.preference.query ?? {});
  const query = useMemo(() => normalizeListQuery(JSON.parse(raw) as Partial<ViewConfig>), [raw]);
  const queryKey = JSON.stringify(query);
  const identity = native?.display.identity ?? "unsupported";
  const supported = !!native?.display.request && !props.isEpic;
  const enabled = supported && !!native?.display.data;
  const allColumns = useNativeColumns(Object.keys(SPREADSHEET_COLUMNS));
  const columnsKey = JSON.stringify(visibleTableColumns(allColumns, props.displayProperties ?? {}, true));
  const columns = useMemo(() => JSON.parse(columnsKey) as string[], [columnsKey]);
  const fieldsKey = JSON.stringify(native?.display.data?.fields ?? []);
  const visibleKey = JSON.stringify(native?.display.data?.preference.visible ?? []);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const [childrenEpoch, setChildrenEpoch] = useState(0);
  const [childEditable, setChildEditable] = useState<string[]>([]);
  const pendingFocus = useRef<{ issue: string; column: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queryRef = useRef(query);
  queryRef.current = query;
  const customGroup = native?.display.data?.fields.find((field) => field.id === query.group_by);
  const nativeGroup =
    query.native_group && query.native_group !== "inherit"
      ? query.native_group === "none"
        ? null
        : query.native_group
      : props.group_by;
  const canReorder =
    !nativeLoading &&
    !saving &&
    !loading &&
    !!query.manual &&
    !query.sorts?.length &&
    (!!customGroup || [null, "state", "priority"].includes(nativeGroup));

  const reload = useCallback(async () => {
    const current = ref.current;
    if (!current.native?.display.request) return;
    setLoading(true);
    try {
      current.issueDetail.subIssues.invalidateBatch(
        current.native.issueIds.filter((id) =>
          queryRef.current.subtasks === "expanded"
            ? expandedRef.current[id] !== false
            : expandedRef.current[id] === true
        )
      );
      setChildEditable([]);
      await current.actions.fetchIssues(
        "mutation",
        { canGroup: true, perPageCount: queryRef.current.group_by ? 25 : 100 },
        current.props.viewId
      );
      setChildrenEpoch((value) => value + 1);
      await refreshCache(
        (key: unknown) =>
          Array.isArray(key) && key[0] === "hentis-native-summary" && key[1] === current.native?.display.identity
      );
      requestAnimationFrame(() => {
        const focus = pendingFocus.current;
        if (!focus) return;
        const element = document.querySelector<HTMLElement>(
          `[data-list-issue="${focus.issue}"] [data-list-column="${focus.column}"]`
        );
        if (element) element.focus({ preventScroll: true });
        else {
          document.querySelector<HTMLElement>("[data-native-list-search]")?.focus();
          setNotice("Alteração salva. O item pode ter mudado de grupo, posição ou saído dos filtros/página atuais.");
        }
        pendingFocus.current = null;
      });
    } catch (failure) {
      setError(fieldError(failure));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const current = ref.current.native;
    if (!enabled || !current?.display.request) return;
    const unbind = bindNativeList({
      identity,
      workspace: current.display.workspace,
      context: current.display.request,
      query: JSON.parse(queryKey) as ViewConfig,
    });
    void reload();
    return unbind;
  }, [identity, enabled, queryKey, fieldsKey, visibleKey, reload]);
  useEffect(() => {
    if (!supported) return;
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ workspace: string; issue?: string; fields?: string[]; error?: string }>)
        .detail;
      if (detail.workspace !== ref.current.native?.display.workspace) return;
      if (detail.error) setError(detail.error);
      const active = document.activeElement?.closest<HTMLElement>("[data-list-column]");
      const row = active?.closest<HTMLElement>("[data-list-issue]");
      if (active && row) pendingFocus.current = { issue: row.dataset.listIssue!, column: active.dataset.listColumn! };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setNotice("Consulta e contagens atualizadas após a edição/gestão de campos.");
        void reload();
      }, 100);
    };
    window.addEventListener("hentis-fields-changed", changed);
    return () => {
      window.removeEventListener("hentis-fields-changed", changed);
      clearTimeout(timer.current);
    };
  }, [supported, reload]);

  const patch = useCallback(async (update: Partial<ViewConfig>) => {
    const current = ref.current.native;
    if (!current?.display.request) return;
    setSaving(true);
    setError("");
    try {
      const data = await nativeDisplayService.saveQuery(current.display.workspace, current.display.request, {
        ...queryRef.current,
        ...update,
      });
      await current.display.mutate(data, { revalidate: false });
    } catch (failure) {
      setError(fieldError(failure));
      throw failure;
    } finally {
      setSaving(false);
    }
  }, []);
  const updateStandard = useCallback((update: Partial<IIssueDisplayProperties>) => {
    const current = ref.current;
    void current.actions.updateFilters(
      current.native?.display.request?.project_id ?? "",
      EIssueFilterType.DISPLAY_PROPERTIES,
      update
    );
  }, []);
  const updateIssue = useCallback(
    async (project: string | null, id: string, data: Partial<TIssue>) => {
      const active = document.activeElement?.closest<HTMLElement>("[data-list-column]");
      pendingFocus.current = { issue: id, column: active?.dataset.listColumn ?? "title" };
      await ref.current.props.updateIssue?.(project, id, data);
      await reload();
    },
    [reload]
  );
  const moveRow = useCallback(
    (group: string, id: string, delta: number) => {
      const ids = (ref.current.props.groupedIssueIds[group] ?? []) as string[];
      const index = ids.indexOf(id),
        target = ids[index + delta];
      if (!target) return;
      pendingFocus.current = { issue: id, column: "title" };
      const key = manualGroupKey(queryRef.current, group, ref.current.props.group_by);
      void patch({
        manual_order: {
          ...queryRef.current.manual_order,
          [key]: mergeManualOrder(queryRef.current.manual_order?.[key] ?? [], moveListRow(ids, id, target, delta > 0)),
        },
      }).catch(() => undefined);
    },
    [patch]
  );
  const drop = useCallback(
    async (source: GroupDropLocation, destination: GroupDropLocation) => {
      if (!source.id) return;
      const current = ref.current,
        q = queryRef.current,
        metadata = current.native?.display.data;
      const field = metadata?.fields.find((item) => item.id === q.group_by);
      if (source.groupId !== destination.groupId) {
        if (field && current.native) {
          const issue = current.props.issuesMap[source.id];
          if (!issue?.project_id) return;
          try {
            if (field.kind === "multiselect")
              await fieldsService.moveSelection(
                current.native.display.workspace,
                issue.project_id,
                issue.id,
                field.id,
                source.groupId ?? "__empty__",
                destination.groupId ?? "__empty__"
              );
            else {
              const parse = (key: string | undefined) =>
                !key || key === "__empty__" ? null : field.kind === "boolean" ? key === "true" : key;
              await fieldsService.save(
                current.native.display.workspace,
                issue.project_id,
                issue.id,
                { [field.id]: parse(destination.groupId) },
                { [field.id]: parse(source.groupId) }
              );
            }
            await reload();
          } catch (failure) {
            setError(fieldError(failure));
          }
        } else await current.props.handleOnDrop(source, destination);
        return;
      }
      if (!q.manual || q.sorts?.length) {
        setNotice("Reordenação desabilitada com sort automático. Ative ordem manual pessoal.");
        return;
      }
      const group = source.groupId || ALL_ISSUES;
      const ids = (current.props.groupedIssueIds[group] ?? []) as string[];
      if (!destination.id || !ids.includes(destination.id)) return;
      const key = manualGroupKey(q, group, current.props.group_by);
      await patch({
        manual_order: {
          ...q.manual_order,
          [key]: mergeManualOrder(
            q.manual_order?.[key] ?? [],
            moveListRow(ids, source.id, destination.id, destination.canAddIssueBelow)
          ),
        },
      });
    },
    [reload, patch]
  );
  const createDefaults = useCallback((group?: string): Partial<TIssue> => {
    const current = ref.current.native;
    const q = queryRef.current;
    const values = filterDefaults(q.filter_tree!, current?.display.data?.fields);
    const field = current?.display.data?.fields.find((item) => item.id === q.group_by);
    if (field && group)
      values[field.id] =
        group === "__empty__"
          ? null
          : field.kind === "multiselect"
            ? [group]
            : field.kind === "boolean"
              ? group === "true"
              : group;
    return { ...(field ? { project_id: field.project_id } : {}), custom_fields: values } as Partial<TIssue>;
  }, []);
  const loadMore = useCallback(
    (group?: string) => withNativeListGroup(identity, group, () => ref.current.props.loadMoreIssues(group)),
    [identity]
  );
  const onExpand = useCallback((id: string, state: boolean) => {
    if (state) ref.current.issueDetail.subIssues.invalidateBatch([id]);
    setExpanded((current) => ({ ...current, [id]: state }));
  }, []);
  const isExpanded = useCallback(
    (id: string, level: number) =>
      query.subtasks === "separate" ? false : (expanded[id] ?? (query.subtasks === "expanded" && level < 3)),
    [expanded, query.subtasks]
  );
  const canEditProject = useCallback(
    (id: string) =>
      !props.isCompletedCycle &&
      (!!native?.display.data?.editable_project_ids.includes(id) || childEditable.includes(id)),
    [native?.display.data?.editable_project_ids, childEditable, props.isCompletedCycle]
  );
  useEffect(() => {
    setExpanded({});
  }, [query.subtasks]);
  const operation = useCallback(async <T,>(name: string, extra: object = {}) => {
    const current = ref.current.native;
    if (!current?.display.request) throw new Error("Contexto indisponível.");
    return nativeDisplayService.listOperation<T>(
      current.display.workspace,
      name,
      current.display.request,
      queryRef.current,
      nativeListBaseParams(current.display.identity),
      extra
    );
  }, []);
  const exportCSV = useCallback(async (mode: string) => {
    const current = ref.current.native;
    if (!current?.display.request) return;
    try {
      const blob = await nativeDisplayService.exportList(
        current.display.workspace,
        current.display.request,
        queryRef.current,
        nativeListBaseParams(current.display.identity),
        mode
      );
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = "plane-lista.csv";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setError(fieldError(failure));
    }
  }, []);
  const coreKey = JSON.stringify(nativeListBaseParams(identity));
  const summary = useSWR(enabled ? ["hentis-native-summary", identity, queryKey, coreKey, visibleKey] : null, () =>
    operation<ListSummary>("summary")
  );
  const value = useMemo<NativeListState>(
    () => ({
      enabled,
      columns,
      query,
      busy: saving || loading || nativeLoading,
      customGroup,
      patch,
      reload,
      updateStandard,
      updateIssue,
      drop,
      moveRow,
      canReorder,
      createDefaults,
      loadMore,
      operation,
      exportCSV,
      isExpanded,
      onExpand,
      canEditProject,
    }),
    [
      enabled,
      columns,
      query,
      saving,
      loading,
      nativeLoading,
      customGroup,
      patch,
      reload,
      updateStandard,
      updateIssue,
      drop,
      moveRow,
      canReorder,
      createDefaults,
      loadMore,
      operation,
      exportCSV,
      isExpanded,
      onExpand,
      canEditProject,
    ]
  );
  // Batch automatic expansion via the existing sub-issue store instead of one call per row.
  const idsKey = JSON.stringify(native?.issueIds ?? []);
  useEffect(() => {
    if (!enabled || query.subtasks === "separate") return;
    const ids = (ref.current.native?.issueIds ?? []).filter((id) => {
      const issue = ref.current.props.issuesMap[id];
      return (
        issue &&
        issue.sub_issues_count > 0 &&
        expanded[id] !== false &&
        (query.subtasks === "expanded" || expanded[id]) &&
        issueDetail.subIssues.subIssuesByIssueId(id) === undefined
      );
    });
    if (ids.length)
      void issueDetail.subIssues
        .fetchSubIssuesBatch(ref.current.native!.display.workspace, ref.current.native!.display.request!, ids)
        .then((projects) => setChildEditable((previous) => [...new Set([...previous, ...projects])]))
        .catch((failure) => setError(fieldError(failure)));
  }, [enabled, query.subtasks, idsKey, issueDetail, expanded, childrenEpoch]);
  const body = (
    <>
      {enabled && <NativeListToolbar props={props} summary={summary.data} />}
      {enabled && (
        <div className="px-3 text-11" aria-live="polite">
          {(saving || loading) && "Atualizando…"}
          {error && (
            <p role="alert" className="text-danger-primary">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-secondary">
              {notice}
            </p>
          )}
          {summary.error && <p role="alert">Não foi possível calcular os totais.</p>}
        </div>
      )}
      {children}
    </>
  );
  return (
    <NativeListContext.Provider value={value}>
      <div className="flex size-full min-h-0 flex-col">
        {enabled ? <TableColumnWidthsProvider columns={columns}>{body}</TableColumnWidthsProvider> : body}
      </div>
    </NativeListContext.Provider>
  );
});
