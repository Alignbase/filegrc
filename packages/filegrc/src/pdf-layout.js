import { parseMarkdownBlocks } from "./markdown.js";
import { pdfTextWidth, pdfUnicode } from "./pdf-font.js";

export const PDF_PAGE_WIDTH = 612;
export const PDF_PAGE_HEIGHT = 792;
const LEFT = 54;
const RIGHT = PDF_PAGE_WIDTH - LEFT;
const WIDTH = RIGHT - LEFT;
const TOP = 728;
const BOTTOM = 58;

function inlineRuns(source, face) {
  const runs = [];
  const tokens = /(`[^`]+`|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g;
  let start = 0;
  for (const match of source.matchAll(tokens)) {
    const token = match[0];
    runs.push({ text: source.slice(start, match.index), face });
    if (token.startsWith("[")) {
      const end = token.indexOf("](");
      const label = token.slice(1, end);
      const target = token.slice(end + 2, -1);
      runs.push(...inlineRuns(label, face));
      if (target !== label) runs.push({ text: ` (${target})`, face });
    } else {
      const delimiter = /^\*+/.exec(token)?.[0].length ?? 1;
      const emphasis = token[0] === "*" ? face | [0, 2, 1, 3][delimiter] : face;
      runs.push({ text: token.slice(delimiter, -delimiter), face: emphasis });
    }
    start = match.index + token.length;
  }
  runs.push({ text: source.slice(start), face });
  return runs;
}

export function layoutPdf(document, fonts) {
  const pages = [];
  const names = new Set();
  let page;
  let y;
  const widthOf = (text, size, face = 0) => pdfTextWidth(fonts[face], text, size);

  function textAt(text, x, baseline, size, face = 0) {
    if (!text) return;
    page.faces.add(face);
    page.operations.push(`BT /F${face} ${size} Tf 1 0 0 1 ${point(x)} ${point(baseline)} Tm <${pdfUnicode(text)}> Tj ET`);
  }

  function line(x1, x2, baseline) {
    page.operations.push(`0.44 0.47 0.52 RG 0.55 w ${point(x1)} ${point(baseline)} m ${point(x2)} ${point(baseline)} l S`);
  }

  function startPage() {
    page = { operations: [], fields: [], faces: new Set() };
    pages.push(page);
    y = TOP;
    const header = document.status + (document.template ? " | Unsigned template" : "");
    textAt(header, LEFT, 754, 9, 1);
    line(LEFT, RIGHT, 743);
  }

  function ensure(height) {
    if (y - height < BOTTOM && y < TOP) startPage();
  }

  function wrap(source, size, limit, face = 0, literal = false) {
    source = source.normalize("NFC");
    const runs = literal ? [{ text: source.replaceAll("\t", "    "), face }] : inlineRuns(source, face);
    const lines = [[]];
    let width = 0;
    let pending = [];
    let word = [];
    const space = (character) => /\s/u.test(character);
    const push = (part) => {
      const parts = lines.at(-1);
      if (parts.at(-1)?.face === part.face) parts.at(-1).text += part.text;
      else parts.push({ text: part.text, face: part.face });
      width += part.width;
    };
    const nextLine = () => { lines.push([]); width = 0; };
    const flushWord = () => {
      if (!word.length) return;
      const total = [...pending, ...word].reduce((sum, part) => sum + part.width, 0);
      if (width && width + total > limit) { nextLine(); pending = []; }
      for (const part of [...pending, ...word]) {
        if (width && width + part.width > limit) nextLine();
        push(part);
      }
      pending = [];
      word = [];
    };
    for (const run of runs) {
      for (const character of run.text) {
        const whitespace = space(character);
        if (whitespace) flushWord();
        const text = whitespace && !literal ? " " : character;
        const part = { text, face: run.face, width: widthOf(text, size, run.face) };
        if (whitespace) {
          if (literal || (width && !pending.length)) pending.push(part);
        } else word.push(part);
      }
    }
    flushWord();
    return lines;
  }

  function paintLine(runs, x, baseline, size) {
    for (const { text, face } of runs) {
      textAt(text, x, baseline, size, face);
      x += widthOf(text, size, face);
    }
  }

  function paragraph(source, { size = 11, leading = 16, face = 0, x = LEFT, gap = 7, keep = 0, literal = false } = {}) {
    const lines = wrap(source, size, RIGHT - x, face, literal);
    ensure(Math.min(lines.length, keep ? lines.length : 2) * leading + keep);
    lines.forEach((runs, index) => {
      ensure(index === lines.length - 2 ? leading * 2 : leading);
      paintLine(runs, x, y - size, size);
      y -= leading;
    });
    y -= gap;
  }

  function table(rows) {
    const columns = Math.max(...rows.map((row) => row.length));
    const columnWidth = WIDTH / columns;
    const size = 9;
    const leading = 13;
    if (columnWidth < 26) throw new Error("PDF table has too many columns to print legibly.");
    const cells = (row, face) => Array.from({ length: columns }, (_, index) =>
      wrap(row[index] ?? "", size, columnWidth - 12, face));
    const count = (row) => Math.max(...row.map((cell) => cell.length));
    const paintRow = (row, start, length, header) => {
      const height = length * leading + 10;
      if (header) page.operations.push(`q 0.93 0.94 0.96 rg ${LEFT} ${point(y - height)} ${WIDTH} ${height} re f Q`);
      row.forEach((cell, column) => {
        const x = LEFT + column * columnWidth;
        page.operations.push(`0.76 0.78 0.81 RG 0.4 w ${point(x)} ${point(y - height)} ${point(columnWidth)} ${height} re S`);
        cell.slice(start, start + length).forEach((runs, index) =>
          paintLine(runs, x + 6, y - 5 - size - index * leading, size));
      });
      y -= height;
    };
    const header = cells(rows[0], 1);
    const headerCount = count(header);
    const headerHeight = headerCount * leading + 10;
    const bodyCapacity = Math.floor((TOP - BOTTOM - headerHeight - 10) / leading);
    if (bodyCapacity < 1) throw new Error("PDF table header is too tall for a page.");
    const body = rows.slice(1).map((row) => cells(row, 0));
    ensure(headerHeight + (body.length ? Math.min(count(body[0]), bodyCapacity) * leading + 10 : 0));
    paintRow(header, 0, headerCount, true);
    for (const row of body) {
      const length = count(row);
      for (let start = 0; start < length;) {
        const chunk = Math.min(length - start, bodyCapacity);
        if (y - (chunk * leading + 10) < BOTTOM) {
          startPage();
          paintRow(header, 0, headerCount, true);
        }
        paintRow(row, start, chunk, false);
        start += chunk;
      }
    }
    y -= 12;
  }

  function fields(items) {
    const labelWidth = Math.max(...items.map(({ label }) => widthOf(label + ":", 11)));
    const x = LEFT + labelWidth + 14;
    if (x > RIGHT - 90) throw new Error("PDF form labels leave too little room for a blank.");
    if (items.length * 29 > TOP - BOTTOM) throw new Error("PDF form block is too tall for one page. Separate groups with a blank line.");
    ensure(items.length * 29);
    for (const { label, name } of items) {
      textAt(label + ":", LEFT, y - 17, 11);
      line(x, RIGHT, y - 21);
      if (name) {
        if (names.has(name)) throw new Error(`Duplicate PDF form field "${name}".`);
        names.add(name);
        page.fields.push({ name, label, rect: [x + 2, y - 20, RIGHT - 2, y - 3].map(point).join(" ") });
      }
      y -= 29;
    }
    y -= 5;
  }

  startPage();
  const blocks = parseMarkdownBlocks(document.source);
  const title = { size: 24, leading: 31, face: 1, gap: 12, keep: 16, literal: true };
  paragraph(document.title, title);
  if (blocks[0]?.kind === "heading" && blocks[0].level === 1 && blocks[0].text === document.title) blocks.shift();
  for (const [index, block] of blocks.entries()) {
    if (block.kind === "heading") {
      const next = blocks[index + 1];
      const keep = next?.kind === "fields" ? next.items.length * 29 + 3 : next?.kind === "table" ? 66 : 32;
      y -= 5;
      paragraph(block.text, { size: block.level === 1 ? 18 : block.level === 2 ? 15 : 12, leading: 22, face: 1, gap: 3, keep });
    } else if (block.kind === "table") table(block.rows);
    else if (block.kind === "fields") fields(block.items);
    else if (block.kind === "ul" || block.kind === "ol") {
      block.items.forEach((item, index) => {
        ensure(32);
        const marker = block.kind === "ul" ? "•" : `${block.start + index}.`;
        textAt(marker, LEFT + 4, y - 11, 11);
        paragraph(item, { x: LEFT + 25, gap: 3 });
      });
      y -= 5;
    } else if (block.kind === "code") {
      for (const source of block.text.split("\n")) paragraph(source, { x: LEFT + 12, size: 9, leading: 13, gap: 0, literal: true });
      y -= 7;
    } else if (block.kind === "rule") {
      ensure(14);
      line(LEFT, RIGHT, y - 6);
      y -= 14;
    } else if (block.kind === "quote") paragraph(block.text, { x: LEFT + 16, face: 2 });
    else paragraph(block.text);
  }

  pages.forEach((current, index) => {
    page = current;
    line(LEFT, RIGHT, 49);
    const number = `Page ${index + 1} of ${pages.length}`;
    textAt(number, RIGHT - widthOf(number, 8), 35, 8);
  });
  return pages;
}

function point(value) {
  return Number(value.toFixed(2));
}
