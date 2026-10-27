import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compatibleGroup,
  filterDefaults,
  manualGroupKey,
  mergeManualOrder,
  moveListRow,
  normalizeListQuery,
  nativeOrderQueryChange,
} from "../../apps/web/core/components/custom-fields/native-list-model";
import {
  bindNativeList,
  matchesNativeListRequest,
  nativeListBaseParams,
  nativeListReadParams,
  withNativeListGroup,
} from "../../apps/web/core/services/native-list-query-context";

const project = "11111111-1111-4111-8111-111111111111";
const context = { scope: "project", target: project, project_id: project, layout: "list" };
const url = `/api/workspaces/demo/projects/${project}/issues/`;
const page = { cursor: "25:0:0", per_page: 25 };

test("native sort choices replace custom criteria and preserve the native priority and date semantics", () => {
  const active = { workspace: "demo", request: { ...context, scope: "project" as const, layout: "list" as const } };
  const change = (orderBy: string) =>
    nativeOrderQueryChange(active, { workspace: "demo", context: active.request, orderBy });
  const previous = normalizeListQuery({
    sorts: [{ field: "custom-field", direction: "desc", nulls: "first" }],
    search: "client",
    group_by: "group-field",
    manual_order: { group: ["a", "b"] },
  });
  const next = { ...previous, ...change("-created_at") };
  assert.equal(
    previous.order_by,
    "-created_at",
    "the native option was already selected before applying custom criteria"
  );
  assert.deepEqual(next.sorts, [{ field: "created_at", direction: "desc", nulls: "last" }]);
  assert.equal(next.search, previous.search);
  assert.equal(next.group_by, previous.group_by);
  assert.deepEqual(next.manual_order, previous.manual_order);
  assert.deepEqual(change("-priority")?.sorts, [{ field: "priority", direction: "asc", nulls: "last" }]);
  assert.deepEqual(change("target_date")?.sorts, [{ field: "due_date", direction: "asc", nulls: "last" }]);
  assert.deepEqual(change("-updated_at")?.sorts, [{ field: "updated_at", direction: "desc", nulls: "last" }]);
  assert.deepEqual(change("start_date")?.sorts, [{ field: "start_date", direction: "asc", nulls: "last" }]);
  assert.deepEqual(change("sort_order"), { sorts: [], manual: true, order_by: "sort_order" });
});

test("native sort intents cannot affect a different workspace, route context or layout", () => {
  const request = { ...context, scope: "project" as const, layout: "list" as const };
  const active = { workspace: "demo", request };
  for (const change of [
    { workspace: "foreign", context: request, orderBy: "-created_at" },
    { workspace: "demo", context: { ...request, target: "other" }, orderBy: "-created_at" },
    { workspace: "demo", context: { ...request, scope: "module" as const }, orderBy: "-created_at" },
    { workspace: "demo", context: { ...request, project_id: "other" }, orderBy: "-created_at" },
    { workspace: "demo", context: { ...request, layout: "kanban" as const }, orderBy: "-created_at" },
    { workspace: "demo", context: request, orderBy: "assignees__password" },
    { workspace: "demo", context: null, orderBy: "-created_at" },
  ])
    assert.equal(nativeOrderQueryChange(active, change), null);
  assert.equal(
    nativeOrderQueryChange(
      { ...active, request: null },
      { workspace: "demo", context: request, orderBy: "-created_at" }
    ),
    null
  );
});

test("legacy filters and sort migrate without losing semantics or changing node identity", () => {
  const value = normalizeListQuery({
    filters: [{ field: "number", operator: "gt", value: "3" }],
    match: "any",
    order_by: "-created_at",
  });
  assert.deepEqual(value.sorts, [{ field: "created_at", direction: "desc", nulls: "last" }]);
  assert.equal("op" in value.filter_tree! && value.filter_tree.op, "or");
  assert.deepEqual(normalizeListQuery(value), value);
});

