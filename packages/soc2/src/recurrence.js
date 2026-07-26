export function nextCalendarOccurrence(recurrence, asOf) {
  const boundary = parseCalendarDate(asOf);
  if (!validCalendarRecurrence(recurrence) || !boundary) return null;
  if (recurrence.anchorDate >= asOf) return recurrence.anchorDate;
  const current = calendarOccurrenceIndex(recurrence, asOf);
  const candidate = calendarOccurrence(recurrence, Math.max(0, current));
  return candidate >= asOf ? candidate : calendarOccurrence(recurrence, current + 1);
}

export function validCalendarRecurrence(recurrence) {
  return Boolean(
    recurrence
    && recurrence.mode === "calendar"
    && Number.isSafeInteger(recurrence.interval)
    && recurrence.interval > 0
    && ["day", "week", "month", "year"].includes(recurrence.unit)
    && parseCalendarDate(recurrence.anchorDate)
  );
}

export function calendarOccurrence(recurrence, index) {
  if (!validCalendarRecurrence(recurrence) || !Number.isInteger(index) || index < 0) return null;
  const anchor = parseCalendarDate(recurrence.anchorDate);
  if (recurrence.unit === "day" || recurrence.unit === "week") {
    const step = recurrence.interval * (recurrence.unit === "week" ? 7 : 1);
    return formatCalendarDateUtc(new Date(anchor.date.getTime() + index * step * 86_400_000));
  }
  const step = recurrence.interval * (recurrence.unit === "year" ? 12 : 1);
  const monthIndex = anchor.month - 1 + index * step;
  const year = anchor.year + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = utcCalendarDate(year, month + 1, 0).getUTCDate();
  return formatCalendarDateUtc(utcCalendarDate(year, month, Math.min(anchor.day, lastDay)));
}

export function calendarOccurrenceIndex(recurrence, date) {
  const anchor = validCalendarRecurrence(recurrence) ? parseCalendarDate(recurrence.anchorDate) : null;
  const boundary = parseCalendarDate(date);
  if (!anchor || !boundary || date < recurrence.anchorDate) return -1;
  if (recurrence.unit === "day" || recurrence.unit === "week") {
    const step = recurrence.interval * (recurrence.unit === "week" ? 7 : 1);
    return Math.floor((boundary.date - anchor.date) / (step * 86_400_000));
  }
  const step = recurrence.interval * (recurrence.unit === "year" ? 12 : 1);
  const elapsedMonths = (boundary.year - anchor.year) * 12 + boundary.month - anchor.month;
  let index = Math.max(0, Math.floor(elapsedMonths / step));
  while (index > 0 && calendarOccurrence(recurrence, index) > date) index -= 1;
  while (calendarOccurrence(recurrence, index + 1) <= date) index += 1;
  return index;
}

export function addCalendarDays(value, days) {
  const parsed = parseCalendarDate(value);
  if (!parsed || !Number.isInteger(days)) return null;
  return formatCalendarDateUtc(new Date(parsed.date.getTime() + days * 86_400_000));
}

export function calendarDayDifference(from, to) {
  const start = parseCalendarDate(from);
  const end = parseCalendarDate(to);
  return start && end ? Math.round((end.date - start.date) / 86_400_000) : null;
}

export function parseCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1) return null;
  const date = utcCalendarDate(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? { year, month, day, date }
    : null;
}

function utcCalendarDate(year, monthIndex, day) {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function formatCalendarDateUtc(date) {
  const year = date.getUTCFullYear();
  if (!Number.isInteger(year) || year < 1 || year > 9999) return null;
  return [
    String(year).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}
