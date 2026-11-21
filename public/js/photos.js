// Photo intake: resize, quality check, and on-photo annotation.

import { html, openModal, setHtml, uid } from "./ui.js";

// Long edge sent for analysis and kept for reports. The server downsizes to
// its own vision budget; 1920 px keeps detail while bounding upload size and
// on-device storage (roughly 0.3–0.8 MB per photo).
export const PHOTO_LONG_EDGE = 1920;
export const THUMB_LONG_EDGE = 360;
export const MAX_PHOTOS = 4;

export const ROLE_LABELS = { wide: "Wide shot", close_up: "Close-up", detail: "Detail" };

// ---------- quality assessment (pure; unit-tested in Node) ----------

export const QUALITY_THRESHOLDS = {
  // Variance of the Laplacian in the most detailed tiles of a ~320 px
  // grayscale downscale. Low values mean little sharp detail: motion blur,
  // missed focus — or a genuinely smooth surface, which is why this only warns.
  blurry: 18,
  dark: 45,
  // Share of near-white (clipped) pixels. Mean brightness would wrongly flag a
  // correctly exposed white ceiling; clipping is what loses detail.
  clipped: 0.35,
};

/**
 * Scores sharpness and exposure from a grayscale pixel array.
 * Returns { sharpness, brightness, warnings[] }.
 */
export function assessQuality(gray, width, height, thresholds = QUALITY_THRESHOLDS) {
  let sum = 0;
  let clippedCount = 0;
  for (let index = 0; index < gray.length; index += 1) {
    sum += gray[index];
    if (gray[index] >= 250) clippedCount += 1;
  }
  const brightness = gray.length ? sum / gray.length : 0;
  const clipped = gray.length ? clippedCount / gray.length : 0;

  const tilesX = 6;
  const tilesY = 6;
  const tileW = Math.max(3, Math.floor(width / tilesX));
  const tileH = Math.max(3, Math.floor(height / tilesY));
  const variances = [];
  for (let ty = 0; ty < tilesY; ty += 1) {
    for (let tx = 0; tx < tilesX; tx += 1) {
      let count = 0;
      let mean = 0;
      let m2 = 0;
      const x0 = Math.max(1, tx * tileW);
      const y0 = Math.max(1, ty * tileH);
      const x1 = Math.min(width - 1, (tx + 1) * tileW);
      const y1 = Math.min(height - 1, (ty + 1) * tileH);
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = y * width + x;
          const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
          count += 1;
          const delta = lap - mean;
          mean += delta / count;
          m2 += delta * (lap - mean);
        }
      }
      if (count > 1) variances.push(m2 / (count - 1));
    }
  }
  variances.sort((a, b) => a - b);
  // The 80th-percentile tile: a photo is sharp if its detailed parts are sharp,
  // even when most of the frame is plain wall.
  const sharpness = variances.length ? variances[Math.floor(variances.length * 0.8)] : 0;

  const warnings = [];
  if (brightness < thresholds.dark) warnings.push("dark");
  if (clipped > thresholds.clipped) warnings.push("bright");
  if (sharpness < thresholds.blurry) warnings.push("blurry");
  return { sharpness: Math.round(sharpness), brightness: Math.round(brightness), clipped: Math.round(clipped * 100) / 100, warnings };
}

export const QUALITY_MESSAGES = {
  blurry: "This photo may be blurry or low on detail. Hold steady and tap to focus on the problem.",
  dark: "This photo looks dark. Turn on lights or use daylight.",
  bright: "This photo looks washed out. Avoid glare and direct flash.",
};

// ---------- browser image handling ----------

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("This photo format isn't supported here. Use a JPEG or PNG photo."));
    image.src = src;
  });
}

