// Prepares the illustrative (non-roll) images: camera line etchings and film-canister
// cut-outs. Not part of the build — run by hand when one is added or replaced, and commit the
// output. Source photos should be on a plain light backdrop (white / pale gray).
//
//   node scripts/prep-images.mjs camera   <photo> <camera-slug>   # → src/cameras/img/<slug>.jpg + src/cameras/etch/<slug>.png
//   node scripts/prep-images.mjs canister <photo> <stock-slug>    # → src/film/canisters/<stock-slug>.png
//   node scripts/prep-images.mjs etch-all                         # re-etch every stored camera photo
//
// Etchings are alpha masks, not pictures: transparent background, line strength in the alpha
// channel. Pages paint them with CSS `mask` + `background-color: var(--fg)`, so the lines are
// black in light mode, beige in dark mode, and take the hover color — no second file.
// Canister cut-outs are ordinary full-color PNGs with the backdrop made transparent.
import { createRequire } from 'node:module';
import { readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const FALLBACK_NODE_MODULES = 'C:\\Users\\jdcyin\\Documents\\seenalready-node_modules-build\\node_modules';
let sharp;
try {
  sharp = require('sharp');
} catch {
  // Same external node_modules fallback as run-eleventy.mjs — see "Commands" in CLAUDE.md.
  sharp = require(join(FALLBACK_NODE_MODULES, 'sharp'));
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = {
  camera: { img: join(ROOT, 'src', 'cameras', 'img'), etch: join(ROOT, 'src', 'cameras', 'etch') },
  canister: join(ROOT, 'src', 'film', 'canisters'),
};

// ---- Shared: find the backdrop, crop to the subject --------------------------------------

// Median color of an image's outer border = its studio backdrop.
async function backdropColor(file) {
  const { data, info } = await sharp(file).flatten({ background: '#fff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info, px = [];
  const at = (x, y) => { const i = (y * w + x) * 3; px.push([data[i], data[i + 1], data[i + 2]]); };
  for (let x = 0; x < w; x += 2) { at(x, 0); at(x, h - 1); }
  for (let y = 0; y < h; y += 2) { at(0, y); at(w - 1, y); }
  const med = (k) => px.map((p) => p[k]).sort((a, b) => a - b)[px.length >> 1];
  return { r: med(0), g: med(1), b: med(2) };
}

// Crop to the subject (plus a little real backdrop, where the photo has any — cropping right
// through a drop shadow leaves a hard seam that later reads as a line).
async function cropToSubject(file, bg) {
  const meta = await sharp(file).metadata();
  const t = await sharp(file).flatten({ background: '#fff' }).trim({ background: bg, threshold: 30 }).toBuffer({ resolveWithObject: true });
  const bw = t.info.width, bh = t.info.height, ox = -t.info.trimOffsetLeft, oy = -t.info.trimOffsetTop;
  const m = Math.round(Math.max(bw, bh) * 0.08);
  const left = Math.max(0, ox - m), top = Math.max(0, oy - m);
  const right = Math.min(meta.width, ox + bw + m), bottom = Math.min(meta.height, oy + bh + m);
  return sharp(file).flatten({ background: '#fff' }).extract({ left, top, width: right - left, height: bottom - top }).toBuffer();
}

// Camera photos: subject centered on a uniform 4:3 canvas of its own backdrop color,
// so every etching sits at the same visual size in its grid.
async function prepPhoto(file, outJpg) {
  const bg = await backdropColor(file);
  const cropped = await cropToSubject(file, bg);
  const fit = await sharp(cropped).resize(1360, 1000, { fit: 'inside' }).toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = fit.info;
  await sharp({ create: { width: 1600, height: 1200, channels: 3, background: bg } })
    .composite([{ input: fit.data, left: Math.round((1600 - w) / 2), top: Math.round((1200 - h) / 2) }])
    .jpeg({ quality: 88 })
    .toFile(outJpg);
}

// ---- Etching ----------------------------------------------------------------------------

const W = 1200, H = 900;
// Edge-strength window mapped to line opacity: below LO is background texture/noise,
// above HI is a full-strength line.
const LO = 34, HI = 110;
// How much darker than the backdrop a pixel must be to count as subject, for the silhouette.
const BG_TOL = 14;
// Minimum local edge strength for a silhouette pixel to be drawn. A real outline is a crisp
// edge; a soft drop shadow's boundary is a gentle gradient and falls below this.
const SIL_MIN = 12;
// Below-subject clip: "clearly subject" = this much darker than the backdrop; padded by BOX_PAD px.
const BOX_TOL = 70, BOX_PAD = 4;

async function etch(inJpg, outPng) {
  const { data } = await sharp(inJpg)
    .resize(W, H, { fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .grayscale()
    .blur(1.4)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Sobel gradient magnitude.
  const alpha = Buffer.alloc(W * H);
  const mags = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const tl = data[i - W - 1], t = data[i - W], tr = data[i - W + 1];
      const l = data[i - 1], r = data[i + 1];
      const bl = data[i + W - 1], b = data[i + W], br = data[i + W + 1];
      const gx = tr + 2 * r + br - tl - 2 * l - bl;
      const gy = bl + 2 * b + br - tl - 2 * t - tr;
      const mag = Math.sqrt(gx * gx + gy * gy) / 4;
      mags[i] = mag;
      const a = Math.min(1, Math.max(0, (mag - LO) / (HI - LO)));
      alpha[i] = Math.round(Math.pow(a, 0.8) * 255);
    }
  }

  // Silhouette: Sobel alone loses the outline wherever a silver edge meets a white backdrop.
  // So flood-fill the backdrop in from the image border (anything within BG_TOL of the
  // border's own brightness), and draw every subject pixel touching it as a full line — if
  // the edge there is crisp.
  const borderVals = [];
  for (let x = 0; x < W; x++) borderVals.push(data[x], data[(H - 1) * W + x]);
  for (let y = 0; y < H; y++) borderVals.push(data[y * W], data[y * W + W - 1]);
  borderVals.sort((a, b) => a - b);
  const bgLevel = borderVals[Math.floor(borderVals.length * 0.1)] - BG_TOL;
  const bg = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const i = stack.pop();
    if (bg[i] || data[i] < bgLevel) continue;
    bg[i] = 1;
    const x = i % W;
    if (x > 0) stack.push(i - 1);
    if (x < W - 1) stack.push(i + 1);
    if (i >= W) stack.push(i - W);
    if (i < W * (H - 1)) stack.push(i + W);
  }
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (bg[i] || !(bg[i - 1] || bg[i + 1] || bg[i - W] || bg[i + W])) continue;
      let m = 0;
      for (let dy = -2 * W; dy <= 2 * W; dy += W) for (let dx = -2; dx <= 2; dx++) m = Math.max(m, mags[i + dy + dx] || 0);
      if (m >= SIL_MIN) alpha[i] = 255;
    }
  }

  // Clip everything below the subject (pixels clearly darker than the backdrop, so soft shadow
  // doesn't count). Only the bottom edge — that's where drop shadows sit, and where a shadow
  // running off the edge of the source photo leaves a seam; bright silver parts (a
  // pentaprism, say) can legitimately poke past the box on the other sides.
  let y1 = 0;
  const solid = bgLevel + BG_TOL - BOX_TOL;
  for (let i = 0; i < W * H; i++) if (data[i] < solid) y1 = Math.floor(i / W);
  alpha.fill(0, Math.min(W * H, (y1 + BOX_PAD + 1) * W));

  // Thicken (3×3 max filter): grids show these at roughly a third of their pixel size, where
  // single-pixel lines would all but vanish.
  const thick = Buffer.alloc(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      let m = 0;
      for (let dy = -W; dy <= W; dy += W) for (let dx = -1; dx <= 1; dx++) if (alpha[i + dy + dx] > m) m = alpha[i + dy + dx];
      thick[i] = m;
    }
  }

  // Black RGB + computed alpha. (Only the alpha matters for the CSS mask, but black RGB keeps
  // the PNG readable as a normal image when opened on its own.)
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) rgba[i * 4 + 3] = thick[i];
  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .png({ compressionLevel: 9, palette: true, colors: 64 })
    .toFile(outPng);
}

