import { readFileSync } from "node:fs";

const faces = ["Regular", "Bold", "Italic", "BoldItalic"];
let fonts;

export function pdfFonts() {
  return fonts ??= faces.map((face) => readFont(face));
}

function readFont(face) {
  const name = `NotoSerif-${face}`;
  const bytes = readFileSync(new URL(`./pdf-fonts/${name}.ttf`, import.meta.url));
  const tables = new Map();
  for (let index = 0; index < bytes.readUInt16BE(4); index++) {
    const offset = 12 + index * 16;
    tables.set(bytes.toString("ascii", offset, offset + 4), bytes.readUInt32BE(offset + 8));
  }
  const head = tables.get("head");
  const hhea = tables.get("hhea");
  const cmap = tables.get("cmap");
  const hmtx = tables.get("hmtx");
  const units = bytes.readUInt16BE(head + 18);
  const metrics = bytes.readUInt16BE(hhea + 34);
  const scale = (number) => Math.round(number * 1000 / units);
  const gids = Buffer.alloc(65536 * 2);
  const widths = new Map();
  for (let index = 0; index < bytes.readUInt16BE(cmap + 2); index++) {
    const record = cmap + 4 + index * 8;
    const subtable = cmap + bytes.readUInt32BE(record + 4);
    if (bytes.readUInt16BE(record) !== 3 || bytes.readUInt16BE(record + 2) !== 10
      || bytes.readUInt16BE(subtable) !== 12) continue;
    for (let group = 0; group < bytes.readUInt32BE(subtable + 12); group++) {
      const offset = subtable + 16 + group * 12;
      const first = bytes.readUInt32BE(offset);
      const last = Math.min(65535, bytes.readUInt32BE(offset + 4));
      const glyph = bytes.readUInt32BE(offset + 8);
      for (let code = first; code <= last; code++) {
        const gid = glyph + code - first;
        if (!gid) continue;
        gids.writeUInt16BE(gid, code * 2);
        widths.set(code, scale(bytes.readUInt16BE(hmtx + 4 * Math.min(gid, metrics - 1))));
      }
    }
    break;
  }
  if (!widths.size) throw new Error(`Missing Unicode cmap in ${name}.`);
  const bbox = [36, 38, 40, 42].map((offset) => scale(bytes.readInt16BE(head + offset)));
  return { name, bytes, gids, widths, bbox,
    ascent: scale(bytes.readInt16BE(hhea + 4)), descent: scale(bytes.readInt16BE(hhea + 6)),
    capHeight: scale(bytes.readInt16BE(tables.get("OS/2") + 88)), italic: face.includes("Italic") };
}

export function pdfTextWidth(font, value, size) {
  let width = 0;
  for (const character of value) {
    const code = character.codePointAt(0);
    const advance = font.widths.get(code);
    if (advance === undefined) {
      throw new Error(`PDF font does not support ${JSON.stringify(character)} (U+${code.toString(16).toUpperCase()}).`);
    }
    width += advance;
  }
  return width * size / 1000;
}

export function pdfUnicode(value) {
  return Buffer.from(value, "utf16le").swap16().toString("hex");
}

export function embedPdfFont(pdf, font) {
  const { name, bytes, gids, widths, bbox, ascent, descent, capHeight, italic } = font;
  const data = pdf.stream(`/Length1 ${bytes.length}`, bytes);
  const descriptor = pdf.add(`<< /Type /FontDescriptor /FontName /${name} /Flags ${italic ? 70 : 6} /FontBBox [${bbox.join(" ")}] /ItalicAngle ${italic ? -12 : 0} /Ascent ${ascent} /Descent ${descent} /CapHeight ${capHeight} /StemV 80 /FontFile2 ${data} 0 R >>`);
  const map = pdf.stream("", gids);
  const advances = [];
  let prior = -2;
  for (const [code, width] of widths) {
    if (code !== prior + 1) advances.push([code, []]);
    advances.at(-1)[1].push(width);
    prior = code;
  }
  const entries = advances.map(([code, group]) => `${code} [${group.join(" ")}]`).join(" ");
  const descendant = pdf.add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /CIDToGIDMap ${map} 0 R /W [${entries}] >>`);
  const ranges = [];
  for (const code of widths.keys()) {
    const range = ranges.at(-1);
    if (range && code === range[1] + 1 && (code & 255) !== 0) range[1] = code;
    else ranges.push([code, code]);
  }
  const mappings = [];
  for (let index = 0; index < ranges.length; index += 100) {
    const group = ranges.slice(index, index + 100);
    mappings.push(`${group.length} beginbfrange`);
    for (const [first, last] of group) {
      const low = pdfUnicode(String.fromCharCode(first));
      const high = pdfUnicode(String.fromCharCode(last));
      mappings.push(`<${low}> <${high}> <${low}>`);
    }
    mappings.push("endbfrange");
  }
  const unicode = pdf.stream("", Buffer.from([
    "/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /FileGRC-UCS def", "/CMapType 2 def",
    "1 begincodespacerange", "<0000> <FFFF>", "endcodespacerange",
    ...mappings,
    "endcmap", "CMapName currentdict /CMap defineresource pop", "end end"
  ].join("\n")));
  return pdf.add(`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${descendant} 0 R] /ToUnicode ${unicode} 0 R >>`);
}
