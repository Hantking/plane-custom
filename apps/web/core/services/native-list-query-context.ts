// The native issue services still perform pagination and hydrate their full DTOs.
// Bind only the mounted, authorized List context; detail/search/editor requests are untouched.
export type ListRequestContext = { scope: string; target: string; project_id?: string; layout: string };
type Binding = {
  identity: string;
  workspace: string;
  context: ListRequestContext;
  query: object;
  base?: Record<string, unknown>;
  pageGroup?: string;
};
const bindings = new Map<string, Binding>();
const groupFields: Record<string, string> = {
  state: "state_id",
  priority: "priority",
  assignees: "assignees__id",
  labels: "labels__id",
  cycle: "cycle_id",
  module: "issue_module__module_id",
  project: "project_id",
  created_by: "created_by",
};
const groupFilters: Record<string, string> = {
  state_id: "state",
  priority: "priority",
  assignees__id: "assignees",
  labels__id: "labels",
  cycle_id: "cycle",
  issue_module__module_id: "module",
  project_id: "project",
  created_by: "created_by",
};

export function matchesNativeListRequest(
  url: string,
  workspace: string,
  context: ListRequestContext,
  params: Record<string, unknown>
) {
  if (!params.cursor || !params.per_page || context.layout !== "list") return false;
  const root = `/api/workspaces/${encodeURIComponent(workspace)}/`;
  if (!url.startsWith(root)) return false;
  const path = url.slice(root.length);
  if (["workspace_view", "workspace_builtin"].includes(context.scope)) return /^(issues|issues-detail)\/$/.test(path);
  if (!context.project_id) return false;
  const project = `projects/${context.project_id}/`;
  if (!path.startsWith(project)) return false;
  const rest = path.slice(project.length);
  if (context.scope === "module") return rest === `modules/${context.target}/issues/`;
  if (context.scope === "cycle") return rest === `cycles/${context.target}/cycle-issues/`;
  if (context.scope === "archive") return /^(archived-issues|archives)\/$/.test(rest);
  return /^(issues|issues-detail)\/$/.test(rest);
}

export function bindNativeList(binding: Omit<Binding, "base" | "pageGroup">) {
  const value = { ...binding };
  bindings.set(binding.identity, value);
  return () => {
    if (bindings.get(binding.identity) === value) bindings.delete(binding.identity);
  };
}

export function nativeListReadParams(url: string, params: Record<string, unknown> = {}) {
  const activeBindings = [...bindings.values()];
  for (let index = activeBindings.length - 1; index >= 0; index--) {
    const binding = activeBindings[index];
    if (!matchesNativeListRequest(url, binding.workspace, binding.context, params)) continue;
    const query = binding.query as { group_by?: string; subtasks?: string; native_group?: string };
    let result = { ...params };
    if (binding.pageGroup && binding.base)
      result = { ...binding.base, cursor: params.cursor, per_page: params.per_page };
    else binding.base = { ...params };
    result.hentis_query = JSON.stringify({ context: binding.context, query: binding.query });
    result.sub_issue = query.subtasks === "separate" ? "true" : "false";
    if (query.native_group && query.native_group !== "inherit") {
      if (query.native_group === "none") delete result.group_by;
      else result.group_by = groupFields[query.native_group];
    }
    delete result.sub_group_by;
    result.hentis_native_group = result.group_by ?? "";
    if (query.group_by) {
      result.group_by = "hentis_custom";
      delete result.sub_group_by;
      result.per_page = 25;
      if (binding.pageGroup) result.hentis_group = binding.pageGroup;
    } else if (binding.pageGroup) {
      const field = typeof result.group_by === "string" ? groupFilters[result.group_by] : undefined;
      if (field) result[field] = binding.pageGroup;
      result.hentis_group = binding.pageGroup;
      delete result.group_by;
    }
    return result;
  }
  return params;
}

export function nativeListBaseParams(identity: string) {
  const binding = bindings.get(identity);
  const value = binding?.base ?? {};
  const result = Object.fromEntries(
    Object.entries(value).filter(([key]) => !["cursor", "per_page", "hentis_query", "hentis_group"].includes(key))
  );
  if (binding) result.sub_issue = (binding.query as { subtasks?: string }).subtasks === "separate" ? "true" : "false";
  return result;
}

export function withNativeListGroup(identity: string, group: string | undefined, callback: () => void) {
  const binding = bindings.get(identity);
  if (binding) binding.pageGroup = group;
  try {
    callback();
  } finally {
    if (binding) binding.pageGroup = undefined;
  }
}
