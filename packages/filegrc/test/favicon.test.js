import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import test from "node:test";
import { FAVICON_PNG } from "../src/favicon.js";

test("renders a transparent document outline with a contained white padlock", () => {
  const pixels = decodePixels(FAVICON_PNG);

  assert.deepEqual(pixelAt(pixels, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixelAt(pixels, 13, 30), [248, 249, 255, 255]);
  assert.deepEqual(pixelAt(pixels, 22, 20), [0, 0, 79, 255]);
  assert.deepEqual(pixelAt(pixels, 32, 25), [248, 249, 255, 255]);
  assert.deepEqual(pixelAt(pixels, 21, 40), [248, 249, 255, 255]);
  assert.deepEqual(pixelAt(pixels, 32, 42), [0, 0, 54, 255]);
  assert.deepEqual(pixelAt(pixels, 20, 33), [0, 0, 71, 255]);
  assert.deepEqual(pixelAt(pixels, 44, 51), [0, 0, 53, 255]);
});

function decodePixels(png) {
  const chunks = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const rows = inflateSync(Buffer.concat(chunks));
  const pixels = Buffer.alloc(64 * 64 * 4);
  for (let y = 0; y < 64; y += 1) {
    const rowOffset = y * (64 * 4 + 1);
    assert.equal(rows[rowOffset], 0);
    rows.copy(pixels, y * 64 * 4, rowOffset + 1, rowOffset + 1 + 64 * 4);
  }
  return pixels;
}

function pixelAt(pixels, x, y) {
  return [...pixels.subarray((y * 64 + x) * 4, (y * 64 + x + 1) * 4)];
}
