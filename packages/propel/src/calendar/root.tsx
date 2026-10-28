/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as React from "react";
import { DayPicker } from "react-day-picker";
import { ChevronLeftIcon } from "../icons/arrows/chevron-left";

import { cn } from "../utils";
import { weekdayLabel } from "./weekday-label";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

export function Calendar({ className, showOutsideDays = true, formatters, ...props }: CalendarProps) {
  const currentYear = new Date().getFullYear();
  const thirtyYearsAgoFirstDay = new Date(currentYear - 30, 0, 1);
  const thirtyYearsFromNowFirstDay = new Date(currentYear + 30, 11, 31);

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      weekStartsOn={props.weekStartsOn}
      components={{
        Chevron: ({ className: iconClassName, ...iconProps }) => (
          <ChevronLeftIcon
            className={cn(
              "size-4",
              { "rotate-180": iconProps.orientation === "right", "-rotate-90": iconProps.orientation === "down" },
              iconClassName
            )}
            {...iconProps}
          />
        ),
      }}
      startMonth={thirtyYearsAgoFirstDay}
      endMonth={thirtyYearsFromNowFirstDay}
      formatters={{ formatWeekdayName: (date) => weekdayLabel(date.getDay()), ...formatters }}
      {...props}
    />
  );
}
