export function createResourceId(type, title, existingIds = []) {
  const slugPart = (value) => String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const prefix = slugPart(type) || "record";
  const name = slugPart(title) || "new";
  const base = `${prefix}-${name}`;
  const used = new Set([...existingIds].map(String));
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}
