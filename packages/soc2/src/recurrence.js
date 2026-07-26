export function nextCalendarOccurrence(recurrence, asOf) {
  if (!recurrence || recurrence.mode !== "calendar") return null;
  if (!Number.isInteger(recurrence.interval) || recurrence.interval < 1) return null;
  if (!["day", "week", "month", "year"].includes(recurrence.unit)) return null;
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(recurrence.anchorDate || "") || !pattern.test(asOf || "")) return null;
  const parse = (value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? { year, month, day, date }
      : null;
  };
  const format = (date) => [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
  const anchor = parse(recurrence.anchorDate);
  const boundary = parse(asOf);
  if (!anchor || !boundary) return null;
  if (recurrence.anchorDate >= asOf) return recurrence.anchorDate;

  if (recurrence.unit === "day" || recurrence.unit === "week") {
    const day = 86_400_000;
    const step = recurrence.interval * (recurrence.unit === "week" ? 7 : 1);
    const elapsed = Math.floor((boundary.date - anchor.date) / day);
    const periods = Math.ceil(elapsed / step);
    return format(new Date(anchor.date.getTime() + periods * step * day));
  }

  const step = recurrence.interval * (recurrence.unit === "year" ? 12 : 1);
  const elapsedMonths = (boundary.year - anchor.year) * 12 + boundary.month - anchor.month;
  let periods = Math.max(1, Math.floor(elapsedMonths / step));
  const occurrence = (count) => {
    const monthIndex = anchor.month - 1 + count * step;
    const year = anchor.year + Math.floor(monthIndex / 12);
    const month = ((monthIndex % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(anchor.day, lastDay)));
  };
  let candidate = occurrence(periods);
  while (format(candidate) < asOf) candidate = occurrence(++periods);
  return format(candidate);
}
