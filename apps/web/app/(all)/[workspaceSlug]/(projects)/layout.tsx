/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { Outlet } from "react-router";
import { ProjectsAppPowerKProvider } from "@/components/power-k/projects-app-provider";
// plane web components
import { ProjectAppSidebar } from "./_sidebar";
import { ExtendedProjectSidebar } from "./extended-project-sidebar";
import { useMobileNavigation } from "@/components/mobile/navigation-context";

function WorkspaceLayout() {
  const mobileNavigation = useMobileNavigation();
  return (
    <>
      <ProjectsAppPowerKProvider />
      <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden md:rounded-lg md:border md:border-subtle">
        <div id="full-screen-portal" className="absolute inset-0 w-full" />
        <div className="relative flex size-full overflow-hidden">
          <ProjectAppSidebar />
          {!mobileNavigation?.isMobile && <ExtendedProjectSidebar />}
          <main className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-1">
            <Outlet />
          </main>
        </div>
      </div>
    </>
  );
}

export default observer(WorkspaceLayout);
