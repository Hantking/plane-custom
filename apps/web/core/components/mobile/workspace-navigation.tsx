/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
import { Dialog } from "@headlessui/react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { ChevronDown, Inbox, Menu, Plus, Search, Settings, Sparkles, UserRound, X } from "lucide-react";
import {
  EUserPermissions,
  EUserPermissionsLevel,
  WORKSPACE_SIDEBAR_DYNAMIC_NAVIGATION_ITEMS,
  WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS,
} from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
import { CreateUpdateIssueModal } from "@/components/issues/issue-modal/modal";
import { usePlaneAI } from "@/components/plane-ai/panel";
import { SidebarFavoritesMenu } from "@/components/workspace/sidebar/favorites/favorites-menu";
import { getSidebarNavigationItemIcon } from "@/components/workspace/sidebar/helper";
import { ProjectNavigation } from "@/components/workspace/sidebar/project-navigation";
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { useProject } from "@/hooks/store/use-project";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUser, useUserPermissions } from "@/hooks/store/user";
import { mobileWorkspaceHref, uniqueMobileNavigationItems } from "./navigation-helpers";
import { useMobileNavigation } from "./navigation-context";

const navigationItemClass =
  "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-14 text-secondary hover:bg-layer-transparent-hover focus-visible:outline-2 focus-visible:outline-offset-2";

