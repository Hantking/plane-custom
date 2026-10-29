/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export const MOBILE_NAVIGATION_QUERY = "(max-width: 767px)";

/** Include every native entry once, independently of desktop pinning preferences. */
export function uniqueMobileNavigationItems<T extends { key: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.key, item])).values()];
}

export function mobileWorkspaceHref(
  workspaceSlug: string,
  item: { key: string; href: string },
  userId?: string
): string {
  const segments = [workspaceSlug, ...item.href.split("/").filter(Boolean)];
  if (item.key === "your_work" && userId) segments.push(userId);
  return `/${segments.map(encodeURIComponent).join("/")}/`;
}
