const Image = require('@11ty/eleventy-img');
const path = require('node:path');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// See "Date display format" in CLAUDE.md — this is the one place the formatting logic lives.
function formatDate(date, endDate) {
  const start = new Date(date);
  // Days are always two digits ("Aug 08"), so dates line up as a log.
  const dd = (d) => String(d.getUTCDate()).padStart(2, '0');
  const sM = MONTHS[start.getUTCMonth()], sD = dd(start), sY = start.getUTCFullYear();

  if (!endDate) return `${sM} ${sD}, ${sY}`;

  const end = new Date(endDate);
  const eM = MONTHS[end.getUTCMonth()], eD = dd(end), eY = end.getUTCFullYear();

  if (sY !== eY) return `${sM} ${sD}, ${sY} – ${eM} ${eD}, ${eY}`;
  if (sM !== eM) return `${sM} ${sD} – ${eM} ${eD}, ${eY}`;
  return `${sM} ${sD}–${eD}, ${eY}`;
}

function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy('CNAME');
  eleventyConfig.addPassthroughCopy('src/css');
  eleventyConfig.addPassthroughCopy('src/fonts');
  eleventyConfig.addPassthroughCopy('src/favicon.ico');
  // Made by scripts/prep-images.mjs: camera line etchings and film-canister cut-outs.
  eleventyConfig.addPassthroughCopy({ 'src/cameras/etch': 'img/etch' });
  eleventyConfig.addPassthroughCopy({ 'src/film/canisters': 'img/canisters' });

  eleventyConfig.addFilter('formatDate', formatDate);
  eleventyConfig.addFilter('slugify', slugify);
  eleventyConfig.addFilter('pad2', (n) => String(n).padStart(2, '0'));
  eleventyConfig.addFilter('cameraName', (slug, cameras) => {
    const match = (cameras || []).find((c) => c.data.slug === slug);
    return match ? match.data.name : slug;
  });
  // Plain JS-style [start, end) slice — Nunjucks' built-in `slice` filter instead divides
  // an array into N groups (Jinja2 semantics), which is never what a template here wants.
  eleventyConfig.addFilter('arraySlice', (arr, start, end) => (arr || []).slice(start, end));
  eleventyConfig.addFilter('byFilmFormat', (posts, format) => (posts || []).filter((p) => p.data.filmFormat === format));
  eleventyConfig.addFilter('whereFormat', (stockList, format) => (stockList || []).filter((s) => s.format === format));
  // A photo's print ID: <camera>-<roll NN>-<photo file stem>, e.g. olympus35sp-01-03 for
  // ./01/03.jpg in src/posts/olympus35sp/01.md. Stable as long as files aren't renamed.
  eleventyConfig.addFilter('printId', (camera, number, src) =>
    `${camera}-${String(number).padStart(2, '0')}-${path.basename(src, path.extname(src))}`);
  // A film stock's brand, for the /film/<format>/ brand filter: its first word, with product
  // lines folded into their maker ("Kodacolor 200" → Kodak).
  const BRAND_ALIASES = { Kodacolor: 'Kodak' };
  const filmBrand = (stock) => {
    const first = String(stock).trim().split(/\s+/)[0];
    return BRAND_ALIASES[first] || first;
  };
  eleventyConfig.addFilter('filmBrand', filmBrand);
  eleventyConfig.addFilter('filmBrands', (stockList) =>
    [...new Set((stockList || []).map((s) => filmBrand(s.filmStock)))].sort());
  eleventyConfig.addFilter('year', (date) => new Date(date).getUTCFullYear());
  // Distinct years across all posts, newest first — powers the /snapped/ year filter.
  eleventyConfig.addFilter('uniqueYears', (posts) => {
    const years = new Set((posts || []).map((p) => new Date(p.data.date).getUTCFullYear()));
    return [...years].sort((a, b) => b - a);
  });

  // Real responsive images at build time — replaces the current site's fake srcset
  // (same file repeated at every width descriptor). `sourcePage` is only needed when
  // rendering another page's image (e.g. a post's hero shown on its camera page) — it
  // defaults to the current page, since `src` is always relative to wherever the front
  // matter that names it actually lives.
  eleventyConfig.addAsyncShortcode('photo', async function (src, alt, sizes = '100vw', sourcePage) {
    const base = (sourcePage || this.page).inputPath;
    const inputPath = path.join(base, '..', src);
    const metadata = await Image(inputPath, {
      widths: [500, 800, 1200, 1800],
      formats: ['webp', 'jpeg'],
      outputDir: '_site/img/',
      urlPath: '/img/',
    });
    return Image.generateHTML(metadata, {
      alt,
      sizes,
      loading: 'lazy',
      decoding: 'async',
    });
  });

  // Camera catalogue / camera detail pages group by `camera`.
  eleventyConfig.addCollection('postsByCamera', (api) => {
    const groups = {};
    for (const post of api.getFilteredByTag('posts')) {
      const key = post.data.camera;
      (groups[key] ||= []).push(post);
    }
    return groups;
  });

  // Flat list of {format, stockSlug, filmStock, posts}, one entry per distinct film-stock-within-format.
  // Format catalogue pages (/film/<format>/) filter this by format; stock detail pages
  // (/film/<format>/<slug>/) paginate over it directly.
  eleventyConfig.addCollection('filmStockList', (api) => {
    const byKey = {};
    for (const post of api.getFilteredByTag('posts')) {
      const format = post.data.filmFormat;
      const stockSlug = slugify(post.data.filmStock);
      const key = `${format}/${stockSlug}`;
      (byKey[key] ||= { format, stockSlug, filmStock: post.data.filmStock, posts: [] }).posts.push(post);
    }
    return Object.values(byKey);
  });

  return {
    // 11ty's actual default for .md front matter/data templating is Liquid, not Nunjucks —
    // pin both engines to Nunjucks so there's exactly one templating syntax in this project.
    markdownTemplateEngine: 'njk',
    htmlTemplateEngine: 'njk',
    dir: { input: 'src', output: '_site', includes: '_includes' },
  };
};
