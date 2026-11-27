export function renderMarkdown(source = "") {
  return parseMarkdownBlocks(source).map((block) => {
    const { kind, text, level, items, rows, start } = block;
    if (kind === "paragraph") return `<p>${inline(text)}</p>`;
    if (kind === "heading") return `<h${level}>${inline(text)}</h${level}>`;
    if (kind === "quote") return `<blockquote>${inline(text)}</blockquote>`;
    if (kind === "code") return `<pre><code>${escapeHtml(text)}</code></pre>`;
    if (kind === "rule") return "<hr>";
    if (kind === "fields") return `<div class="pdf-blanks">${items.map(({ label, name }) => `<div><span>${escapeHtml(label)}:</span><span class="pdf-blank" aria-label="${name ? "Fillable in the PDF" : "Blank line"}"></span></div>`).join("")}</div>`;
    if (kind === "table") {
      const [head, ...body] = rows;
      return `<div class="table-wrap"><table><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
    return `<${kind}${kind === "ol" && start !== 1 ? ` start="${start}"` : ""}>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</${kind}>`;
  }).join("\n");
}

const PDF_BLANK = /^([^:{}|]+):[ \t]+\{\{pdf-(?:field:([a-z][a-z0-9-]{0,63})|blank)\}\}[ \t]*$/;

export function withoutPdfBlanks(source, keepLabels = false) {
  let fenced = false;
  return source.split(/\r\n?|\n/).map((line) => {
    if (isCodeFence(line)) {
      fenced = !fenced;
      return line;
    }
    if (fenced) return line;
    const blank = PDF_BLANK.exec(line);
    return blank ? (keepLabels ? blank[1] : "") : line;
  }).join("\n");
}

export function parseMarkdownBlocks(source = "") {
  const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let paragraph = [];
  let list = null;
  let code = null;
  let table = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    output.push(list);
    list = null;
  };
  const flushTable = () => {
    if (!table) return;
    output.push({ kind: "table", rows: table });
    table = null;
  };
  const flush = () => {
    flushParagraph();
    flushList();
    flushTable();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (code) {
      if (isCodeFence(line)) {
        output.push({ kind: "code", text: code.join("\n") });
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (isCodeFence(line)) {
      flush();
      code = [];
      continue;
    }
    const blank = PDF_BLANK.exec(line);
    if (blank) {
      flush();
      if (!index || !PDF_BLANK.test(lines[index - 1])) output.push({ kind: "fields", items: [] });
      output.at(-1).items.push({ label: blank[1].trim(), name: blank[2] });
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      output.push({ kind: "heading", level, text: heading[2] });
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      output.push({ kind: "quote", text: line.replace(/^>\s?/, "") });
      continue;
    }
    if (/^[-*_]{3,}\s*$/.test(line)) {
      flush();
      output.push({ kind: "rule" });
      continue;
    }
    const unordered = /^\s*[-*]\s+(.+)$/.exec(line);
    const ordered = /^\s*(\d{1,9})[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      flushTable();
      const kind = ordered ? "ol" : "ul";
      if (list && list.kind !== kind) flushList();
      list ??= { kind, items: [], ...(ordered ? { start: Number(ordered[1]) } : {}) };
      list.items.push(unordered?.[1] ?? ordered[2]);
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      flush();
      table = [parseTableRow(line)];
      index += 1;
      continue;
    }
    if (table && line.includes("|")) {
      table.push(parseTableRow(line));
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  if (code) output.push({ kind: "code", text: code.join("\n") });
  return output;
}

function inline(source) {
  let value = escapeHtml(source);
  value = value.replace(/`([^`]+)`/g, "<code>$1</code>");
  value = value.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  value = value.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  value = value.replace(/\[([^\]]+)]\(([^)\s]+)\)/g, (_, label, target) => {
    if (!/^(?:https?:|mailto:|#)/.test(target)) return label;
    return `<a href="${target.replaceAll("`", "&#96;")}" rel="noreferrer">${label}</a>`;
  });
  return value;
}

function isCodeFence(line) {
  return line.startsWith("```");
}

function parseTableRow(line) {
  const source = line.trim();
  const cells = [""];
  let start = source.startsWith("|") ? 1 : 0;
  for (const match of source.matchAll(/\\[\\|]|\|/g)) {
    const position = match.index;
    if (position < start) continue;
    cells[cells.length - 1] += source.slice(start, position);
    if (match[0] === "|") {
      if (position < source.length - 1) cells.push("");
    } else {
      cells[cells.length - 1] += match[0][1];
    }
    start = position + match[0].length;
  }
  cells[cells.length - 1] += source.slice(start);
  return cells.map((cell) => cell.trim());
}

function isTableDivider(line) {
  return /^\s*\|?\s*:?-{3,}/.test(line) && line.includes("|");
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
