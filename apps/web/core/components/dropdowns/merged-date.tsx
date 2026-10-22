/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
// helpers
import { renderFormattedDate } from "@plane/utils";
import { RelativeDate } from "@/components/dates/relative-date";

type Props = {
  startDate: Date | string | null | undefined;
  endDate: Date | string | null | undefined;
  className?: string;
};

/**
 * Displays each selected endpoint with the shared relative label and its own color.
 */
export const MergedDateDisplay = observer(function MergedDateDisplay(props: Props) {
  const { startDate, endDate, className = "" } = props;

  if (!startDate && !endDate) {
    return null;
  }

  return (
    <span className={className}>
      {startDate && <RelativeDate value={startDate} normalText={renderFormattedDate(startDate)} />}
      {startDate && endDate && " – "}
      {endDate && <RelativeDate value={endDate} normalText={renderFormattedDate(endDate)} />}
    </span>
  );
});