function scaledCanvas(image, longEdge) {
  const scale = Math.min(1, longEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function grayscaleOf(image, longEdge = 320) {
  const canvas = scaledCanvas(image, longEdge);
  const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    gray[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  return { gray, width: canvas.width, height: canvas.height };
}

/** Reads a File into a stored photo record: resized JPEG, thumbnail, quality. */
export async function photoFromFile(file) {
  if (!file.type.startsWith("image/") && file.type !== "") {
    throw new Error("That file isn't a photo.");
  }
  const url = URL.createObjectURL(file);
  try {
    // Browsers apply EXIF orientation when drawing an <img> to a canvas.
    const image = await loadImage(url);
    const dataUrl = scaledCanvas(image, PHOTO_LONG_EDGE).toDataURL("image/jpeg", 0.82);
    const thumb = scaledCanvas(image, THUMB_LONG_EDGE).toDataURL("image/jpeg", 0.7);
    const { gray, width, height } = grayscaleOf(image);
    return {
      id: uid("photo"),
      dataUrl,
      thumb,
      role: null,
      annotated: false,
      marks: [],
      originalDataUrl: null,
      quality: assessQuality(gray, width, height),
      addedAt: new Date().toISOString(),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- request size budget ----------

// Vercel Functions reject request bodies over 4.5 MB (413
// FUNCTION_PAYLOAD_TOO_LARGE). Photos travel as base64 inside JSON, so all
// photos together must stay under this many characters, leaving headroom for
// the description, readings, and answers.
export const PHOTO_PAYLOAD_BUDGET = 3_800_000;
const SHRINK_STEPS = [[1600, 0.8], [1280, 0.75], [1024, 0.7], [800, 0.65]];

export function payloadSize(photos) {
  return photos.reduce((total, photo) => total + photo.dataUrl.length, 0);
}

/**
 * Returns photos that fit the request budget. Usually the stored photos as-is;
 * otherwise copies re-encoded smaller for this request only (stored photos and
 * reports keep full quality). Each step re-encodes from the stored original.
 */
export async function fitPhotosToBudget(photos, budget = PHOTO_PAYLOAD_BUDGET) {
  if (payloadSize(photos) <= budget) return photos;
  const images = await Promise.all(photos.map((photo) => loadImage(photo.dataUrl)));
  for (const [edge, quality] of SHRINK_STEPS) {
    const resized = photos.map((photo, index) => ({
      ...photo,
      dataUrl: scaledCanvas(images[index], edge).toDataURL("image/jpeg", quality),
    }));
    if (payloadSize(resized) <= budget) return resized;
  }
  throw new Error("These photos are too large to send together. Remove one and try again.");
}

export async function thumbFromDataUrl(dataUrl) {
  const image = await loadImage(dataUrl);
  return scaledCanvas(image, THUMB_LONG_EDGE).toDataURL("image/jpeg", 0.7);
}

// ---------- annotation ----------

function drawStrokes(context, strokes, width, height) {
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    context.strokeStyle = "#ff2d2d";
    context.lineWidth = Math.max(3, stroke.width * Math.max(width, height));
    context.beginPath();
    const [first, ...rest] = stroke.points;
    context.moveTo(first[0] * width, first[1] * height);
    if (rest.length === 0) context.lineTo(first[0] * width + 0.1, first[1] * height + 0.1);
    for (const [x, y] of rest) context.lineTo(x * width, y * height);
    context.stroke();
  }
}

/**
 * Lets the user circle or arrow the problem. Strokes are stored in normalized
 * coordinates so they can be re-edited; the flattened image is what the model
 * sees, labelled as annotated. Resolves with an updated photo, or null.
 */
export async function annotatePhoto(photo) {
  const base = await loadImage(photo.originalDataUrl ?? photo.dataUrl);
  const strokes = structuredClone(photo.marks ?? []);

  return openModal((dialog, close) => {
    dialog.classList.add("modal-wide");
    setHtml(dialog, html`
      <h2 class="modal-title">Mark the problem</h2>
      <p class="muted small">Draw a circle or arrow around the problem area. FixSight tells the AI these marks are yours, not damage.</p>
      <div class="annotate-stage"><canvas class="annotate-canvas" aria-label="Photo to mark. Draw with your finger or mouse."></canvas></div>
      <div class="modal-actions modal-actions-spread">
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" data-action="undo">Undo</button>
          <button type="button" class="btn btn-secondary" data-action="clear">Clear</button>
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" data-action="cancel">Cancel</button>
          <button type="button" class="btn btn-primary" data-action="save">Save marks</button>
        </div>
      </div>`);

    const canvas = dialog.querySelector("canvas");
    const stage = dialog.querySelector(".annotate-stage");
    const context = canvas.getContext("2d");

    function fit() {
      const maxWidth = stage.clientWidth || 600;
      const maxHeight = Math.min(window.innerHeight * 0.6, 640);
      const scale = Math.min(maxWidth / base.naturalWidth, maxHeight / base.naturalHeight, 1);
      canvas.width = Math.round(base.naturalWidth * scale);
      canvas.height = Math.round(base.naturalHeight * scale);
      redraw();
    }
    function redraw() {
      context.drawImage(base, 0, 0, canvas.width, canvas.height);
      drawStrokes(context, strokes, canvas.width, canvas.height);
    }

    let current = null;
    function point(event) {
      const rect = canvas.getBoundingClientRect();
      return [
        Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
        Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      ];
    }
    canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      current = { width: 0.008, points: [point(event)] };
      strokes.push(current);
      redraw();
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!current) return;
      event.preventDefault();
      current.points.push(point(event));
      redraw();
    });
    const end = () => {
      current = null;
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);

    dialog.querySelector('[data-action="undo"]').addEventListener("click", () => {
      strokes.pop();
      redraw();
    });
    dialog.querySelector('[data-action="clear"]').addEventListener("click", () => {
      strokes.length = 0;
      redraw();
    });
    dialog.querySelector('[data-action="cancel"]').addEventListener("click", () => close(null));
    dialog.querySelector('[data-action="save"]').addEventListener("click", async () => {
      const original = photo.originalDataUrl ?? photo.dataUrl;
      if (strokes.length === 0) {
        close({ ...photo, dataUrl: original, originalDataUrl: null, annotated: false, marks: [], thumb: await thumbFromDataUrl(original) });
        return;
      }
      const full = document.createElement("canvas");
      full.width = base.naturalWidth;
      full.height = base.naturalHeight;
      const fullContext = full.getContext("2d");
      fullContext.drawImage(base, 0, 0);
      drawStrokes(fullContext, strokes, full.width, full.height);
      const dataUrl = full.toDataURL("image/jpeg", 0.85);
      close({
        ...photo,
        dataUrl,
        originalDataUrl: original,
        annotated: true,
        marks: strokes,
        thumb: await thumbFromDataUrl(dataUrl),
      });
    });

    requestAnimationFrame(fit);
  }, { label: "Mark the problem on the photo" });
}
