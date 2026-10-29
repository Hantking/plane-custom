const USER = "22222222-2222-4222-8222-222222222222";
const WORKSPACE = "88888888-8888-4888-8888-888888888888";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const ISSUE = "66666666-6666-4666-8666-666666666666";
const STATE = "33333333-3333-4333-8333-333333333333";
const FIELD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const timestamps = { created_at: "2026-10-01T12:00:00Z", updated_at: "2026-10-01T12:00:00Z" };
const user = {
  id: USER,
  display_name: "João Teste",
  first_name: "João",
  last_name: "Teste",
  email: "teste@example.invalid",
  avatar_url: "",
  is_password_autoset: false,
  is_email_verified: true,
  is_active: true,
  is_staff: false,
  date_joined: timestamps.created_at,
};
const workspace = {
  id: WORKSPACE,
  slug: "hentis",
  name: "Hentis Teste",
  logo_url: "",
  owner: USER,
  total_members: 1,
  total_projects: 1,
};
const project = {
  id: PROJECT,
  workspace: WORKSPACE,
  name: "Projeto Completo",
  identifier: "HNT",
  description: "Projeto de teste",
  network: 2,
  member_role: 20,
  is_member: true,
  is_favorite: false,
  cover_image_url: "",
  logo_props: { icon: { name: "", color: "" } },
  cycle_view: true,
  module_view: true,
  page_view: true,
  issue_views_view: true,
  inbox_view: true,
  estimate: null,
  guest_view_all_features: true,
  archived_at: null,
  sort_order: 1000,
  next_work_item_sequence: 2,
  ...timestamps,
};
const field = {
  id: FIELD,
  project_id: PROJECT,
  project_identifier: "HNT",
  name: "Pendência principal",
  kind: "long_text",
  required: false,
  active: true,
  options: [],
  position: 0,
};
const state = {
  id: STATE,
  name: "A fazer real",
  group: "unstarted",
  color: "#716879",
  sequence: 1,
  default: true,
  project: PROJECT,
  project_id: PROJECT,
  workspace: WORKSPACE,
};
const paginated = (rows) => ({
  results: rows,
  total_results: rows.length,
  count: rows.length,
  next_cursor: "100:1:0",
  next_page_results: false,
  prev_page_results: false,
  prev_cursor: "",
  total_pages: 1,
  extra_stats: {},
});

function fixture() {
  return {
    user: { ...user },
    workspace: { ...workspace },
    project: { ...project },
    field: { ...field },
    calls: [],
    unknown: [],
    writes: [],
    fields: { [FIELD]: "Valor original" },
    issue: {
      id: ISSUE,
      name: "Tarefa completa nativa",
      project_id: PROJECT,
      workspace_id: WORKSPACE,
      state_id: STATE,
      sequence_id: 1,
      priority: "high",
      description_html: "<p>Descrição original da tarefa</p>",
      description_stripped: "Descrição original da tarefa",
      description_binary: null,
      assignee_ids: [USER],
      label_ids: [],
      module_ids: [],
      cycle_id: null,
      parent_id: null,
      estimate_point: null,
      start_date: null,
      target_date: null,
      start_time: null,
      target_time: null,
      schedule_timezone: "America/Sao_Paulo",
      completed_at: null,
      archived_at: null,
      created_by: USER,
      updated_by: USER,
      sub_issues_count: 0,
      attachment_count: 0,
      link_count: 0,
      is_draft: false,
      is_epic: false,
      issue_relation: [],
      issue_related: [],
      ...timestamps,
    },
  };
}

