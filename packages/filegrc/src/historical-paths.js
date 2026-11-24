import { isCanonicalDataPath } from "./paths.js";

export function historicalJsonRecordPath(path) {
  return path.startsWith("data/") && path.endsWith(".json")
    && !/\/(?:\.|content(?:\/|$))/.test(path);
}

export function historicalAttachmentPaths(state, sourceCache) {
  const attachments = new Set();
  for (const [path, source] of state) {
    // Evidence metadata uses a reserved record location. Opaque attachment
    // contents cannot declare ownership, even when they resemble a record.
    if (!/^data\/evidence\/(?:[^/]+\.json|[^/]+\/evidence\.json)$/.test(path) || !historicalJsonRecordPath(path)) continue;
    if (sourceCache?.has(source)) {
      for (const attachment of sourceCache.get(source)) attachments.add(attachment);
      continue;
    }
    let record;
    try { record = JSON.parse(source); } catch { continue; }
    if (record?.type !== "evidence" || typeof record.id !== "string"
      || !Array.isArray(record.filePaths)) continue;
    const owned = [];
    for (const attachment of record.filePaths) {
      if (isCanonicalDataPath(attachment)
        && attachment.startsWith(`evidence/${record.id}/`)
        && !attachment.split("/").includes("..")
        && !attachment.endsWith("/evidence.json")) owned.push(`data/${attachment}`);
    }
    sourceCache?.set(source, owned);
    for (const attachment of owned) attachments.add(attachment);
  }
  return attachments;
}
