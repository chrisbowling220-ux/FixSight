// Renders the FixSight app icons from one SVG. Run: npx tsx scripts/make-icons.ts
import sharp from "sharp";

function svg(size: number, padding: number): Buffer {
  const r = size / 2;
  const inner = r - padding;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" rx="${padding ? 0 : size * 0.22}" fill="#0e3a43"/>
    <circle cx="${r}" cy="${r}" r="${inner * 0.62}" fill="none" stroke="#7fd4e0" stroke-width="${inner * 0.12}"/>
    <circle cx="${r}" cy="${r}" r="${inner * 0.26}" fill="#e8842c"/>
    <path d="M ${r - inner * 0.9} ${r} H ${r - inner * 0.72} M ${r + inner * 0.72} ${r} H ${r + inner * 0.9} M ${r} ${r - inner * 0.9} V ${r - inner * 0.72} M ${r} ${r + inner * 0.72} V ${r + inner * 0.9}" stroke="#7fd4e0" stroke-width="${inner * 0.08}" stroke-linecap="round"/>
  </svg>`);
}

const out = new URL("../public/icons/", import.meta.url).pathname;
await sharp(svg(192, 0)).png().toFile(`${out}icon-192.png`);
await sharp(svg(512, 0)).png().toFile(`${out}icon-512.png`);
await sharp(svg(512, 90)).png().toFile(`${out}icon-maskable-512.png`);
await sharp(svg(180, 0)).flatten({ background: "#0e3a43" }).png().toFile(`${out}apple-touch-icon.png`);
console.log("Icons written to public/icons/");
