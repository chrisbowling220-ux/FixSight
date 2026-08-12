import type { CameraCapturedPicture } from "expo-camera";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { ImagePickerAsset } from "expo-image-picker";
import type { MediaType } from "./contract";

// Mirrors MAX_LONG_EDGE in the server's image-processing.ts. The server resizes
// as well, but only after the whole photo has crossed the wire: a current phone
// camera produces 8-12 MB, which is slow to upload on cellular and large enough
// to have been rejected by request validation. Downscaling here costs no detail
// the model can use, since the server would discard those pixels anyway.
const MAX_LONG_EDGE = 2_576;
const JPEG_QUALITY = 0.85;

export interface SelectedImage {
  id: string;
  uri: string;
  data: string;
  mediaType: MediaType;
}

function id(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function rawBase64(value: string): string {
  return value.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
}

/**
 * Downscales to the server's working resolution and re-encodes as JPEG.
 *
 * Always rendering through the manipulator — even when the photo is already
 * small enough — normalizes HEIC and other library formats the API does not
 * accept, so every scan sends a plain JPEG.
 */
async function toJpegBase64(
  uri: string,
  width: number,
  height: number,
): Promise<{ uri: string; data: string }> {
  const context = ImageManipulator.manipulate(uri);

  // Constraining one edge and leaving the other null preserves the aspect ratio.
  const longEdge = Math.max(width, height);
  if (Number.isFinite(longEdge) && longEdge > MAX_LONG_EDGE) {
    context.resize(
      width >= height
        ? { width: MAX_LONG_EDGE, height: null }
        : { width: null, height: MAX_LONG_EDGE },
    );
  }

  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: JPEG_QUALITY,
    base64: true,
  });

  if (!result.base64) {
    throw new Error("The photo could not be prepared for analysis. Try again.");
  }
  return { uri: result.uri, data: rawBase64(result.base64) };
}

export async function fromCameraPicture(
  photo: CameraCapturedPicture,
): Promise<SelectedImage> {
  const prepared = await toJpegBase64(photo.uri, photo.width, photo.height);
  return {
    id: id(),
    uri: prepared.uri,
    data: prepared.data,
    mediaType: "image/jpeg",
  };
}

export async function fromPickerAsset(
  asset: ImagePickerAsset,
): Promise<SelectedImage> {
  const prepared = await toJpegBase64(asset.uri, asset.width, asset.height);
  return {
    id: id(),
    uri: prepared.uri,
    data: prepared.data,
    mediaType: "image/jpeg",
  };
}
