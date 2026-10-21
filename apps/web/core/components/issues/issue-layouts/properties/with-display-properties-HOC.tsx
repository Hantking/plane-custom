/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { observer } from "mobx-react";
import type { IIssueDisplayProperties } from "@plane/types";
import { useNativePropertyPlacement } from "@/components/custom-fields/native-layout";

interface IWithDisplayPropertiesHOC {
  displayProperties: IIssueDisplayProperties;
  shouldRenderProperty?: (displayProperties: IIssueDisplayProperties) => boolean;
  displayPropertyKey: keyof IIssueDisplayProperties | (keyof IIssueDisplayProperties)[];
  children: ReactNode;
}

export const WithDisplayPropertiesHOC = observer(function WithDisplayPropertiesHOC({
  displayProperties,
  shouldRenderProperty,
  displayPropertyKey,
  children,
}: IWithDisplayPropertiesHOC) {
  const order = useNativePropertyPlacement(displayPropertyKey);
  let shouldDisplayPropertyFromFilters = false;
  if (Array.isArray(displayPropertyKey))
    shouldDisplayPropertyFromFilters = displayPropertyKey.every((key) => !!displayProperties[key]);
  else shouldDisplayPropertyFromFilters = !!displayProperties[displayPropertyKey];

  const renderProperty =
    shouldDisplayPropertyFromFilters && (shouldRenderProperty ? shouldRenderProperty(displayProperties) : true);

  if (!renderProperty) return null;

  return order === undefined ? (
    <>{children}</>
  ) : (
    <div className="inline-flex min-w-0" style={{ order }}>
      {children}
    </div>
  );
});
