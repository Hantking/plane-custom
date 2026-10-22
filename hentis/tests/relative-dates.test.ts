import assert from "node:assert/strict";
import { test } from "node:test";
import { relativeDatePresentation, TODAY_DATE_COLOR } from "../../apps/web/core/components/dates/relative-date-helpers";

const options = { now: new Date("2026-10-21T15:00:00Z"), timeZone: "America/Sao_Paulo" };
const present = (date: string | Date) => relativeDatePresentation(date, options);

test("today, tomorrow and yesterday have the requested labels", () => {
  assert.equal(TODAY_DATE_COLOR, "#B69277");
  assert.equal(present("2026-10-21")?.text, "hoje");
  assert.equal(present("2026-10-21")?.tone, "today");
  assert.equal(present("2026-10-22")?.text, "amanhã");
  assert.equal(present("2026-10-20")?.text, "ontem");
});

test("two through five days ahead show the full Portuguese weekday", () => {
  for (const [date, weekday] of [
    ["2026-10-23", "sexta-feira"],
    ["2026-10-24", "sábado"],
    ["2026-10-25", "domingo"],
    ["2026-10-26", "segunda-feira"],
  ]) {
    assert.equal(present(date)?.text, weekday);
    assert.equal(present(date)?.tone, "normal");
  }
  assert.equal(present("2026-10-27")?.text, "27/10/2026");
  assert.equal(present("2026-10-27")?.relative, false);
});

test("two through five days ago show elapsed calendar days; older dates are red", () => {
  for (let days = 2; days <= 5; days++) {
    const result = present(`2026-10-${21 - days}`);
    assert.equal(result?.text, `há ${days} dias`);
    assert.equal(result?.tone, "normal");
  }
  assert.equal(present("2026-10-15")?.text, "15/10/2026");
  assert.equal(present("2026-10-15")?.tone, "old");
  assert.equal(present("2020-01-01")?.tone, "old");
});

test("date-only values are not shifted into the previous day by timezone conversion", () => {
  assert.equal(present("2026-10-22")?.text, "amanhã");
  assert.equal(present("2026-10-22T01:00:00Z")?.text, "hoje");
  assert.equal(present(new Date(2026, 9, 22))?.text, "amanhã");
});

test("today follows the user's timezone rather than the server or UTC date", () => {
  const now = new Date("2026-10-22T01:00:00Z");
  assert.equal(relativeDatePresentation("2026-10-21", { now, timeZone: "America/Sao_Paulo" })?.text, "hoje");
  assert.equal(relativeDatePresentation("2026-10-21", { now, timeZone: "Asia/Tokyo" })?.text, "ontem");
});

test("daylight saving and month/year boundaries use calendar days, not 24-hour intervals", () => {
  const dst = { now: new Date("2026-03-08T06:30:00Z"), timeZone: "America/New_York" };
  assert.equal(relativeDatePresentation("2026-03-09", dst)?.text, "amanhã");
  assert.equal(relativeDatePresentation("2026-03-06", dst)?.text, "há 2 dias");
  assert.equal(
    relativeDatePresentation("2027-01-01", { now: new Date("2026-12-31T12:00:00Z"), timeZone: "UTC" })?.text,
    "amanhã"
  );
});

test("invalid values have no misleading relative label and do not mutate selected dates", () => {
  for (const date of ["invalid", "", "2026-02-30", "2026-13-01"]) assert.equal(present(date), null);
  assert.equal(present(new Date(Number.NaN)), null);
  const date = new Date(2026, 9, 21);
  const original = date.getTime();
  present(date);
  assert.equal(date.getTime(), original);
});
