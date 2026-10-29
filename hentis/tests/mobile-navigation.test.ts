import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mobileWorkspaceHref,
  uniqueMobileNavigationItems,
} from "../../apps/web/core/components/mobile/navigation-helpers";

test("workspace navigation exposes all native areas even when desktop entries are unpinned", () => {
  const staticItems = [{ key: "home" }, { key: "projects" }, { key: "drafts" }, { key: "your_work" }];
  const dynamicItems = [{ key: "views" }, { key: "analytics" }, { key: "archives" }, { key: "projects" }];
  assert.deepEqual(
    uniqueMobileNavigationItems([...staticItems, ...dynamicItems]).map((item) => item.key),
    ["home", "projects", "drafts", "your_work", "views", "analytics", "archives"]
  );
});

test("mobile routes retain native workspace and nested View destinations", () => {
  assert.equal(mobileWorkspaceHref("hentis", { key: "home", href: "/" }), "/hentis/");
  assert.equal(
    mobileWorkspaceHref("hentis", { key: "views", href: "/workspace-views/all-issues/" }),
    "/hentis/workspace-views/all-issues/"
  );
  assert.equal(
    mobileWorkspaceHref("hentis", { key: "archives", href: "/projects/archives/" }),
    "/hentis/projects/archives/"
  );
});

test("personal work uses the current user's real profile route", () => {
  assert.equal(
    mobileWorkspaceHref("hentis", { key: "your_work", href: "/profile/" }, "member-uuid"),
    "/hentis/profile/member-uuid/"
  );
  assert.equal(
    mobileWorkspaceHref("hentis", { key: "projects", href: "/projects/" }, "member-uuid"),
    "/hentis/projects/"
  );
});

test("route values cannot introduce an extra workspace path or query string", () => {
  assert.equal(mobileWorkspaceHref("team/name", { key: "home", href: "/" }), "/team%2Fname/");
  assert.equal(
    mobileWorkspaceHref("team", { key: "your_work", href: "/profile/" }, "user?scope=all"),
    "/team/profile/user%3Fscope%3Dall/"
  );
});