test("defaults use unambiguous scalar equality in AND and exclude multiselect, OR, NOT and ranges", () => {
  assert.deepEqual(
    filterDefaults(
      {
        op: "and",
        children: [
          { field: "text", operator: "eq", value: "Client" },
          { field: "number", operator: "gt", value: "10" },
          { field: "multi", operator: "eq", value: "option" },
          { op: "or", children: [{ field: "or", operator: "eq", value: "ignored" }] },
          { op: "not", children: [{ field: "not", operator: "eq", value: "ignored" }] },
          { op: "and", children: [{ field: "boolean", operator: "eq", value: false }] },
          { field: "conflict", operator: "eq", value: "a" },
          { field: "conflict", operator: "eq", value: "b" },
        ],
      },
      [{ id: "multi", kind: "multiselect" }]
    ),
    { text: "Client", boolean: false }
  );
});

test("manual moves preserve unloaded positions and do not mutate the loaded page", () => {
  const loaded = ["a", "b", "c"];
  const moved = moveListRow(loaded, "a", "c", true);
  assert.deepEqual(loaded, ["a", "b", "c"]);
  assert.deepEqual(moved, ["b", "c", "a"]);
  assert.deepEqual(mergeManualOrder(["a", "unloaded", "b", "c"], moved), ["b", "unloaded", "c", "a"]);
  assert.deepEqual(moveListRow(loaded, "foreign", "c"), loaded);
});

test("manual order is isolated by preset, grouping type and group", () => {
  const keys = [
    manualGroupKey({}, "a", "state"),
    manualGroupKey({}, "a", "priority"),
    manualGroupKey({ view_id: "preset" }, "a", "state"),
    manualGroupKey({ group_by: "custom" }, "a", "state"),
    manualGroupKey({}, "b", "state"),
    manualGroupKey({ native_group: "none" }, "a", "state"),
  ];
  assert.equal(new Set(keys).size, keys.length);
});

test("group occurrence evaluation preserves unknown branches and applies NOT", () => {
  const tree = {
    op: "and" as const,
    children: [
      { field: "multi", operator: "eq", value: "red" },
      { field: "other", operator: "eq", value: "unknown" },
    ],
  };
  assert.equal(compatibleGroup(tree, "multi", "red"), true);
  assert.equal(compatibleGroup(tree, "multi", "blue"), false);
  assert.equal(compatibleGroup({ op: "not", children: [tree.children[0]] }, "multi", "red"), false);
});

test("query binding matches only paginated List reads in the mounted scope", () => {
  assert.equal(matchesNativeListRequest(url, "demo", context, page), true);
  for (const [path, scope, params] of [
    [url, { ...context, layout: "kanban" }, page],
    [url, context, {}],
    [url.replace("demo", "foreign"), context, page],
    [url.replace("issues/", "issues/issue-id/"), context, page],
    [url, { ...context, scope: "module", target: "module" }, page],
    [url.replace("issues/", "archived-issues/"), context, page],
  ] as const)
    assert.equal(matchesNativeListRequest(path, "demo", scope, params), false);
  assert.equal(
    matchesNativeListRequest(
      url.replace("issues/", "modules/module/issues/"),
      "demo",
      { ...context, scope: "module", target: "module" },
      page
    ),
    true
  );
  assert.equal(
    matchesNativeListRequest(
      url.replace("issues/", "cycles/cycle/cycle-issues/"),
      "demo",
      { ...context, scope: "cycle", target: "cycle" },
      page
    ),
    true
  );
});

test("module and cycle List queries reach their project endpoint only for the exact scope target", () => {
  for (const scope of ["module", "cycle"] as const) {
    const scoped = { ...context, scope, target: `${scope}-one` };
    const params = { ...page, [scope]: scoped.target, order_by: "-created_at" };
    const query = normalizeListQuery({ sorts: [{ field: "sector", direction: "desc", nulls: "last" }] });
    const unbind = bindNativeList({ identity: scope, workspace: "demo", context: scoped, query });
    try {
      for (const path of [url, url.replace("issues/", "issues-detail/")]) {
        assert.equal(matchesNativeListRequest(path, "demo", scoped, params), true);
        const read = nativeListReadParams(path, params);
        assert.deepEqual(JSON.parse(String(read.hentis_query)), { context: scoped, query });
        assert.equal(read[scope], scoped.target);
        for (const foreign of [
          page,
          { ...params, [scope]: "other" },
          { ...params, [scope]: `${scoped.target},other` },
          { ...params, [scope]: [scoped.target] },
        ])
          assert.equal(matchesNativeListRequest(path, "demo", scoped, foreign), false);
      }
    } finally {
      unbind();
    }
  }
});

