import { modelSupports } from "../model/index.js";
import { markdownEntries } from "./resource-markdown.js";
import { revisionDigest } from "./revisions.js";

// Check historical bindings without comparing them with today's content. The
// filesystem validator supplies existing paths; planners can require only
// mandatory authored content because optional Markdown may not exist.
export function attestationBindingIssue(record, model, byId = new Map(), subjectPaths = null) {
  if (record.type !== "attestation" || record.status !== "completed"
    || (record.attestationMethod !== "git-approval" && !modelSupports(model, "complete-operating-baseline"))) return null;
  const filesystemPaths = subjectPaths !== null;
  subjectPaths ||= new Map((record.subjectResourceIds || []).map((id) => [id,
    byId.get(id) ? markdownEntries(model, byId.get(id)).map(({ path }) => path) : []]));
  const expectedPaths = new Set([...subjectPaths.values()].flat());
  if (!expectedPaths.size) return "A git-approval Attestation must reference authored Policy, Document, or Training content.";
  const actualPaths = Object.keys(record.contentRevisions || {});
  if (!actualPaths.length) return "A git-approval Attestation must bind at least one subject Markdown file.";
  const unboundSubjects = [...subjectPaths].filter(([id, paths]) => {
    const requiresContent = filesystemPaths || byId.get(id)
      && markdownEntries(model, byId.get(id)).some(({ required }) => required);
    return requiresContent && paths.length && !paths.some((path) => actualPaths.includes(path));
  }).map(([id]) => id);
  if (unboundSubjects.length) return `Attestation contentRevisions must bind authored Markdown for every subject; missing ${unboundSubjects.join(", ")}.`;
  if (actualPaths.some((path) => !expectedPaths.has(path) || !revisionDigest("content", record.contentRevisions[path]))) {
    return "Attestation contentRevisions must contain valid SHA-256 hashes for subject Markdown paths and no unrelated paths.";
  }
  return null;
}
