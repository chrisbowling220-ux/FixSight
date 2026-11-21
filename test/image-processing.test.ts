import assert from "node:assert/strict";
import test from "node:test";

import sharp, { type Sharp } from "sharp";

import { InvalidImageError } from "../src/errors.js";
import {
  MAX_LONG_EDGE,
  MAX_VISUAL_TOKENS,
  prepareImages,
  targetDimensions,
  visualTokenCount,
} from "../src/image-processing.js";

async function encode(pipeline: Sharp): Promise<string> {
  return (await pipeline.toBuffer()).toString("base64");
}

test("a large phone photo is downscaled within the visual-token budget", async () => {
  const data = await encode(
    sharp({ create: { width: 4032, height: 3024, channels: 3, background: "#8a7f70" } }).jpeg({ quality: 80 }),
  );
  const [prepared] = await prepareImages([{ data, media_type: "image/jpeg" }]);
  assert.ok(prepared);
  assert.equal(prepared.media_type, "image/jpeg");
  assert.ok(Math.max(prepared.width, prepared.height) <= MAX_LONG_EDGE);
  assert.ok(visualTokenCount(prepared.width, prepared.height) <= MAX_VISUAL_TOKENS);
  const meta = await sharp(Buffer.from(prepared.data, "base64")).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, prepared.width);
});

test("EXIF orientation is applied so portrait photos stay portrait", async () => {
  // Stored landscape with orientation 6 (rotate 90° clockwise to display).
  const data = await encode(
    sharp({ create: { width: 1200, height: 800, channels: 3, background: "#ffffff" } })
      .jpeg()
      .withMetadata({ orientation: 6 }),
  );
  const [prepared] = await prepareImages([{ data, media_type: "image/jpeg" }]);
  assert.ok(prepared);
  assert.ok(prepared.height > prepared.width, `${prepared.width}x${prepared.height}`);
});

test("PNG transparency is flattened onto white and WebP is accepted", async () => {
  const png = await encode(
    sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png(),
  );
  const webp = await encode(
    sharp({ create: { width: 300, height: 200, channels: 3, background: "#336699" } }).webp(),
  );
  const [flat, fromWebp] = await prepareImages([
    { data: png, media_type: "image/png" },
    { data: webp, media_type: "image/webp" },
  ]);
  const { data: pixels } = await sharp(Buffer.from(flat!.data, "base64")).raw().toBuffer({ resolveWithObject: true });
  assert.ok(pixels[0]! > 240 && pixels[1]! > 240 && pixels[2]! > 240, "transparent pixels become white");
  assert.equal(fromWebp!.media_type, "image/jpeg");
});

test("corrupt image data is rejected with a client error", async () => {
  const corrupt = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]).toString("base64");
  await assert.rejects(
    prepareImages([{ data: corrupt, media_type: "image/jpeg" }]),
    (error: unknown) => error instanceof InvalidImageError && error.status === 400,
  );
});

test("images beyond the pixel limit are refused rather than decoded", async () => {
  // 8000 x 6000 = 48 MP, above the 40 MP decompression limit.
  const data = await encode(
    sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#000000" } }).jpeg({ quality: 10 }),
  );
  await assert.rejects(prepareImages([{ data, media_type: "image/jpeg" }]), InvalidImageError);
});

test("target dimensions respect both the long-edge and token limits", () => {
  const wide = targetDimensions(10_000, 1_000);
  assert.ok(wide.width <= MAX_LONG_EDGE);
  const square = targetDimensions(3_000, 3_000);
  assert.ok(visualTokenCount(square.width, square.height) <= MAX_VISUAL_TOKENS);
  assert.throws(() => targetDimensions(0, 10), InvalidImageError);
});