/** Mobile navigation uses the same routes, stores, forms and permission gates as desktop. */
export const MobileWorkspaceNavigation = observer(function MobileWorkspaceNavigation() {
  const navigation = useMobileNavigation();
  const { workspaceSlug, projectId } = useParams();
  const slug = workspaceSlug?.toString() || "";
  const pathname = usePathname();
  const { t } = useTranslation();
  const { data: user } = useUser();
  const { currentWorkspace } = useWorkspace();
  const { joinedProjectIds, getPartialProjectById } = useProject();
  const { allowPermissions } = useUserPermissions();
  const { toggleProfileSettingsModal } = useCommandPalette();
  const ai = usePlaneAI();
  const [isCreateOpen, setCreateOpen] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const items = uniqueMobileNavigationItems([
    ...Object.values(WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS),
    ...Object.values(WORKSPACE_SIDEBAR_DYNAMIC_NAVIGATION_ITEMS),
  ]).filter((item) => allowPermissions(item.access, EUserPermissionsLevel.WORKSPACE, slug));
  const canCreate =
    joinedProjectIds.length > 0 &&
    allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.WORKSPACE);
  const canViewWorkspaceFeatures = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE
  );

  if (!navigation || !slug) return null;

  const close = navigation.close;
  const openSearch = () => {
    close();
    document.querySelector<HTMLButtonElement>("[data-native-workspace-search-trigger]")?.click();
  };
  const openCreate = () => {
    close();
    setCreateOpen(true);
  };

  return (
    <>
      <CreateUpdateIssueModal
        isOpen={isCreateOpen}
        onClose={() => setCreateOpen(false)}
        data={projectId ? { project_id: projectId.toString() } : undefined}
      />
      <nav
        data-mobile-navigation
        aria-label="Navegação do Plane"
        className="relative z-30 grid shrink-0 grid-cols-4 gap-1 border-t border-subtle bg-surface-1 px-2 pt-1.5 md:hidden"
        style={{ paddingBottom: "max(6px, env(safe-area-inset-bottom))" }}
      >
        <button
          type="button"
          className="mobile-nav-action"
          aria-expanded={navigation.isOpen}
          aria-controls="mobile-workspace-menu"
          onClick={navigation.open}
        >
          <Menu className="size-5" />
          <span>Menu</span>
        </button>
        <button type="button" className="mobile-nav-action" onClick={openSearch}>
          <Search className="size-5" />
          <span>{t("search")}</span>
        </button>
        <Link
          href={`/${slug}/notifications/`}
          className={cn(
            "mobile-nav-action",
            pathname.includes("/notifications") && "bg-layer-transparent-active text-primary"
          )}
          aria-label={t("notification.label")}
        >
          <Inbox className="size-5" />
          <span>{t("notification.label")}</span>
        </Link>
        <button
          type="button"
          className="mobile-nav-action"
          onClick={openCreate}
          disabled={!canCreate}
          aria-label={t("sidebar.new_work_item")}
        >
          <Plus className="size-5" />
          <span>{t("common.create")}</span>
        </button>
      </nav>
      <Dialog
        open={navigation.isMobile && navigation.isOpen}
        onClose={close}
        initialFocus={closeButton}
        className="relative z-[60] md:hidden"
      >
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" data-mobile-menu-backdrop />
        <Dialog.Panel
          id="mobile-workspace-menu"
          data-mobile-menu
          className="shadow-xl fixed inset-y-0 left-0 flex w-[min(23rem,calc(100vw-1rem))] flex-col overflow-hidden border-r border-subtle bg-surface-1"
          style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest("a[href]")) close();
          }}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-subtle p-4">
            <div className="min-w-0">
              <Dialog.Title className="text-16 font-semibold text-primary">Menu</Dialog.Title>
              <p className="truncate text-12 text-tertiary">{currentWorkspace?.name}</p>
            </div>
            <button
              ref={closeButton}
              type="button"
              className="flex size-11 items-center justify-center rounded-xl border border-subtle"
              onClick={close}
              aria-label={t("close")}
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3" data-mobile-menu-content>
            <div className="space-y-1">
              {items.map((item) => {
                const href = mobileWorkspaceHref(slug, item, user?.id);
                const active = item.highlight(pathname, href);
                return (
                  <Link
                    key={item.key}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(navigationItemClass, active && "bg-layer-transparent-active text-primary")}
                  >
                    {getSidebarNavigationItemIcon(item.key, "size-5")}
                    <span>{t(item.labelTranslationKey)}</span>
                  </Link>
                );
              })}
              {canViewWorkspaceFeatures && (
                <Link href={`/${slug}/active-cycles/`} className={navigationItemClass}>
                  {getSidebarNavigationItemIcon("active_cycles", "size-5")}
                  <span>{t("active_cycles")}</span>
                </Link>
              )}
              {ai?.enabled && (
                <button
                  type="button"
                  className={navigationItemClass}
                  onClick={() => {
                    close();
                    ai.open();
                  }}
                >
                  <Sparkles className="size-5" />
                  <span>Plane AI</span>
                </button>
              )}
            </div>
            {canViewWorkspaceFeatures && (
              <div className="mt-4 border-t border-subtle pt-3">
                <SidebarFavoritesMenu />
              </div>
            )}
            <section className="mt-4 border-t border-subtle pt-3" aria-label={t("projects")}>
              <div className="flex items-center justify-between px-3 py-2">
                <h3 className="text-12 font-semibold text-tertiary">{t("projects")}</h3>
                <Link href={`/${slug}/projects/`} className="rounded-lg px-2 py-1 text-12 text-secondary">
                  {t("common.view")}
                </Link>
              </div>
              {joinedProjectIds.map((id) => {
                const project = getPartialProjectById(id);
                if (!project) return null;
                return (
                  <details
                    key={id}
                    open={id === projectId?.toString()}
                    className="mobile-project-navigation rounded-xl border border-subtle bg-layer-1/20 [&+details]:mt-2"
                  >
                    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-14 font-medium text-primary">
                      <span className="truncate">{project.name}</span>
                      <ChevronDown className="size-4 shrink-0" />
                    </summary>
                    <div className="space-y-1 border-t border-subtle p-2">
                      <ProjectNavigation workspaceSlug={slug} projectId={id} onNavigate={close} />
                      <Link href={`/${slug}/settings/projects/${id}/`} className={navigationItemClass}>
                        <Settings className="size-4" />
                        <span>{t("settings")}</span>
                      </Link>
                    </div>
                  </details>
                );
              })}
              {joinedProjectIds.length === 0 && (
                <Link href={`/${slug}/projects/`} className={navigationItemClass}>
                  {t("projects")}
                </Link>
              )}
            </section>
            <div className="mt-4 space-y-1 border-t border-subtle pt-3">
              <Link href={`/${slug}/settings/`} className={navigationItemClass}>
                <Settings className="size-5" />
                <span>{t("workspace_settings.label")}</span>
              </Link>
              <button
                type="button"
                className={navigationItemClass}
                onClick={() => {
                  close();
                  toggleProfileSettingsModal({ isOpen: true, activeTab: "general" });
                }}
              >
                <UserRound className="size-5" />
                <span>{t("profile.label")}</span>
              </button>
            </div>
          </div>
        </Dialog.Panel>
      </Dialog>
    </>
  );
});
