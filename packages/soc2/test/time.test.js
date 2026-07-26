import assert from "node:assert/strict";
import test from "node:test";
import { formatCalendarDate, formatLocalDateTime } from "../src/time.js";

test("keeps calendar dates stable across local time zones", () => {
  assert.equal(formatCalendarDate("2026-06-15", "en-US"), "Jun 15, 2026");
  assert.equal(formatCalendarDate("2026-02-30", "en-US"), "2026-02-30");
  assert.equal(formatCalendarDate("not-a-date", "en-US"), "not-a-date");
});

test("converts timestamps to the requested local time zone", () => {
  const timestamp = "2026-06-15T15:30:00Z";
  const chicago = formatLocalDateTime(timestamp, "en-US", "America/Chicago");
  const tokyo = formatLocalDateTime(timestamp, "en-US", "Asia/Tokyo");

  assert.match(chicago, /Jun 15, 2026/);
  assert.match(chicago, /10:30:00 AM/);
  assert.match(tokyo, /Jun 16, 2026/);
  assert.match(tokyo, /12:30:00 AM/);
  assert.equal(formatLocalDateTime("not-a-time", "en-US", "UTC"), "not-a-time");
});
