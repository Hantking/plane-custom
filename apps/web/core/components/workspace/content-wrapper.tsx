/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
// plane imports
import { cn } from "@plane/utils";
import { AppRailRoot } from "@/components/navigation";
import { useAppRailVisibility } from "@/lib/app-rail";
import { TopNavigationRoot } from "@/components/navigation/top-navigation-root";
import { MobileNavigationProvider, useMobileNavigation } from "@/components/mobile/navigation-context";
import { MobileWorkspaceNavigation } from "@/components/mobile/workspace-navigation";

export const WorkspaceContentWrapper = observer(function WorkspaceContentWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MobileNavigationProvider>
      <WorkspaceContent>{children}</WorkspaceContent>
    </MobileNavigationProvider>
  );
});

const WorkspaceContent = observer(function WorkspaceContent({ children }: { children: React.ReactNode }) {
  // Use the context to determine if app rail should render
  const { shouldRenderAppRail } = useAppRailVisibility();
  const navigation = useMobileNavigation();
  const showDesktopRail = shouldRenderAppRail && !navigation?.isMobile;

  return (
    <div
      data-mobile-workspace-shell
      className="relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-canvas transition-all duration-300 ease-in-out"
    >
      <TopNavigationRoot />
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* Conditionally render AppRailRoot based on context */}
        {showDesktopRail && <AppRailRoot />}
        <div
          className={cn(
            "relative min-h-0 min-w-0 flex-1 overflow-hidden transition-all duration-300 ease-in-out md:pr-2 md:pb-2 md:pl-2",
            {
              "pl-0!": showDesktopRail,
            }
          )}
        >
          {children}
        </div>
      </div>
      <MobileWorkspaceNavigation />
    </div>
  );
});