test("module custom-group pagination retains its module filter and descending criteria", () => {
  const scoped = { ...context, scope: "module", target: "module-one" };
  const query = normalizeListQuery({
    group_by: "sector",
    sorts: [{ field: "sector", direction: "desc", nulls: "last" }],
  });
  const unbind = bindNativeList({ identity: "module-grouped", workspace: "demo", context: scoped, query });
  try {
    nativeListReadParams(url, { ...page, module: scoped.target, filters: "native-filter", group_by: "state_id" });
    withNativeListGroup("module-grouped", "finance", () => {
      const next = nativeListReadParams(url, { ...page, cursor: "25:1:0", module: scoped.target });
      assert.equal(next.module, scoped.target);
      assert.equal(next.filters, "native-filter");
      assert.equal(next.hentis_group, "finance");
      assert.equal(next.group_by, "hentis_custom");
      assert.equal(next.cursor, "25:1:0");
      assert.deepEqual(JSON.parse(String(next.hentis_query)).query.sorts, query.sorts);
    });
  } finally {
    unbind();
  }
});

test("custom group next pages retain original native filters and strip transient grouping", () => {
  const unbind = bindNativeList({
    identity: "custom",
    workspace: "demo",
    context,
    query: { group_by: "field", subtasks: "separate" },
  });
  try {
    const initial = nativeListReadParams(url, {
      ...page,
      priority: "high",
      group_by: "state_id",
      sub_group_by: "priority",
    });
    assert.equal(initial.group_by, "hentis_custom");
    assert.equal(initial.sub_issue, "true");
    assert.equal(initial.sub_group_by, undefined);
    withNativeListGroup("custom", "option", () => {
      const next = nativeListReadParams(url, { ...page, cursor: "25:1:0" });
      assert.equal(next.hentis_group, "option");
      assert.equal(next.priority, "high");
      assert.equal(next.cursor, "25:1:0");
    });
    assert.equal(nativeListReadParams(url, page).hentis_group, undefined);
  } finally {
    unbind();
  }
  assert.deepEqual(nativeListReadParams(url, page), page);
});

test("native group next page adds group restriction while summary keeps the whole result scope", () => {
  const unbind = bindNativeList({
    identity: "native",
    workspace: "demo",
    context,
    query: { native_group: "priority", subtasks: "collapsed" },
  });
  try {
    nativeListReadParams(url, { ...page, state: "todo", group_by: "state_id" });
    withNativeListGroup("native", "urgent", () => {
      const next = nativeListReadParams(url, { ...page, cursor: "25:1:0" });
      assert.equal(next.priority, "urgent");
      assert.equal(next.state, "todo");
      assert.equal(next.group_by, undefined);
    });
    const base = nativeListBaseParams("native");
    assert.equal(base.state, "todo");
    assert.equal(base.priority, undefined);
    assert.equal(base.cursor, undefined);
    assert.equal(base.sub_issue, "false");
  } finally {
    unbind();
  }
});

test("an old effect cleanup cannot remove a newer binding with the same identity", () => {
  const old = bindNativeList({ identity: "same", workspace: "demo", context, query: { search: "old" } });
  const current = bindNativeList({ identity: "same", workspace: "demo", context, query: { search: "new" } });
  old();
  try {
    assert.equal(JSON.parse(nativeListReadParams(url, page).hentis_query as string).query.search, "new");
  } finally {
    current();
  }
});

test("a failed group callback always releases the temporary group constraint", () => {
  const unbind = bindNativeList({ identity: "throws", workspace: "demo", context, query: { group_by: "field" } });
  try {
    nativeListReadParams(url, page);
    assert.throws(() =>
      withNativeListGroup("throws", "option", () => {
        throw new Error("expected");
      })
    );
    assert.equal(nativeListReadParams(url, page).hentis_group, undefined);
  } finally {
    unbind();
  }
});
