/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { PanelLeft } from "lucide-react";
// hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";
import { IconButton } from "@plane/propel/icon-button";
import { useMobileNavigation } from "@/components/mobile/navigation-context";

export const AppSidebarToggleButton = observer(function AppSidebarToggleButton() {
  // store hooks
  const { toggleSidebar, sidebarPeek, toggleSidebarPeek } = useAppTheme();
  const mobileNavigation = useMobileNavigation();

  return (
    <IconButton
      size="base"
      variant="ghost"
      icon={PanelLeft}
      aria-label="Abrir navegação"
      onClick={() => {
        if (mobileNavigation?.isMobile) {
          mobileNavigation.open();
          return;
        }
        if (sidebarPeek) toggleSidebarPeek(false);
        toggleSidebar();
      }}
    />
  );
});
