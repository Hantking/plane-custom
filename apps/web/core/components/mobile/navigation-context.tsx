/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { MOBILE_NAVIGATION_QUERY } from "./navigation-helpers";

function subscribeToViewport(onChange: () => void) {
  const query = window.matchMedia(MOBILE_NAVIGATION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useMobileViewport() {
  return useSyncExternalStore(
    subscribeToViewport,
    () => window.matchMedia(MOBILE_NAVIGATION_QUERY).matches,
    () => false
  );
}

type MobileNavigationState = {
  isOpen: boolean;
  isMobile: boolean;
  open: () => void;
  close: () => void;
};

const MobileNavigationContext = createContext<MobileNavigationState | null>(null);

export function MobileNavigationProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const isMobile = useMobileViewport();
  const pathname = usePathname();
  const close = useCallback(() => setIsOpen(false), []);
  const open = useCallback(() => setIsOpen(true), []);

  useEffect(() => {
    close();
  }, [pathname, isMobile, close]);

  const value = useMemo(() => ({ isOpen, isMobile, open, close }), [isOpen, isMobile, open, close]);
  return <MobileNavigationContext.Provider value={value}>{children}</MobileNavigationContext.Provider>;
}

export const useMobileNavigation = () => useContext(MobileNavigationContext);
