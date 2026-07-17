// sharp is used when available for server-side resize (controls image-token cost).
// On older CPUs that lack the AVX2 instructions required by sharp's prebuilt
// binary it crashes with SIGILL.  We detect this at startup by probing the
// import, and fall back to a pass-through path that sends the original image
// bytes directly to the API.  Resolution/cost are slightly worse, but the
// diagnosis still works.

import { InvalidImageError } from "./errors.js";
import type { ImageInput } from "./request-schema.js";

export const MAX_LONG_EDGE = 2_576;
export const MAX_VISUAL_TOKENS = 4_784;
const PATCH_SIZE = 28;
const MAX_INPUT_PIXELS = 40_000_000;

export interface PreparedImage {
  data: string;
  media_type: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
}

export function visualTokenCount(width: number, height: number): number {
  return (
    Math.ceil(width / PATCH_SIZE) * Math.ceil(height / PATCH_SIZE)
  );
}

export function targetDimensions(
  width: number,
  height: number,
): { width: number; height: number } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new InvalidImageError("The image has invalid dimensions.");
  }

  const longEdgeScale = Math.min(1, MAX_LONG_EDGE / Math.max(width, height));
  const tokenScale = Math.min(
    1,
    Math.sqrt(
      (MAX_VISUAL_TOKENS * PATCH_SIZE * PATCH_SIZE) / (width * height),
    ),
  );
  let scale = Math.min(longEdgeScale, tokenScale);
  let targetWidth = Math.max(1, Math.floor(width * scale));
  let targetHeight = Math.max(1, Math.floor(height * scale));

  while (visualTokenCount(targetWidth, targetHeight) > MAX_VISUAL_TOKENS) {
    scale *= 0.995;
    targetWidth = Math.max(1, Math.floor(width * scale));
    targetHeight = Math.max(1, Math.floor(height * scale));
  }

  return { width: targetWidth, height: targetHeight };
}

function orientedDimensions(
  width: number,
  height: number,
  orientation: number | undefined,
): { width: number; height: number } {
  return orientation !== undefined && orientation >= 5 && orientation <= 8
    ? { width: height, height: width }
    : { width, height };
}

// ---------------------------------------------------------------------------
// Sharp integration (optional — fails gracefully on old CPUs)
// ---------------------------------------------------------------------------

type SharpModule = typeof import("sharp");
let sharpModule: SharpModule | null | undefined = undefined; // undefined = not probed yet

async function tryGetSharp(): Promise<SharpModule | null> {
  if (sharpModule !== undefined) return sharpModule;
  try {
    const mod = await import("sharp");
    sharpModule = mod.default as SharpModule;
    return sharpModule;
  } catch {
    sharpModule = null;
    console.warn(
      "sharp is unavailable on this CPU (likely no AVX2 support). " +
      "Images will be forwarded to the API without server-side resize.",
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Image preparation
// ---------------------------------------------------------------------------

async function prepareImageWithSharp(
  sharp: SharpModule,
  image: ImageInput,
  index: number,
): Promise<PreparedImage> {
  const source = Buffer.from(image.data, "base64");
  const inspector = (sharp as unknown as (buf: Buffer, opts: object) => { metadata(): Promise<{ width?: number; height?: number; orientation?: number }> })(source, {
    failOn: "warning",
    limitInputPixels: MAX_INPUT_PIXELS,
    sequentialRead: true,
  });
  const metadata = await inspector.metadata();
  if (!metadata.width || !metadata.height) {
    throw new InvalidImageError(`Image ${index + 1} has no readable dimensions.`);
  }

  const oriented = orientedDimensions(metadata.width, metadata.height, metadata.orientation);
  const target = targetDimensions(oriented.width, oriented.height);

  const sharpFn = sharp as unknown as (buf: Buffer, opts: object) => {
    rotate(): unknown;
    resize(w: number, h: number, opts: object): unknown;
    flatten(opts: object): unknown;
    jpeg(opts: object): { toBuffer(opts: object): Promise<{ data: Buffer; info: { width: number; height: number } }> };
  };

  const instance = sharpFn(source, {
    failOn: "warning",
    limitInputPixels: MAX_INPUT_PIXELS,
    sequentialRead: true,
  });

  // Chain fluent calls
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipeline = (instance as any)
    .rotate()
    .resize(target.width, target.height, { fit: "fill", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90, chromaSubsampling: "4:4:4" });

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

  return {
    data: (data as Buffer).toString("base64"),
    media_type: "image/jpeg",
    width: (info as { width: number; height: number }).width,
    height: (info as { width: number; height: number }).height,
  };
}

function passthroughImage(image: ImageInput, index: number): PreparedImage {
  const bytes = Buffer.byteLength(image.data, "base64");
  if (bytes > MAX_INPUT_PIXELS * 4) {
    throw new InvalidImageError(`Image ${index + 1} exceeds the maximum allowed size.`);
  }
  return {
    data: image.data,
    media_type: image.media_type,
    // Width/height unknown without decoding — use 0 as sentinel.
    // The API doesn't require these fields for base64 inline images.
    width: 0,
    height: 0,
  };
}

async function prepareImage(image: ImageInput, index: number): Promise<PreparedImage> {
  const sharp = await tryGetSharp();
  if (!sharp) {
    return passthroughImage(image, index);
  }
  try {
    return await prepareImageWithSharp(sharp, image, index);
  } catch (error) {
    if (error instanceof InvalidImageError) throw error;
    throw new InvalidImageError(
      `Image ${index + 1} is corrupt, unsupported, or too large to process.`,
      error,
    );
  }
}

export async function prepareImages(
  images: ImageInput[],
): Promise<PreparedImage[]> {
  return Promise.all(images.map(prepareImage));
}
