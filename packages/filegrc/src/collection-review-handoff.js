import { createHash } from "node:crypto";
import { realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { getGitSummary } from "./git.js";
import { isWithin, resolveWorkspaceRoot } from "./paths.js";

export function reviewPayloadPath(root, programId, resourceType, collectionRevision, priorRevision) {
  const slug = (value) => String(value || "workspace").replace(/[^a-z0-9-]/gi, "-").slice(0, 55);
  const revision = createHash("sha256").update([root, programId, resourceType, collectionRevision, priorRevision].join("\0")).digest("hex").slice(0, 12);
  return join(tmpdir(), `filegrc-${slug(programId)}-${slug(resourceType)}-${revision}-review.json`);
}

const quote = (value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value)) ? String(value) : `'${String(value).replaceAll("'", "'\\''")}'`;

export function collectionReviewCommands(assessment, shellArgument = quote) {
  const path = shellArgument(assessment.reviewPayloadPath || reviewPayloadPath("", assessment.programId, assessment.resourceType));
  const program = assessment.programId ? ` --program ${shellArgument(assessment.programId)}` : "";
  const command = `npx filegrc review-collection ${assessment.resourceType}${program}`;
  return [`${command} --scaffold --output ${path}`, `${command} ${path} --preview --summary --json`, `${command} ${path} --yes --summary --json`];
}

export async function writeReviewPayload(input, destination, payload) {
  const root = resolveWorkspaceRoot(input);
  const path = resolve(String(destination));
  // Resolve the parent as well as the workspace so directory symlinks cannot
  // turn a temporary draft into a source write inside the checkout.
  const target = join(await realpath(dirname(path)), basename(path));
  const checkout = getGitSummary(root).root || root;
  if (isWithin(await realpath(checkout), target)) throw new Error("Write review payloads outside the checkout so the reviewed Git revision remains clean.");
  try { await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error(`Review payload already exists at ${target}. Inspect and reuse it, or choose a new --output path; the existing draft was not overwritten.`);
    throw error;
  }
  return target;
}

export function summarizeCollectionReview(result, preview) {
  const records = [...(result.changes?.create || []), ...(result.changes?.update || [])];
  const review = records.find((record) => record.type === "collection-review" && record.status === "active");
  const deltaCounts = (changes) => Object.fromEntries(["added", "removed", "changed"].map((key) => [key, changes?.[key]?.length || 0]));
  return {
    operation: "collection-review", status: preview ? "preview" : "recorded", resourceType: result.resourceType,
    ...result.reviewSummary,
    review: review ? Object.fromEntries(["id", "decision", "rationale", "reviewedByIds", "reviewedOn", "scopeRevision", "collectionRevision", "knowledgeCutoffAt", "supersedesId"].filter((key) => review[key] !== undefined).map((key) => [key, review[key]])) : null,
    retiredReviewIds: records.filter((record) => record.type === "collection-review" && record.status === "retired").map(({ id }) => id),
    governedContentChanges: records.filter((record) => ["policy", "document", "training"].includes(record.type)).map(({ id, type, status, effectiveOn, activatedOn }) => ({ id, type, status, effectiveOn: effectiveOn || null, activatedOn: activatedOn || null })),
    ...(!preview ? { collectionReviewCurrent: result.assessment.complete } : {}),
    ...(result.firstOperatingTasks ? { firstOperatingTasks: result.firstOperatingTasks } : {}),
    ...(result.workflowDelta ? { workflowDelta: { assessments: result.workflowDelta.assessments, findings: deltaCounts(result.workflowDelta.findings), workItems: deltaCounts(result.workflowDelta.workItems), recommendedAfter: result.workflowDelta.recommendedAfter } } : {})
  };
}
