import { deflateSync } from "node:zlib";

const SIZE = 64;
const WHITE = [248, 249, 255, 255];

export const FAVICON_PNG = createFavicon();

function createFavicon() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (!insideRoundedSquare(x, y, 11)) continue;
      setPixel(pixels, x, y, backgroundColor(x, y));
    }
  }

  drawStroke(pixels, [
    [18, 8],
    [39, 8],
    [51, 20],
    [51, 50],
    [50, 53],
    [47, 55],
    [17, 55],
    [14, 54],
    [12, 51],
    [12, 13],
    [14, 10],
    [18, 8]
  ], 2.3, WHITE);
  drawStroke(pixels, [[39, 8], [39, 20], [51, 20]], 2.3, WHITE);

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

function backgroundColor(x, y) {
  const progress = Math.min(1, (x + y) / ((SIZE - 1) * 1.2));
  return [0, 0, Math.round(112 + (53 - 112) * progress), 255];
}

function drawStroke(pixels, points, radius, color) {
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const onStroke = points.slice(1).some((point, index) => (
        distanceToSegment(x, y, points[index], point) <= radius
      ));
      if (onStroke) setPixel(pixels, x, y, color);
    }
  }
}

function distanceToSegment(x, y, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const progress = lengthSquared
    ? Math.max(0, Math.min(1, ((x - start[0]) * dx + (y - start[1]) * dy) / lengthSquared))
    : 0;
  return Math.hypot(x - (start[0] + progress * dx), y - (start[1] + progress * dy));
}

function setPixel(pixels, x, y, color) {
  pixels.set(color, (y * SIZE + x) * 4);
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
