export function formatCalendarDate(value, locale) {
  const source = String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(source);
  if (!match) return source;
  const [, year, month, day] = match.map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return source;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

export function formatLocalDateTime(value, locale, timeZone) {
  const source = String(value);
  const date = new Date(source);
  if (Number.isNaN(date.valueOf())) return source;
  const options = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  };
  if (timeZone) options.timeZone = timeZone;
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function currentCalendarDate(timeZone, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function localDateTimeValue(value, timeZone) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "";
  const parts = dateTimeParts(instant, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

export function timestampFromLocalDateTime(value, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value || "");
  if (!match) throw new Error("A local date and time is required.");
  const desired = match.slice(1).map((part, index) => Number(part ?? (index === 5 ? "0" : part)));
  const desiredUtc = Date.UTC(desired[0], desired[1] - 1, desired[2], desired[3], desired[4], desired[5] || 0);
  let instant = new Date(desiredUtc);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = dateTimeParts(instant, timeZone);
    const representedUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    instant = new Date(instant.getTime() + desiredUtc - representedUtc);
  }
  const roundTrip = localDateTimeValue(instant, timeZone);
  const normalized = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || "00"}`;
  if (roundTrip !== normalized) throw new Error(`The local time ${normalized} does not exist in ${timeZone}.`);
  const matchingInstants = [];
  for (let offsetMinutes = -240; offsetMinutes <= 240; offsetMinutes += 1) {
    const candidate = new Date(instant.getTime() + offsetMinutes * 60_000);
    if (localDateTimeValue(candidate, timeZone) === normalized) matchingInstants.push(candidate.getTime());
  }
  if (new Set(matchingInstants).size > 1) {
    throw new Error(
      `The local time ${normalized} occurs more than once in ${timeZone}. Use an RFC 3339 timestamp with an explicit UTC offset.`
    );
  }
  return instant.toISOString().replace(".000Z", "Z");
}

function dateTimeParts(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(instant);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

export function isRfc3339Timestamp(value) {
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value || "");
  if (!match) return false;
  const [year, month, day] = match[1].split("-").map(Number);
  if (year < 1) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && !Number.isNaN(Date.parse(value));
}
