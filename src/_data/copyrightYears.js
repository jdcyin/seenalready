// Footer copyright range: from the site's first year to the build year, e.g. "2025–2026".
const FIRST_YEAR = 2025;
const now = new Date().getFullYear();
module.exports = now > FIRST_YEAR ? `${FIRST_YEAR}–${now}` : String(FIRST_YEAR);
