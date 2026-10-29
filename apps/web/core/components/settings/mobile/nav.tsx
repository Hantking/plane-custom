/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";
import { Dialog } from "@headlessui/react";
import { observer } from "mobx-react";
import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslation } from "@plane/i18n";
import { ChevronRightIcon } from "@plane/propel/icons";
import { useUserSettings } from "@/hooks/store/user";
import useSize from "@/hooks/use-window-size";

type Props = {
  hamburgerContent: React.ComponentType<{ className?: string; isMobile?: boolean }>;
  activePath: string;
};

export const SettingsMobileNav = observer(function SettingsMobileNav(props: Props) {
  const { hamburgerContent: HamburgerContent, activePath } = props;
  // refs
  const closeRef = useRef<HTMLButtonElement>(null);
  // store hooks
  const { sidebarCollapsed, toggleSidebar } = useUserSettings();
  const { t } = useTranslation();
  const pathname = usePathname();
  const [width] = useSize();
  useEffect(() => {
    toggleSidebar(true);
  }, [pathname, toggleSidebar]);

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-subtle px-4 py-2 md:hidden">
      <button
        type="button"
        className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-subtle"
        aria-label={t("settings")}
        aria-expanded={!sidebarCollapsed}
        onClick={() => toggleSidebar(false)}
      >
        <Menu className="size-5" />
      </button>
      <Dialog
        open={width < 768 && !sidebarCollapsed}
        onClose={() => toggleSidebar(true)}
        initialFocus={closeRef}
        className="relative z-[80]"
      >
        <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
        <Dialog.Panel
          data-mobile-settings-menu
          className="shadow-xl fixed inset-y-0 left-0 flex w-[min(23rem,100vw)] flex-col overflow-hidden bg-surface-1"
          style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-subtle p-3">
            <Dialog.Title className="text-16 font-semibold">{t("settings")}</Dialog.Title>
            <button
              ref={closeRef}
              type="button"
              className="flex size-11 items-center justify-center rounded-lg"
              aria-label={t("close")}
              onClick={() => toggleSidebar(true)}
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <HamburgerContent className="w-full border-0 pb-5" isMobile />
          </div>
        </Dialog.Panel>
      </Dialog>
      {/* path */}
      <div className="flex items-center gap-2">
        <ChevronRightIcon className="size-4 text-tertiary" />
        <span className="text-13 font-medium text-secondary">{t(activePath)}</span>
      </div>
    </div>
  );
});
