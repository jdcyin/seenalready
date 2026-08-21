// One-off migration helper — parses the legacy Webflow post HTML and either reports what it
// found (--dry-run) or writes it into the new content model (default). Not part of the
// ongoing site; kept in scripts/ as a reference per CLAUDE.md's migration notes.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

// The repo lives on a Google Drive "streaming" filesystem (see CLAUDE.md's Windows note) which
// occasionally throws a spurious EISDIR/EPERM on an otherwise-fine file under sustained rapid
// I/O. Retry a few times with a short pause rather than fail the whole run over one hiccup.
function copyFileResilient(src, dest, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try {
      copyFileSync(src, dest);
      return;
    } catch (err) {
      if (i === attempts) throw err;
      const wait = i * 400;
      const until = Date.now() + wait;
      while (Date.now() < until) { /* brief synchronous pause */ }
    }
  }
}

const ROOT = path.join(import.meta.dirname, '..');
const CAMERAS = ['olympus35sp', 'olympus35trip', 'pentaxk1000', 'ricoh500gx', 'voigtlandervitobl'];
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP = new Set(
  (process.argv.find((a) => a.startsWith('--skip=')) || '').replace('--skip=', '').split(',').filter(Boolean)
);
// key: "<camera>/<NN>" -> overrides to apply after parsing (resolves a known conflict)
const OVERRIDES_ARG = process.argv.find((a) => a.startsWith('--overrides='));
const OVERRIDES = OVERRIDES_ARG ? JSON.parse(readFileSync(OVERRIDES_ARG.replace('--overrides=', ''), 'utf8')) : {};

function parsePost(camera, filename) {
  const filePath = path.join(ROOT, 'posts', camera, filename);
  const html = readFileSync(filePath, 'utf8');
  const number = parseInt(filename.match(/^(\d+)_/)[1], 10);

  // Filename: NN_STARTDATE[-ENDDATE]_FilmStock.html
  const fnMatch = filename.match(/^\d+_(\d{8})(?:-(\d{8}))?_(.+)\.html$/);
  const toISO = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  const filenameDate = fnMatch ? toISO(fnMatch[1]) : null;
  const filenameEndDate = fnMatch && fnMatch[2] ? toISO(fnMatch[2]) : null;
  const filenameFilm = fnMatch ? fnMatch[3] : null;

  // H1 comes in at least three formats seen in this codebase:
  //   "2025-01-17 to 2025-01-28 <br>Kodak Ektar 100"   (ISO, most cameras)
  //   "Developed: December 31, 2023, Fujifilm C200"     (prose, full month name)
  //   "Developed: Sep 13 2023 <br> Kodak Vision 500T CineFilm"  (prose, abbreviated month, no comma)
  const h1Match = html.match(/<h1 class="h1">([\s\S]*?)<\/h1>/);
  const h1Raw = h1Match ? h1Match[1].replace(/\s+/g, ' ').trim() : '';
  const MONTHS = {
    january: '01', jan: '01', february: '02', feb: '02', march: '03', mar: '03', april: '04', apr: '04',
    may: '05', june: '06', jun: '06', july: '07', jul: '07', august: '08', aug: '08',
    september: '09', sep: '09', sept: '09', october: '10', oct: '10', november: '11', nov: '11', december: '12', dec: '12',
  };
  let h1Date = null, h1EndDate = null, h1Film = null;
  const isoMatch = h1Raw.match(/(\d{4}-\d{2}-\d{2})(?:\s+to\s+(\d{4}-\d{2}-\d{2}))?/);
  const proseMatch = h1Raw.match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (isoMatch) {
    h1Date = isoMatch[1];
    h1EndDate = isoMatch[2] || null;
    const h1FilmMatch = h1Raw.match(/<br\s*\/?>\s*(.+)$/i);
    h1Film = h1FilmMatch ? h1FilmMatch[1].trim() : null;
  } else if (proseMatch) {
    const mm = MONTHS[proseMatch[1].toLowerCase()];
    if (mm) h1Date = `${proseMatch[3]}-${mm}-${proseMatch[2].padStart(2, '0')}`;
    const afterDate = h1Raw.slice(h1Raw.indexOf(proseMatch[0]) + proseMatch[0].length);
    h1Film = afterDate.replace(/^(<br\s*\/?>|[,\s])+/i, '').trim() || null;
  }

  // Hero: first .post-image img src
  const heroMatch = html.match(/class="post-image"[\s\S]*?<img[^>]*src="([^"]+)"/);
  const hero = heroMatch ? heroMatch[1].replace(/^\.?\.?\//, '').replace(/^images\//, '') : null;

  // Photos: figure > div > img, figcaption, in document order
  const photos = [];
  const figureRe = /<figure[\s\S]*?<img src="([^"]+)"[\s\S]*?<figcaption>([\s\S]*?)<\/figcaption>/g;
  let m;
  while ((m = figureRe.exec(html))) {
    const src = m[1].replace(/^\.?\.?\//, '').replace(/^images\//, '');
    const caption = m[2].replace(/\s+/g, ' ').trim();
    photos.push({ src, caption });
  }

  return {
    camera, number, filename,
    filenameDate, filenameEndDate, filenameFilm,
    h1Date, h1EndDate, h1Film,
    hero, photos,
    dateConflict: filenameDate !== h1Date,
    endDateConflict: (filenameEndDate || null) !== (h1EndDate || null),
  };
}

function slugifyFilm(str) {
  // Insert spaces before capitals/digits the same rough way the filenames encode them
  // (e.g. "KodakEktar100" -> "Kodak Ektar 100") — good enough for a human to eyeball/correct.
  return str.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').trim();
}

