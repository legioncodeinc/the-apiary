// Generate the desktop-shell raster icons from assets/icon.svg (provenance:
// branding/hive/logos/hive-favicon.svg — the filled Hive badge, legible at 16px).
// Outputs are COMMITTED so the electron-builder packaging needs no rasterizer at
// build time; this script is a dev convenience (`npm run generate-icons`) for when
// the source SVG changes. Rasterizer: @resvg/resvg-js (prebuilt, no system deps).
import { Resvg } from "@resvg/resvg-js";
import pngToIco from "png-to-ico";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, "..", "assets");
mkdirSync(assets, { recursive: true });
const svg = readFileSync(join(assets, "icon.svg"));

const png = (size) =>
  Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng());

// App icon (mac/linux derive from 512) + cross-platform tray PNG (32).
writeFileSync(join(assets, "icon.png"), png(512));
writeFileSync(join(assets, "tray-icon.png"), png(32));

// Multi-resolution Windows .ico (app icon + Windows tray).
const ico = await pngToIco([16, 24, 32, 48, 64, 128, 256].map(png));
writeFileSync(join(assets, "icon.ico"), ico);

console.log("generated: icon.ico, icon.png (512), tray-icon.png (32)");
