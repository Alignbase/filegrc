import { isCanonicalDataPath } from "./paths.js";

export function historicalJsonRecordPath(path) {
  const parts = path.split("/");
  return parts[0] === "data" && path.endsWith(".json")
    && !parts.slice(1).some((part) => part.startsWith(".") || part === "content");
}

export function historicalAttachmentPaths(state) {
  const attachments = new Set();
  for (const [path, source] of state) {
    // Evidence metadata uses a reserved record location. Opaque attachment
    // contents cannot declare ownership, even when they resemble a record.
    if (!/^data\/evidence\/(?:[^/]+\.json|[^/]+\/evidence\.json)$/.test(path)) continue;
    let record;
    try { record = JSON.parse(source); } catch { continue; }
    if (record?.type !== "evidence" || typeof record.id !== "string"
      || !Array.isArray(record.filePaths)) continue;
    for (const attachment of record.filePaths) {
      if (isCanonicalDataPath(attachment)
        && attachment.startsWith(`evidence/${record.id}/`)
        && !attachment.split("/").includes("..")
        && !attachment.endsWith("/evidence.json")) attachments.add(`data/${attachment}`);
    }
  }
  return attachments;
}
