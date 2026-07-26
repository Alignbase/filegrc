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
