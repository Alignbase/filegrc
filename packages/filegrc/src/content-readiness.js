import { withoutPdfBlanks } from "./markdown.js";

export function openPlaceholderCount(source) {
  if (!source) return 0;
  const matches = withoutPdfBlanks(source, true).match(
    /\{\{[^}\n]+\}\}|\b(?:TODO|TBD)\b|\[(?:complete|confirm|describe|insert|name|replace|select|specify|todo|tbd)[^\]\n]*\]/giu
  );
  return matches?.length || 0;
}

export function hasMarkdownContent(source) {
  return Boolean(withoutPdfBlanks(source).trim());
}

export function substantiveMarkdown(source) {
  return (withoutPdfBlanks(source).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length >= 10;
}
