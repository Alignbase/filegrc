export function renderMarkdown(source = "") {
  const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let paragraph = [];
  let list = null;
  let code = null;
  let table = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    output.push(`<${list.kind}>${list.items.map((item) => `<li>${inline(item)}</li>`).join("")}</${list.kind}>`);
    list = null;
  };
  const flushTable = () => {
    if (!table) return;
    const [head, ...rows] = table;
    output.push(`<div class="table-wrap"><table><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
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
      if (line.startsWith("```")) {
        output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (line.startsWith("```")) {
      flush();
      code = [];
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      output.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      output.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }
    if (/^[-*_]{3,}\s*$/.test(line)) {
      flush();
      output.push("<hr>");
      continue;
    }
    const unordered = /^\s*[-*]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      flushTable();
      const kind = ordered ? "ol" : "ul";
      if (list && list.kind !== kind) flushList();
      list ??= { kind, items: [] };
      list.items.push((unordered ?? ordered)[1]);
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
  if (code) output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  return output.join("\n");
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

function parseTableRow(line) {
  return line.replace(/^\s*\||\|\s*$/g, "").split("|").map((cell) => cell.trim());
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
