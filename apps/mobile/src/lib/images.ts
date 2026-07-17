import type { CameraCapturedPicture } from "expo-camera";
import type { ImagePickerAsset } from "expo-image-picker";
import type { MediaType } from "./contract";

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

function supportedMediaType(value: string | null | undefined): MediaType {
  if (value === "image/png" || value === "image/webp" || value === "image/jpeg") {
    return value;
  }
  if (!value || value === "image/jpg") return "image/jpeg";
  throw new Error("FixSight supports JPEG, PNG, and WebP photos.");
}

export function fromCameraPicture(photo: CameraCapturedPicture): SelectedImage {
  if (!photo.base64) throw new Error("The camera did not return photo data. Try again.");
  return {
    id: id(),
    uri: photo.uri,
    data: rawBase64(photo.base64),
    mediaType: "image/jpeg",
  };
}

export function fromPickerAsset(asset: ImagePickerAsset): SelectedImage {
  if (!asset.base64) throw new Error("The selected photo could not be read. Try another.");
  return {
    id: id(),
    uri: asset.uri,
    data: rawBase64(asset.base64),
    mediaType: supportedMediaType(asset.mimeType),
  };
}
