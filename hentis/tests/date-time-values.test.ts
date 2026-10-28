import assert from "node:assert/strict";
import { test } from "node:test";
import { dateTimeParts, dateTimeValue } from "../../apps/web/core/components/custom-fields/date-time-value";
import { weekdayLabel } from "../../packages/propel/src/calendar/weekday-label";

test("date and optional clock remain separate without UTC shifts or invented midnight", () => {
  assert.deepEqual(dateTimeParts("2026-11-10"), { date: "2026-11-10", time: "" });
  assert.deepEqual(dateTimeParts("2026-11-10T00:00"), { date: "2026-11-10", time: "00:00" });
  assert.deepEqual(dateTimeParts("2026-11-10T23:59"), { date: "2026-11-10", time: "23:59" });
  assert.equal(dateTimeValue("2026-11-10", "09:30"), "2026-11-10T09:30");
  assert.equal(dateTimeValue("2026-11-10", ""), "2026-11-10");
  assert.equal(dateTimeValue("", "09:30"), null);
  for (const value of [null, "", "09:30", "2026-11-10T09:30Z"])
    assert.deepEqual(dateTimeParts(value), { date: "", time: "" });
});

test("weekday labels identify weekdays regardless of which day starts the calendar", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 0].map(weekdayLabel), ["2ª", "3ª", "4ª", "5ª", "6ª", "sá", "do"]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(weekdayLabel), ["do", "2ª", "3ª", "4ª", "5ª", "6ª", "sá"]);
});
