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