// Just the leading brand/word, for conflict detection — "FujifilmC200" and "Fujifilm C200"
// are the same film with different formatting (not a conflict); "FujifilmC200" and
// "Kodacolor 200" are actually different film (a real conflict worth asking about).
function filmBrand(str) {
  return ((str || '').match(/^[A-Za-z]+/) || [''])[0].toLowerCase();
}

const allPosts = [];
for (const camera of CAMERAS) {
  const dir = path.join(ROOT, 'posts', camera);
  const files = readdirSync(dir).filter((f) => /^\d+_.*\.html$/.test(f));
  for (const f of files) {
    allPosts.push(parsePost(camera, f));
  }
}

if (DRY_RUN) {
  const report = allPosts.map((p) => ({
    key: `${p.camera}/${String(p.number).padStart(2, '0')}`,
    filenameDate: p.filenameDate, filenameEndDate: p.filenameEndDate,
    h1Date: p.h1Date, h1EndDate: p.h1EndDate,
    filenameFilm: p.filenameFilm, h1Film: p.h1Film,
    dateConflict: p.dateConflict, endDateConflict: p.endDateConflict,
    photoCount: p.photos.length, hasHero: !!p.hero,
  }));
  console.error(`${allPosts.length} posts parsed.\n`);

  console.error('--- date conflicts (filename vs. H1 disagree) ---');
  for (const r of report) if (r.dateConflict || r.endDateConflict) console.error(`  ${r.key}: filename=${r.filenameDate}..${r.filenameEndDate}  h1=${r.h1Date}..${r.h1EndDate}`);

  console.error('\n--- film: filename vs. H1, side by side (eyeball for real mismatches, not just formatting) ---');
  for (const r of report) console.error(`  ${r.key.padEnd(24)} filename="${r.filenameFilm}"  h1="${r.h1Film}"`);

  console.error('\n--- duplicate (camera, date, endDate) across posts ---');
  const byDate = {};
  for (const r of report) {
    const k = `${r.key.split('/')[0]}|${r.filenameDate}|${r.filenameEndDate}`;
    (byDate[k] ||= []).push(r.key);
  }
  for (const [k, keys] of Object.entries(byDate)) if (keys.length > 1) console.error(`  ${k}: ${keys.join(', ')}`);

  console.error('\n--- missing hero or zero photos ---');
  for (const r of report) if (!r.hasHero || r.photoCount === 0) console.error(`  ${r.key}: hero=${r.hasHero} photos=${r.photoCount}`);

  process.exit(0);
}

// Write mode
let written = 0, skipped = 0;
for (const p of allPosts) {
  const key = `${p.camera}/${String(p.number).padStart(2, '0')}`;
  if (SKIP.has(key)) { skipped++; continue; }

  const override = OVERRIDES[key] || {};
  const date = override.date || p.filenameDate;
  const endDate = 'endDate' in override ? override.endDate : p.filenameEndDate;
  // The H1 text is what a human actually typed as visible page content — prefer it whenever
  // present (the filename is a compressed slug and more prone to typos, e.g. pentaxk1000/01's
  // filename says "...Cinfe..." where the H1 correctly says "...CineFilm..."). Only fall back
  // to the filename when a post's H1 omits film stock entirely.
  const filmStock = override.filmStock || p.h1Film || slugifyFilm(p.filenameFilm);

  const NN = String(p.number).padStart(2, '0');
  const destDir = path.join(ROOT, 'src', 'posts', p.camera, NN);
  const srcImgDir = path.join(ROOT, 'posts', p.camera, 'images');
  mkdirSync(destDir, { recursive: true });

  const heroDest = path.join(destDir, 'hero.jpg');
  if (p.hero && !existsSync(heroDest)) copyFileResilient(path.join(srcImgDir, p.hero), heroDest);

  // A handful of the legacy pages reference images that were never actually uploaded (broken
  // on the current live site too) — skip just that photo rather than fail the whole roll, and
  // report every one so it's a visible, reviewable gap rather than a silent content loss.
  const available = p.photos.filter((photo) => existsSync(path.join(srcImgDir, photo.src)));
  for (const photo of p.photos) {
    if (!available.includes(photo)) console.error(`  MISSING SOURCE IMAGE: ${p.camera}/${NN} — ${photo.src} ("${photo.caption}")`);
  }
  const photosOut = available.map((photo, i) => {
    const destName = `${String(i + 1).padStart(2, '0')}.jpg`;
    const photoDest = path.join(destDir, destName);
    if (!existsSync(photoDest)) copyFileResilient(path.join(srcImgDir, photo.src), photoDest);
    return { src: `./${NN}/${destName}`, caption: photo.caption };
  });

  const fm = [
    '---',
    `camera: ${p.camera}`,
    `number: ${p.number}`,
    `date: ${date}`,
    ...(endDate ? [`endDate: ${endDate}`] : []),
    `filmStock: ${filmStock}`,
    'filmFormat: 35mm',
    `hero: ./${NN}/hero.jpg`,
    'photos:',
    ...photosOut.flatMap((ph) => [`  - src: ${ph.src}`, `    caption: ${ph.caption.replace(/:/g, ' -')}`]),
    '---',
    '',
  ].join('\n');

  writeFileSync(path.join(ROOT, 'src', 'posts', p.camera, `${NN}.md`), fm);
  written++;
}
console.log(`Wrote ${written} posts, skipped ${skipped}.`);
