# seenalready

A film photography blog. Static site, built with **11ty (Eleventy)**, deployed to GitHub Pages at the custom domain `seenalready.com`.

This file is the working spec for the ongoing rebuild (from hand-edited Webflow HTML to 11ty) and, once that's done, the reference for day-to-day work on the site. It's a living document — sections marked **(TBD)** get filled in as the corresponding phase of the rebuild completes; update this file in place rather than leaving it stale.

Rebuild plan: `C:\Users\jdcyin\.claude\plans\nifty-swimming-magpie.md`.

## Stack, and why

- **11ty**, not Astro. Astro's built-in content-collection schema validation was attractive, but this site's owner already has a similar site (a travel blog) built entirely in 11ty. One toolchain across both sites beats a marginal framework feature — see "Content model" below for how the validation guardrail is replicated without Astro.
- Templating: **Nunjucks** (11ty's default).
- Images: **`@11ty/eleventy-img`**, generating real responsive variants at build time (the current site's `srcset` attributes are fake — they repeat one file at every width descriptor; that does not carry forward).
- Output: static HTML to GitHub Pages via a GitHub Actions workflow (not "deploy from branch"). Custom domain preserved via a passthrough-copied `CNAME`.

## Information architecture

**Design reference: [featureshoot.com](https://www.featureshoot.com/)** — clean, image-first, minimal text. No newsletter box, no "submit your photos" CTA, no algorithmic "related/recommended" section anywhere, no counts/stats on browsing pages — nothing beyond "what's actually here."

There are **two page shapes**, and every page in the site is one of them:

1. **Catalogue** — a big centered page label, then a grid of square tiles (image + a single-line label, nothing else — no roll counts, no dates). Used for pure *listing/browsing* pages: `/camera/`, `/film/`, `/film/<format>/`.
2. **Featured** — a big centered page label (omitted on Home), one featured roll (square photo on one side, date + camera + a "Continue reading" button on the other), then a small "Recent" grid of rectangular cards below. Used for pages that are *about one specific thing*: Home, a specific camera (`/camera/<slug>/`), a specific film stock (`/film/<format>/<slug>/`).

Rules that fell out of this:
- **Camera is the primary organizing unit**; film is a secondary axis, browsed via format first (35mm/120mm) then stock.
- A roll's identity everywhere is its **date** — camera and film stock are secondary/muted, never the headline text.
- **Grid/tile captions never show place names** and never show counts. On a Featured page's recent grid, show date, plus camera name only when the page doesn't already imply it (Home and a film-stock page show date + camera; a camera page shows date alone).
- **No full-text/caption search.** A search hit landing on a caption rather than a real page was the wrong result shape — browse via the camera/film cross-sections instead.
- There is no author/byline anywhere.
- **Light and dark mode are both required.**
- Nav (`Cameras` / `Film` / `About`) is three plain links — **no dropdowns**. On scroll, the header collapses into a slim sticky bar with a hamburger toggle (right-aligned) that drops a full-width horizontal panel with the same three links.
- Images get a subtle inward-vignette dim on hover (like featureshoot.com); the roll page's "Continue reading"-equivalent affordances and other real links use the maroon accent on hover.

Site map:
- `/` — **Featured**: the single most recent roll across the whole site.
- `/camera/` — **Catalogue** of every camera.
- `/camera/<slug>/` — **Featured**, scoped to one camera.
- `/camera/<slug>/<NN>/` — one roll's detail page (its own template — see below). `<NN>` is that roll's number within its camera.
- `/film/` — **Catalogue**: exactly two tiles, `35mm` and `120mm`.
- `/film/<format>/` — **Catalogue** of every film stock used in that format.
- `/film/<format>/<slug>/` — **Featured**, scoped to one film stock (spans every camera that's used it).
- `/about/`.
- `/snapped/` — the full chronological archive, everything, one page. Not in the main nav; linked from the bottom of every Catalogue/Featured page ("See full archive →").

## Content model

No framework-level schema validation (11ty has none built in), so a small script fills that gap — **run it before trusting new or migrated content**:

- `scripts/validate-content.js` **(TBD — created during scaffolding)**: checks every post's `camera` field resolves to a real camera file, `filmFormat` is `35mm` or `120mm`, dates parse, `photos` is non-empty, and every image path referenced in front matter actually exists on disk. Run via `npm run build` (and in CI before deploy). A bad roll should fail the build loudly, not ship silently — that's the whole point of this script, given the current site has actual instances of mismatched/conflicting metadata that slipped through by hand.

Directory-data-file pattern (11ty's mechanism for shared front matter across a folder):

```
src/
  cameras/
    cameras.json          # { "tags": "cameras", "layout": "camera.njk" }
    <camera-slug>.md       # front matter: name, slug, order, cardImage (optional)
  posts/
    posts.json              # { "tags": "posts", "layout": "post.njk" }
    <camera-slug>/
      <NN>.md
      <NN>/
        hero.jpg
        01.jpg  02.jpg  ...
```

Post front matter:

```yaml
---
camera: olympus35sp          # must match an existing src/cameras/<slug>.md
number: 1                     # roll number within this camera — also the URL slug, see below
date: 2025-01-17
endDate: 2025-01-28            # optional — omit for a single-day roll
filmStock: Kodak Ektar 100
filmFormat: 35mm               # "35mm" or "120mm" — drives the /film/<format>/ grouping
hero: ./01/hero.jpg
photos:
  - src: ./01/01.jpg
    caption: Hanoi, Vietnam
  - src: ./01/02.jpg
    caption: Hanoi Cathedral, Vietnam
---
```

`filmFormat` is recorded per roll (not per camera) since it's really a property of what film was loaded, even though in practice one camera will almost always shoot one format — every current camera is 35mm, so `filmFormat: 35mm` will be the norm until a 120 camera is added.

**Slugs**: a roll's URL is `/camera/<camera-slug>/<NN>/` — `<NN>` is just its roll number *within that camera* (e.g. `/camera/olympus35sp/01/`), zero-padded two digits. No date, no film stock in the URL — those live in front matter and are displayed on the page itself.

**Camera-grouping** (for `/camera/<slug>/`) and **film-grouping** (for `/film/<format>/<slug>/`) both use 11ty's collection API: group the `posts` tag collection by the `camera` field for the former; for the latter, group first by `filmFormat`, then within that by a slugified `filmStock`. A `filmStock` value like "Kodak Ektar 100" slugifies to `kodak-ektar-100` for its URL — keep the display string (`filmStock`) and the derived slug separate rather than storing a pre-slugified field in front matter. The Home/camera/film-stock pages render via the **Featured** template; `/camera/`, `/film/`, `/film/<format>/` render via the **Catalogue** template — see Information architecture above.

## Date display format

Dates are a running log of when a roll was actually shot — format them as a plain, readable log entry, not a numeric date:

- Single day: `Jan 17, 2026`
- Range within the same month: `Jan 17–28, 2026`
- Range spanning months (same year): `Jan 28 – Feb 5, 2026`
- Range spanning years: `Dec 28, 2025 – Jan 5, 2026`

Compute this dynamically from `date`/`endDate` — never hand-type a formatted date per post. Implement as a single Nunjucks filter/shortcode in `.eleventy.js` **(TBD)** that every template calls, so the formatting logic lives in exactly one place.

**Roll page header layout**: the formatted date is the big headline at the top (Archivo, bold — see Design). Beneath it, a row about half the width of the photo column, camera on the left and film stock on the right, each with a small leading/trailing emoji (📷 camera, 🎞️ film) — not full-bleed to the page edges. No repeated "Cameras" label, no back-to-camera link at the bottom; just the photos and a copyright line.

## Adding a new roll of film

The expected day-to-day workflow: describe the roll to Claude Code in chat (camera, rough dates, film stock, and the photos+captions) and have it create the content.

1. Find the next roll number for that camera (highest existing `number` + 1).
2. Create `src/posts/<camera-slug>/<NN>.md` with front matter per the template above.
3. Create the matching `src/posts/<camera-slug>/<NN>/` folder with `hero.jpg` and numbered photos (`01.jpg`, `02.jpg`, …) matching the `photos` list.
4. Run `npm run build` and confirm `scripts/validate-content.js` passes.
5. Preview with `npx eleventy --serve` before committing.
6. Commit and push **to the current feature branch**, not `main` (see Git workflow).

## Design

Direction settled and approved via a design-canvas exploration (mockups covered every page type, in both themes). Token values below are final; implement them in `src/css/tokens.css` and consume via `var(--...)` — never hardcode colors/fonts.

**Fonts** — two families, both self-hosted (real `@font-face`, not a CDN `<link>`, since the actual production site should embed them the same way the mockups did):
- **Inter** (Google Fonts, free) — body copy, nav, all UI/metadata text. This matches featureshoot.com's real body font exactly.
- **Archivo**, weight ~800 (Google Fonts, free) — every headline: the wordmark, page labels, featured/roll dates. Chosen deliberately: the first pass used Newsreader (a free stand-in for featureshoot.com's actual paid headline font, Tiempos Headline) but it read as too soft/delicate; Archivo is blockier and heavier-weight, which was the wanted direction. Tiempos Headline itself is a licensed Klim Type Foundry font — not used, and would need a purchased license if ever revisited.

**Color** (light mode primary, dark mode inverts):
- Light: white background, black text/lines, no third neutral gray tier — hierarchy comes from weight/size, not tone.
- Dark: near-black background, warm **beige** text (not plain white/gray).
- **Maroon** accent (`oklch(0.34 0.13 25)` light / lightened for dark) on real links and hover states (dropdown/panel items, breadcrumbs, "See full archive," image links) — reserved for genuinely actionable things, not decorative.
- **Raisin/plum** (`oklch(0.3 0.08 322)` light / lightened for dark) is the *resting* color of the one real CTA, the "Continue reading" button on a Featured page — it turns maroon on hover, so it reads as distinct from ordinary links.
- Border/rule color is neutral black-or-gray in both themes (no warm tint) and drawn at 2px on structural rules (nav, footers, the roll page's header divider) — deliberately bold/graphic, not a soft hairline.

**Interaction**: every linked photo (featured image, recent-grid cards, catalogue tiles) gets a subtle inward vignette (dimmed edges) on hover, echoing featureshoot.com. Header collapses to a sticky compact bar on scroll (~40px threshold); a right-aligned hamburger toggles a full-width dropdown with the three nav links.

**Logo**: no image-generation tool is available in this environment, so the wordmark is typographic (Archivo), not an illustrated mark. If a vector icon/mark is wanted alongside it later, that's still open.

## Component/template map

Two page shapes cover the whole site (see Information architecture) — everything is one or the other, plus one unique roll-detail template. All content templating is Nunjucks — `.eleventy.js` explicitly sets `markdownTemplateEngine`/`htmlTemplateEngine` to `njk`, because 11ty's actual default for `.md` front matter is Liquid, not Nunjucks (a real gotcha hit during scaffolding: Liquid's filter-argument syntax is `filter: arg`, Nunjucks' is `filter(arg)` — they silently don't mix).

- `src/_includes/base.njk` — `<head>`, the sticky/collapsing nav header (hamburger + full-width dropdown panel, plain vanilla JS), footer. Single source of truth for all of this; every page's `layout` chains through it.
- **Catalogue template** — big centered page label + grid of square tiles (image + one-line label, no counts). Inlined directly in each page rather than factored into a shared layout file, since there are only four of them and each has a slightly different data source: `src/camera/index.njk`, `src/film/index.njk`, `src/film/35mm.njk`, `src/film/120mm.njk`, `src/snapped.njk` (the full archive uses the same tile grid).
- **Featured template** — big centered page label (Home omits it) + one featured roll (square image, date/camera/Continue-reading button) + a "Recent" grid of 3 rectangular cards below. `src/index.njk` (Home), `src/_includes/camera.njk` (used as the `layout` for every `src/cameras/<slug>.md` shell — generates `/camera/<slug>/`), `src/film/stock.njk` (a pagination template over the `filmStockList` collection — generates `/film/<format>/<slug>/` for every distinct film stock).
- `src/_includes/post.njk` — the roll detail page (`layout` for every `src/posts/<camera>/<NN>.md`): date header, inset camera/film row (with emoji), then a full-width stack of photos each with its own caption directly beneath (not a grid) — see "Date display format" above. Generates `/camera/<camera>/<NN>/`.
- `src/about.njk` — text above a full-bleed banner photo.
- Real responsive images throughout via the `{% photo src, alt, sizes, sourcePage %}` shortcode (`.eleventy.js`) — wraps `@11ty/eleventy-img`. `sourcePage` is only needed when a page renders another page's image (e.g. a roll's hero shown on its camera page); omit it when a template renders its own front matter's image.

## Commands

- `npm run dev` — local dev server with live reload (`eleventy --serve`), at `http://localhost:8080/`.
- `npm run build` — build to `_site/`, then run `scripts/validate-content.js`.

**Windows-specific note**: this repo lives inside a Google Drive–synced folder ("My Drive"), which turns out to be a cloud-projected filesystem, not a plain local one — `npm install` fails outright here (EPERM/EBADF), and Windows junctions/symlinks into the folder are rejected too ("Local NTFS volumes are required"). So on this machine, `node_modules` isn't installed in the repo at all — it lives in a separate plain folder, `C:\Users\jdcyin\Documents\seenalready-node_modules-build\` (its own throwaway `package.json`, not part of this repo). Both npm scripts run through `scripts/run-eleventy.mjs`, which resolves `@11ty/eleventy` normally first (so this is a no-op in CI/GitHub Actions, and for anyone working from a normal local clone) and only falls back to that external folder when the normal resolution comes up empty. If dependency versions change in this repo's `package.json`, re-run `npm install` inside that external folder too, using the same versions.

## Git workflow

- Active work happens on the **`seenaleady-new`** branch, not `main`.
- `main` is only touched via an explicit, user-approved merge once the rebuild is verified end-to-end (see the rebuild plan's Phasing section).
- Push to `main` is what triggers the GitHub Actions deploy — so nothing reaches the live site until that merge happens.

## Explicit non-goals

Do not reintroduce these, even incidentally:

- Hand-edited listing pages. `/`, `/camera/`, `/camera/<slug>/`, `/film/`, `/film/<format>/`, `/snapped/` must stay generated from content, never hand-maintained lists — that's exactly the bug class the current site has (a broken thumbnail, a missing camera, both from hand-copied markup drifting from reality).
- The jQuery/Webflow JS runtime, or anything resembling it. The nav's scroll-collapse/hamburger behavior is genuinely interactive but should stay a few lines of vanilla JS, not a framework runtime.
- Fake `srcset` (same image repeated at multiple width descriptors). Use `eleventy-img` for real responsive variants.
- An author/byline field, or any per-person concept. There is exactly one person behind this site and it isn't represented as content.
- Film stock (or film format) as a headline or primary sort/nav key. Camera is primary; format and stock are browsing axes, always secondary in display.
- Roll counts, stock counts, or any other tally shown on a Catalogue tile. Tiles are image + name, nothing else.
- A newsletter/subscriber box, a "submit your photos" CTA, or any algorithmic "related"/"recommended" section. Pages show only what's actually there — nothing dynamic beyond that.
- Place-name captions on Catalogue tiles or Featured-template recent-grid cards. Captions belong on the roll detail page only.
- Dropdown nav menus. Cameras/Film/About are plain links; browsing happens on real Catalogue pages, not in a nav flyout.
