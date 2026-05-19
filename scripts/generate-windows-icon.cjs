#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(ROOT, "desktop", "src", "icon.png");
const TARGET = path.join(ROOT, "desktop", "src", "icon.ico");
const SIZES = [256, 128, 64, 48, 32, 24, 16];
const CORNER_RADIUS_RATIO = 0.225;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function alphaForRoundedRect(x, y, size, radius) {
  const px = x + 0.5;
  const py = y + 0.5;
  const half = size / 2;
  const qx = Math.abs(px - half) - (half - radius);
  const qy = Math.abs(py - half) - (half - radius);
  const outsideX = Math.max(qx, 0);
  const outsideY = Math.max(qy, 0);
  const outside = Math.hypot(outsideX, outsideY);
  const inside = Math.min(Math.max(qx, qy), 0);
  const signedDistance = outside + inside - radius;
  return clamp(0.5 - signedDistance, 0, 1);
}

function sampleArea(source, left, top, right, bottom) {
  const x0 = Math.floor(left);
  const x1 = Math.ceil(right);
  const y0 = Math.floor(top);
  const y1 = Math.ceil(bottom);
  let total = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;

  for (let sy = y0; sy < y1; sy++) {
    if (sy < 0 || sy >= source.height) continue;
    const oy = Math.max(0, Math.min(bottom, sy + 1) - Math.max(top, sy));
    if (oy <= 0) continue;

    for (let sx = x0; sx < x1; sx++) {
      if (sx < 0 || sx >= source.width) continue;
      const ox = Math.max(0, Math.min(right, sx + 1) - Math.max(left, sx));
      if (ox <= 0) continue;

      const weight = ox * oy;
      const index = (sy * source.width + sx) * 4;
      const alpha = source.data[index + 3] / 255;
      const weightedAlpha = alpha * weight;
      r += source.data[index] * weightedAlpha;
      g += source.data[index + 1] * weightedAlpha;
      b += source.data[index + 2] * weightedAlpha;
      a += weightedAlpha;
      total += weight;
    }
  }

  if (total === 0 || a === 0) return [0, 0, 0, 0];

  return [
    Math.round(r / a),
    Math.round(g / a),
    Math.round(b / a),
    Math.round((a / total) * 255),
  ];
}

function renderLayer(source, size) {
  const png = new PNG({ width: size, height: size, colorType: 6 });
  const sourceSize = Math.min(source.width, source.height);
  const sourceX = (source.width - sourceSize) / 2;
  const sourceY = (source.height - sourceSize) / 2;
  const radius = size * CORNER_RADIUS_RATIO;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const left = sourceX + (x / size) * sourceSize;
      const top = sourceY + (y / size) * sourceSize;
      const right = sourceX + ((x + 1) / size) * sourceSize;
      const bottom = sourceY + ((y + 1) / size) * sourceSize;
      const [r, g, b, a] = sampleArea(source, left, top, right, bottom);
      const coverage = alphaForRoundedRect(x, y, size, radius);
      const index = (y * size + x) * 4;

      png.data[index] = r;
      png.data[index + 1] = g;
      png.data[index + 2] = b;
      png.data[index + 3] = Math.round(a * coverage);
    }
  }

  return PNG.sync.write(png, { colorType: 6 });
}

function createIco(layers) {
  const headerSize = 6;
  const entrySize = 16;
  const directorySize = headerSize + layers.length * entrySize;
  const imageSize = layers.reduce((sum, layer) => sum + layer.data.length, 0);
  const out = Buffer.alloc(directorySize + imageSize);

  out.writeUInt16LE(0, 0);
  out.writeUInt16LE(1, 2);
  out.writeUInt16LE(layers.length, 4);

  let imageOffset = directorySize;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const entryOffset = headerSize + i * entrySize;
    out[entryOffset] = layer.size === 256 ? 0 : layer.size;
    out[entryOffset + 1] = layer.size === 256 ? 0 : layer.size;
    out[entryOffset + 2] = 0;
    out[entryOffset + 3] = 0;
    out.writeUInt16LE(1, entryOffset + 4);
    out.writeUInt16LE(32, entryOffset + 6);
    out.writeUInt32LE(layer.data.length, entryOffset + 8);
    out.writeUInt32LE(imageOffset, entryOffset + 12);
    layer.data.copy(out, imageOffset);
    imageOffset += layer.data.length;
  }

  return out;
}

function main() {
  const source = PNG.sync.read(fs.readFileSync(SOURCE));
  const layers = SIZES.map((size) => ({ size, data: renderLayer(source, size) }));
  fs.writeFileSync(TARGET, createIco(layers));
  console.log(`Generated ${path.relative(ROOT, TARGET)} (${SIZES.join(", ")} px)`);
}

main();
