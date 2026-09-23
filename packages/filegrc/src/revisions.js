import { createHash } from "node:crypto";

export const REVISION_SCHEME_VERSION = 1;

export const CALCULATED_REVISION_FIELDS = new Set([
  "collectionRevision",
  "collectionReviewRevision",
  "reportingRouteRevision",
  "scopeRevision"
]);

export const CALCULATED_REVISION_MAP_FIELDS = new Set([
  "approvedContentRevisions",
  "activatedContentRevisions",
  "effectiveContentRevisions",
  "contentRevisions",
  "reviewedSourceRevisions"
]);

const PREFIXES = Object.freeze({
  content: `filegrc:content:v${REVISION_SCHEME_VERSION}:sha256:`,
  collection: `filegrc:collection:v${REVISION_SCHEME_VERSION}:sha256:`,
  "applicability-scope": `filegrc:applicability-scope:v${REVISION_SCHEME_VERSION}:sha256:`,
  "collection-review": `filegrc:collection-review:v${REVISION_SCHEME_VERSION}:sha256:`,
  "reporting-route": `filegrc:reporting-route:v${REVISION_SCHEME_VERSION}:sha256:`
});

export function calculateRevision(kind, source) {
  const prefix = PREFIXES[kind];
  if (!prefix) throw new Error(`Unknown calculated revision kind "${kind}".`);
  return `${prefix}${createHash("sha256").update(source).digest("hex")}`;
}

export function revisionDigest(kind, value) {
  const text = String(value || "");
  const prefix = PREFIXES[kind];
  if (prefix && text.startsWith(prefix) && /^[a-f0-9]{64}$/.test(text.slice(prefix.length))) {
    return text.slice(prefix.length);
  }
  if (kind === "applicability-scope" && /^scope:[a-f0-9]{64}$/.test(text)) return text.slice(6);
  if (/^[a-f0-9]{64}$/.test(text)) return text;
  return null;
}

export function revisionsMatch(kind, stored, current) {
  const storedDigest = revisionDigest(kind, stored);
  const currentDigest = revisionDigest(kind, current);
  return Boolean(storedDigest && currentDigest && storedDigest === currentDigest);
}

export function calculatedRevisionDiagnostic(kind, stored, current) {
  return {
    kind,
    storedRevision: stored || null,
    currentRevision: current || null,
    storedScheme: revisionScheme(kind, stored),
    currentScheme: revisionScheme(kind, current),
    matches: revisionsMatch(kind, stored, current)
  };
}

export function canonicalCalculatedRevision(value) {
  const text = String(value || "");
  // Keep the original digest as the calculation input. Merely installing a
  // scheme-aware engine must not stale a decision made over unchanged facts.
  if (/^[a-f0-9]{64}$/.test(text)) return text;
  if (/^scope:[a-f0-9]{64}$/.test(text)) return text.slice(6);
  const match = /^filegrc:[a-z-]+:v\d+:sha256:([a-f0-9]{64})$/.exec(text);
  return match ? match[1] : value;
}

// Preserve JSON layout because older resource-review bindings hashed the exact
// source bytes. Only scheme labels in model-defined revision slots may change.
export function canonicalCalculatedRevisionJson(source) {
  const fieldNames = [...CALCULATED_REVISION_FIELDS].join("|");
  const mapNames = [...CALCULATED_REVISION_MAP_FIELDS].join("|");
  const stringValue = /("(?:\\.|[^"\\])*")(\s*:\s*)("(?:\\.|[^"\\])*")/g;
  const canonicalValue = (quoted) => {
    const value = JSON.parse(quoted);
    const canonical = canonicalCalculatedRevision(value);
    return canonical === value ? quoted : JSON.stringify(canonical);
  };
  return source
    .replace(new RegExp(`("(?:${fieldNames})")(\\s*:\\s*)("(?:\\\\.|[^"\\\\])*")`, "g"),
      (_match, key, separator, value) => `${key}${separator}${canonicalValue(value)}`)
    .replace(new RegExp(`("(?:${mapNames})")(\\s*:\\s*\\{)([^{}]*)(\\})`, "g"),
      (_match, key, opening, body, closing) => (
        `${key}${opening}${body.replace(stringValue, (_pair, name, separator, value) => (
          `${name}${separator}${canonicalValue(value)}`
        ))}${closing}`
      ));
}

function revisionScheme(kind, value) {
  const text = String(value || "");
  if (!text) return null;
  if (text.startsWith(PREFIXES[kind] || "\0")) return `filegrc:${kind}:v${REVISION_SCHEME_VERSION}:sha256`;
  if (kind === "applicability-scope" && /^scope:[a-f0-9]{64}$/.test(text)) return "legacy:applicability-scope:sha256";
  if (/^[a-f0-9]{64}$/.test(text)) return `legacy:${kind}:sha256`;
  return "unknown";
}
