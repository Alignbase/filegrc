import assert from "node:assert/strict";
import test from "node:test";
import { formatCalendarDate, formatLocalDateTime, isRfc3339Timestamp } from "../src/time.js";

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

test("accepts only real RFC 3339 timestamps", () => {
  assert.equal(isRfc3339Timestamp("2026-07-25T16:30:00-05:00"), true);
  assert.equal(isRfc3339Timestamp("2026-02-30T16:30:00Z"), false);
  assert.equal(isRfc3339Timestamp("2026-07-25T24:00:00Z"), false);
  assert.equal(isRfc3339Timestamp("2026-07-25T16:30:00"), false);
});