async function installFixtures(page, data, origin) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const path = url.pathname;
    let body;
    try {
      body = request.postDataJSON();
    } catch {}
    data.calls.push({ method: request.method(), path, search: url.search });
    if (!["GET", "HEAD"].includes(request.method())) data.writes.push({ method: request.method(), path, body });
    const json = (response, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(response) });
    const prefix = `/api/workspaces/hentis/projects/${PROJECT}`;
    if (path === "/api/instances/")
      return json({
        instance: { id: "instance-test", is_setup_done: true, is_activated: true },
        config: {
          enable_signup: true,
          is_email_password_enabled: true,
          is_google_enabled: false,
          is_github_enabled: false,
          is_smtp_configured: false,
          file_size_limit: 5242880,
          app_base_url: null,
          has_llm_configured: false,
        },
      });
    if (path === "/api/users/me/") return json(data.user);
    if (path === "/api/users/me/profile/")
      return json({
        id: USER,
        user: USER,
        is_onboarded: true,
        is_tour_completed: true,
        theme: { theme: "dark" },
        onboarding_step: {
          profile_complete: true,
          workspace_create: true,
          workspace_invite: true,
          workspace_join: true,
        },
        timezone: "America/Sao_Paulo",
        language: data.language || "en",
      });
    if (path === "/api/users/me/settings/")
      return json({
        id: USER,
        workspace: { last_workspace_slug: "hentis", fallback_workspace_slug: "hentis" },
        preferences: {},
        email_notification: true,
      });
    if (path === "/api/users/me/instance-admin/") return json({ is_instance_admin: false });
    if (path === "/api/users/me/workspaces/") return json([data.workspace]);
    if (path === "/api/users/me/workspaces/hentis/project-roles/") return json({ [PROJECT]: 20 });
    if (path === "/api/workspaces/hentis/") return json(data.workspace);
    if (path.endsWith("/workspace-members/me/"))
      return json({
        id: "membership",
        role: 20,
        member: USER,
        workspace: WORKSPACE,
        is_active: true,
        total_workspace_projects: 1,
      });
    if (path.endsWith("/project-members/me/"))
      return json({ id: "membership", role: 20, member: USER, project: PROJECT, is_active: true });
    if (path === "/api/workspaces/hentis/projects/" || path === "/api/workspaces/hentis/projects/details/")
      return json([data.project]);
    if (path === `${prefix}/`) return json(data.project);
    if (path.endsWith("/members/")) return json([{ id: "membership", member: data.user, role: 20, is_active: true }]);
    if (path.endsWith("/sidebar-preferences/")) return json({});
    if (path.endsWith("/user-properties/"))
      return json({
        preferences: { navigationMode: "ACCORDION" },
        view_props: {},
        display_filters: { layout: "list" },
        display_properties: {},
      });
    if (path.includes("/plane-ai/") || path.includes("/ai/"))
      return json({ enabled: false, connections: [], runs: [], conversations: [] });
    if (path.endsWith("/notifications/unread/")) return json({ count: 0 });
    if (path.endsWith("/notifications/")) return json(paginated([]));
    if (path.endsWith("/states/")) return json([state]);
    if (path.endsWith("/intake/")) return json({ id: STATE, name: "Intake", group: "triage" });
    if (path === `${prefix}/custom-fields/`) return json({ fields: [data.field], can_manage: true, can_edit: true });
    if (path === `${prefix}/custom-fields/issues/${ISSUE}/`) {
      if (request.method() === "PATCH") Object.assign(data.fields, body.values);
      return json({ values: data.fields, history: [] });
    }
    if (path.includes("/custom-fields/native-display/"))
      return json({
        fields: [data.field],
        preference: { order: ["standard:title", `custom:${FIELD}`], visible: [FIELD], widths: {} },
        context_label: "Projeto",
        editable_project_ids: [PROJECT],
        manageable_project_ids: [PROJECT],
      });
    if (path.includes("/custom-fields/native-values/"))
      return json({ values: { [ISSUE]: data.fields }, projects: { [ISSUE]: PROJECT } });
    if (path.includes("/custom-fields/native-list/")) {
      if (path.endsWith("/summary/")) return json({ count: 1, groups: [], selected: 0, calculations: {} });
      return json({ ...paginated([data.issue]), issue_ids: [ISSUE], issues: [data.issue], groups: [] });
    }
    if (path === `/api/workspaces/hentis/work-items/HNT-1/` || path === `${prefix}/issues/${ISSUE}/`) {
      if (request.method() === "PATCH") Object.assign(data.issue, body);
      return json(data.issue);
    }
    if (path === `${prefix}/issues/` || path.endsWith("/issues/list/")) return json(paginated([data.issue]));
    if (path.endsWith(`/issues/${ISSUE}/subscribe/`)) return json({ is_subscribed: false });
    if (path.endsWith("/issue-display-properties/")) return json({});
    if (path.endsWith("/home-preferences/")) return json({ is_overview_enabled: true, widgets: [] });
    if (path.endsWith("/active-cycles/")) return json(paginated([]));
    if (path.includes("/search/")) return json({ issues: [], pages: [], projects: [], cycles: [], modules: [] });
    if (path.endsWith("/project-features/")) return json({});
    data.unknown.push(path);
    return json([]);
  });
}

module.exports = { USER, WORKSPACE, PROJECT, ISSUE, STATE, FIELD, fixture, installFixtures, paginated };
