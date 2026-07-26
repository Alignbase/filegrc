import { deflateSync } from "node:zlib";

const SIZE = 64;
const GLYPHS = {
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01110"]
};

export const FAVICON_PNG = createFavicon();

function createFavicon() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (!insideRoundedSquare(x, y, 11)) continue;
      const offset = (y * SIZE + x) * 4;
      const progress = Math.min(1, (x + y) / ((SIZE - 1) * 1.2));
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = Math.round(112 + (53 - 112) * progress);
      pixels[offset + 3] = 255;
    }
  }

  drawGlyph(pixels, GLYPHS.F, 5, 14, 5, [255, 255, 255, 255]);
  drawGlyph(pixels, GLYPHS.G, 34, 14, 5, [181, 192, 255, 255]);

  const rows = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    const rowOffset = y * (SIZE * 4 + 1);
    rows[rowOffset] = 0;
    pixels.copy(rows, rowOffset + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header.set([8, 6, 0, 0, 0], 8);

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function insideRoundedSquare(x, y, radius) {
  const cornerX = x < radius ? radius - 1 : x >= SIZE - radius ? SIZE - radius : x;
  const cornerY = y < radius ? radius - 1 : y >= SIZE - radius ? SIZE - radius : y;
  return Math.hypot(x - cornerX, y - cornerY) <= radius;
}

function drawGlyph(pixels, glyph, startX, startY, scale, color) {
  glyph.forEach((row, rowIndex) => {
    [...row].forEach((filled, columnIndex) => {
      if (filled !== "1") return;
      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          const offset = ((startY + rowIndex * scale + y) * SIZE + startX + columnIndex * scale + x) * 4;
          pixels.set(color, offset);
        }
      }
    });
  });
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8);
  return chunk;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}
