// Fails loudly on bad roll data instead of letting it ship silently — see "Content model" in
// CLAUDE.md. Run via `npm run build` and in CI before deploy.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CAMERAS_DIR = path.join(ROOT, 'src', 'cameras');
const POSTS_DIR = path.join(ROOT, 'src', 'posts');

function readFrontMatter(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  // Content front matter here is simple enough (no nested objects besides the `photos`
  // list) that a tiny hand-rolled parser avoids adding a YAML dependency just for this.
  const lines = match[1].split(/\r?\n/);
  const data = {};
  let currentKey = null;
  let currentList = null;
  let currentItem = null;
  for (const line of lines) {
    const listItemMatch = line.match(/^\s*-\s*(\w+):\s*(.*)$/);
    const itemContinuation = line.match(/^\s{4,}(\w+):\s*(.*)$/);
    const topLevel = line.match(/^(\w+):\s*(.*)$/);
    if (listItemMatch && currentList) {
      currentItem = {};
      currentList.push(currentItem);
      currentItem[listItemMatch[1]] = listItemMatch[2].trim();
    } else if (itemContinuation && currentItem) {
      currentItem[itemContinuation[1]] = itemContinuation[2].trim();
    } else if (topLevel) {
      currentKey = topLevel[1];
      if (topLevel[2].trim() === '') {
        currentList = [];
        data[currentKey] = currentList;
        currentItem = null;
      } else {
        data[currentKey] = topLevel[2].trim();
        currentList = null;
      }
    }
  }
  return data;
}

function fail(messages) {
  console.error(`\nvalidate-content: ${messages.length} problem(s) found:\n`);
  for (const m of messages) console.error(`  - ${m}`);
  console.error('');
  process.exit(1);
}

const problems = [];

if (!fs.existsSync(CAMERAS_DIR)) fail(['src/cameras/ does not exist']);

const cameraSlugs = new Set();
for (const file of fs.readdirSync(CAMERAS_DIR)) {
  if (!file.endsWith('.md')) continue;
  const data = readFrontMatter(path.join(CAMERAS_DIR, file));
  if (!data || !data.slug) {
    problems.push(`src/cameras/${file}: missing "slug" in front matter`);
    continue;
  }
  cameraSlugs.add(data.slug);
}

if (fs.existsSync(POSTS_DIR)) {
  for (const cameraFolder of fs.readdirSync(POSTS_DIR)) {
    const cameraPath = path.join(POSTS_DIR, cameraFolder);
    if (!fs.statSync(cameraPath).isDirectory()) continue;

    for (const file of fs.readdirSync(cameraPath)) {
      if (!file.endsWith('.md')) continue;
      const postFile = path.join(cameraPath, file);
      const rel = path.relative(ROOT, postFile);
      const data = readFrontMatter(postFile);

      if (!data) {
        problems.push(`${rel}: no front matter found`);
        continue;
      }
      if (!data.camera || !cameraSlugs.has(data.camera)) {
        problems.push(`${rel}: camera "${data.camera}" does not match any file in src/cameras/`);
      }
      if (!data.date || isNaN(Date.parse(data.date))) {
        problems.push(`${rel}: "date" is missing or unparseable (${data.date})`);
      }
      if (data.endDate && isNaN(Date.parse(data.endDate))) {
        problems.push(`${rel}: "endDate" is unparseable (${data.endDate})`);
      }
      if (!data.filmStock) {
        problems.push(`${rel}: missing "filmStock"`);
      }
      if (!data.filmFormat || !['35mm', '120mm'].includes(data.filmFormat)) {
        problems.push(`${rel}: "filmFormat" must be "35mm" or "120mm" (got "${data.filmFormat}")`);
      }
      if (!data.hero) {
        problems.push(`${rel}: missing "hero"`);
      } else if (!fs.existsSync(path.join(cameraPath, data.hero))) {
        problems.push(`${rel}: hero image not found at ${data.hero}`);
      }
      if (!Array.isArray(data.photos) || data.photos.length === 0) {
        problems.push(`${rel}: "photos" is missing or empty`);
      } else {
        for (const photo of data.photos) {
          if (!photo.src) {
            problems.push(`${rel}: a photo entry is missing "src"`);
          } else if (!fs.existsSync(path.join(cameraPath, photo.src))) {
            problems.push(`${rel}: photo not found at ${photo.src}`);
          }
          if (!photo.caption) {
            problems.push(`${rel}: photo ${photo.src || '?'} is missing a caption`);
          }
        }
      }
    }
  }
}

if (problems.length) fail(problems);
console.log(`validate-content: ok (${cameraSlugs.size} cameras checked)`);
