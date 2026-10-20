import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const assetsDir = path.resolve(projectRoot, 'src', 'assets');
const publicDir = path.resolve(projectRoot, 'public');

function resample(srcPng, targetW, targetH) {
  const dst = new PNG({ width: targetW, height: targetH });
  const xRatio = srcPng.width / targetW;
  const yRatio = srcPng.height / targetH;

  for (let dy = 0; dy < targetH; dy++) {
    const srcYStart = dy * yRatio;
    const srcYEnd = (dy + 1) * yRatio;

    for (let dx = 0; dx < targetW; dx++) {
      const srcXStart = dx * xRatio;
      const srcXEnd = (dx + 1) * xRatio;

      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;
      let totalWeight = 0;

      const y0 = Math.floor(srcYStart);
      const y1 = Math.min(srcPng.height - 1, Math.floor(srcYEnd));
      const x0 = Math.floor(srcXStart);
      const x1 = Math.min(srcPng.width - 1, Math.floor(srcXEnd));

      for (let sy = y0; sy <= y1; sy++) {
        const yWeight = Math.min(sy + 1, srcYEnd) - Math.max(sy, srcYStart);
        if (yWeight <= 0) continue;

        for (let sx = x0; sx <= x1; sx++) {
          const xWeight = Math.min(sx + 1, srcXEnd) - Math.max(sx, srcXStart);
          if (xWeight <= 0) continue;

          const weight = xWeight * yWeight;
          const srcIdx = (srcPng.width * sy + sx) << 2;
          const a = srcPng.data[srcIdx + 3] / 255;

          // Premultiplied alpha weighting for smooth edges and accurate color blending
          rSum += srcPng.data[srcIdx] * a * weight;
          gSum += srcPng.data[srcIdx + 1] * a * weight;
          bSum += srcPng.data[srcIdx + 2] * a * weight;
          aSum += srcPng.data[srcIdx + 3] * weight;
          totalWeight += weight;
        }
      }

      const dstIdx = (targetW * dy + dx) << 2;
      if (totalWeight > 0 && aSum > 0) {
        const finalA = aSum / totalWeight;
        const normFactor = finalA > 0 ? (255 / finalA) : 0;
        dst.data[dstIdx] = Math.min(255, Math.max(0, Math.round((rSum / totalWeight) * normFactor)));
        dst.data[dstIdx + 1] = Math.min(255, Math.max(0, Math.round((gSum / totalWeight) * normFactor)));
        dst.data[dstIdx + 2] = Math.min(255, Math.max(0, Math.round((bSum / totalWeight) * normFactor)));
        dst.data[dstIdx + 3] = Math.min(255, Math.max(0, Math.round(finalA)));
      } else {
        dst.data[dstIdx] = 0;
        dst.data[dstIdx + 1] = 0;
        dst.data[dstIdx + 2] = 0;
        dst.data[dstIdx + 3] = 0;
      }
    }
  }
  return dst;
}

// 1. Read original logo.png
const logoPath = path.join(assetsDir, 'logo.png');
const rawData = fs.readFileSync(logoPath);
const srcPng = PNG.sync.read(rawData);

// 2. Locate tight artwork content bounds
let minX = srcPng.width, maxX = 0, minY = srcPng.height, maxY = 0;
for (let y = 0; y < srcPng.height; y++) {
  for (let x = 0; x < srcPng.width; x++) {
    const idx = (srcPng.width * y + x) << 2;
    if (srcPng.data[idx + 3] > 5) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}

const contentW = maxX - minX + 1;
const contentH = maxY - minY + 1;
const centerX = Math.round((minX + maxX) / 2);
const centerY = Math.round((minY + maxY) / 2);

console.log(`Original logo bounds: content ${contentW}x${contentH} at center (${centerX}, ${centerY})`);

// 3. Create square crop with a tight 3.5% margin around the noodle bowl
const maxDim = Math.max(contentW, contentH);
const cropSize = Math.round(maxDim * 1.07); // ~3.5% padding per side
const startX = Math.round(centerX - cropSize / 2);
const startY = Math.round(centerY - cropSize / 2);

console.log(`Square crop: ${cropSize}x${cropSize} starting at (${startX}, ${startY})`);

const cropped = new PNG({ width: cropSize, height: cropSize });
for (let y = 0; y < cropSize; y++) {
  for (let x = 0; x < cropSize; x++) {
    const srcX = startX + x;
    const srcY = startY + y;
    const dstIdx = (cropSize * y + x) << 2;

    if (srcX >= 0 && srcX < srcPng.width && srcY >= 0 && srcY < srcPng.height) {
      const srcIdx = (srcPng.width * srcY + srcX) << 2;
      cropped.data[dstIdx] = srcPng.data[srcIdx];
      cropped.data[dstIdx + 1] = srcPng.data[srcIdx + 1];
      cropped.data[dstIdx + 2] = srcPng.data[srcIdx + 2];
      cropped.data[dstIdx + 3] = srcPng.data[srcIdx + 3];
    } else {
      cropped.data[dstIdx] = 0;
      cropped.data[dstIdx + 1] = 0;
      cropped.data[dstIdx + 2] = 0;
      cropped.data[dstIdx + 3] = 0;
    }
  }
}

// 4. Save cropped master logo.png
const croppedMasterBuffer = PNG.sync.write(cropped);
fs.writeFileSync(logoPath, croppedMasterBuffer);
console.log(`Updated master logo at: ${logoPath}`);

// 5. Generate high-res extension bar icons: 16, 32, 48, 128
const iconSizes = [16, 32, 48, 128];
for (const size of iconSizes) {
  const iconPng = resample(cropped, size, size);
  const iconBuffer = PNG.sync.write(iconPng);
  const outPath = path.join(publicDir, `icon-${size}.png`);
  fs.writeFileSync(outPath, iconBuffer);
  console.log(`Generated extension icon: ${outPath} (${size}x${size})`);
}

console.log('Icon generation completed successfully.');