// ---- Canister cut-out -------------------------------------------------------------------

// Backdrop → transparent. Region-grows in from the border, stepping only between neighbours
// of near-identical color, so it follows a soft studio gradient but stops at the canister's
// edge. The result is cropped tight to the canister and scaled to a standard height.
async function cutout(file, outPng) {
  const { data, info } = await sharp(file).flatten({ background: '#fff' }).removeAlpha()
    .resize(1400, 1400, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const { data: gray } = await sharp(data, { raw: { width: w, height: h, channels: 3 } })
    .grayscale().blur(1.2).raw().toBuffer({ resolveWithObject: true });

  // Edge barrier: any noticeable edge, dilated by BARRIER px so small gaps in the canister's
  // outline are sealed. The backdrop fill below can't cross it — that's what keeps a white
  // label or a chrome cap (both close to the backdrop's own color) from being eaten.
  const EDGE = 9, BARRIER = 3;
  const edge = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1] - gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1];
      const gy = gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1] - gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1];
      if (Math.sqrt(gx * gx + gy * gy) / 4 > EDGE) edge[i] = 1;
    }
  }
  const barrier = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!edge[y * w + x]) continue;
      for (let dy = -BARRIER; dy <= BARRIER; dy++) for (let dx = -BARRIER; dx <= BARRIER; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < h && xx >= 0 && xx < w) barrier[yy * w + xx] = 1;
      }
    }
  }

  // Flood the backdrop in from the border through non-barrier pixels, then grow it back over
  // the barrier band where that band is still backdrop-colored (so the cut hugs the real edge
  // instead of sitting BARRIER px outside it).
  // A pixel also has to actually look like backdrop (close to the border's median color), so
  // a strongly colored region — a yellow label — can't be flooded even through a gap.
  const bd = await backdropColor(file);
  const COLOR_TOL = 40;
  const nearBackdrop = (i) => Math.abs(data[i * 3] - bd.r) <= COLOR_TOL && Math.abs(data[i * 3 + 1] - bd.g) <= COLOR_TOL && Math.abs(data[i * 3 + 2] - bd.b) <= COLOR_TOL;
  const bg = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop();
    if (bg[i] || barrier[i] || !nearBackdrop(i)) continue;
    bg[i] = 1;
    const x = i % w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w);
    if (i < w * (h - 1)) stack.push(i + w);
  }
  for (let pass = 0; pass < BARRIER + 1; pass++) {
    const grow = [];
    for (let i = 0; i < w * h; i++) {
      if (bg[i] || edge[i] || !nearBackdrop(i)) continue;
      const x = i % w;
      if ((x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (i >= w && bg[i - w]) || (i < w * (h - 1) && bg[i + w])) grow.push(i);
    }
    grow.forEach((i) => (bg[i] = 1));
  }
  // A canister sitting on a surface picks up a pale reflection underneath it. Its bottom rim is
  // dark plastic/metal, so anything below the lowest row with a run of dark pixels is surface,
  // not canister.
  let floor = h - 1;
  for (let y = h - 1; y >= 0; y--) {
    let dark = 0;
    for (let x = 0; x < w; x++) if (!bg[y * w + x] && gray[y * w + x] < 70) dark++;
    if (dark > w * 0.05) { floor = y; break; }
  }
  bg.fill(1, (floor + 1) * w);

  // RGBA with the backdrop transparent; alpha is a 3×3 average of the mask so the cut edge is
  // softened by a pixel rather than scissored. Track the subject's bounding box as we go.
  const rgba = Buffer.alloc(w * h * 4);
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
        sum += bg[yy * w + xx] ? 0 : 255; n++;
      }
      const a = Math.round(sum / n);
      rgba[i * 4] = data[i * 3]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3 + 2]; rgba[i * 4 + 3] = a;
      if (!bg[i]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    .resize({ height: 900, fit: 'inside' })
    .png({ compressionLevel: 9 })
    .toFile(outPng);
}

