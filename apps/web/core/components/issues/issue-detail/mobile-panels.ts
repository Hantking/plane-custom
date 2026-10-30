/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export const ISSUE_MOBILE_PANELS = ["content", "properties", "comments", "attachments"] as const;
export type IssueMobilePanel = (typeof ISSUE_MOBILE_PANELS)[number];
export type IssueMobilePanelState = { issueId: string; panel: IssueMobilePanel };

export function isIssueMobileViewport(width: number): boolean {
  return Number.isFinite(width) && width > 0 && width < 768;
}

export function resolveIssueMobilePanel(state: IssueMobilePanelState, issueId: string): IssueMobilePanel {
  return state.issueId === issueId ? state.panel : "content";
}

export function adjacentIssueMobilePanel(panel: IssueMobilePanel, key: string): IssueMobilePanel | undefined {
  const index = ISSUE_MOBILE_PANELS.indexOf(panel);
  if (key === "Home") return ISSUE_MOBILE_PANELS[0];
  if (key === "End") return ISSUE_MOBILE_PANELS[ISSUE_MOBILE_PANELS.length - 1];
  if (key === "ArrowRight") return ISSUE_MOBILE_PANELS[(index + 1) % ISSUE_MOBILE_PANELS.length];
  if (key === "ArrowLeft")
    return ISSUE_MOBILE_PANELS[(index - 1 + ISSUE_MOBILE_PANELS.length) % ISSUE_MOBILE_PANELS.length];
  return undefined;
}