// ---- CLI ----------------------------------------------------------------------------------

const [cmd, photo, name] = process.argv.slice(2);
if (cmd === 'camera') {
  if (!photo || !name) throw new Error(`usage: node scripts/prep-images.mjs ${cmd} <photo> <name>`);
  const d = DIRS[cmd];
  mkdirSync(d.img, { recursive: true });
  mkdirSync(d.etch, { recursive: true });
  await prepPhoto(photo, join(d.img, `${name}.jpg`));
  await etch(join(d.img, `${name}.jpg`), join(d.etch, `${name}.png`));
  console.log(`${cmd} ${name}: photo + etching written`);
} else if (cmd === 'canister') {
  if (!photo || !name) throw new Error('usage: node scripts/prep-images.mjs canister <photo> <stock-slug>');
  mkdirSync(DIRS.canister, { recursive: true });
  await cutout(photo, join(DIRS.canister, `${name}.png`));
  console.log(`canister ${name}: cut-out written`);
} else if (cmd === 'etch-all') {
  for (const d of [DIRS.camera]) {
    mkdirSync(d.etch, { recursive: true });
    for (const f of readdirSync(d.img).filter((f) => f.endsWith('.jpg'))) {
      const out = join(d.etch, f.replace(/\.jpg$/, '.png'));
      await etch(join(d.img, f), out);
      console.log(`etched ${f}`);
    }
  }
} else {
  console.error('usage: node scripts/prep-images.mjs camera|canister <photo> <name>   |   etch-all');
  process.exit(1);
}
