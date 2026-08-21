// Thin wrapper around the Eleventy CLI.
//
// In CI (GitHub Actions) `npm ci` installs node_modules normally right here and this just
// delegates straight to it. Locally on this machine, the repo lives inside a Google Drive
// "streaming" folder, which cannot host node_modules at all (npm install fails, and Windows
// junctions/symlinks into the folder are rejected outright — it isn't a real local NTFS
// mount). So node_modules for local dev lives in a plain folder instead
// (Documents/seenalready-node_modules-build) and this wrapper finds it via NODE_PATH,
// falling back to that known location if the normal local resolution comes up empty.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

const FALLBACK_NODE_MODULES = 'C:\\Users\\jdcyin\\Documents\\seenalready-node_modules-build\\node_modules';

// eleventy's package.json "exports" map only exposes "." and "./UserConfig" — a direct
// require.resolve('@11ty/eleventy/cmd.cjs') is blocked by Node regardless of whether the
// file exists on disk. So resolve the allowed "." entry first, then walk up to the package
// root (the directory whose package.json is actually named "@11ty/eleventy") and join
// cmd.cjs from there — that stays valid even if eleventy's internal src/ layout changes.
function findPackageRoot(fileInPackage, packageName) {
  let dir = dirname(fileInPackage);
  while (true) {
    const pkgJsonPath = join(dir, 'package.json');
    if (existsSync(pkgJsonPath)) {
      try {
        if (JSON.parse(readFileSync(pkgJsonPath, 'utf8')).name === packageName) return dir;
      } catch {
        // Malformed package.json above us in the tree — keep walking up.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveEleventyCli() {
  try {
    const pkgRoot = findPackageRoot(require.resolve('@11ty/eleventy'), '@11ty/eleventy');
    const cmdPath = pkgRoot && join(pkgRoot, 'cmd.cjs');
    if (cmdPath && existsSync(cmdPath)) {
      return { cmdPath, nodePath: process.env.NODE_PATH || '' };
    }
  } catch {
    // Fall through to the external node_modules.
  }
  const cmdPath = `${FALLBACK_NODE_MODULES}\\@11ty\\eleventy\\cmd.cjs`;
  if (!existsSync(cmdPath)) {
    console.error(
      'Could not find @11ty/eleventy. Run `npm install` here, or on Windows set up ' +
      `${FALLBACK_NODE_MODULES} per the "Commands" section of CLAUDE.md.`
    );
    process.exit(1);
  }
  return { cmdPath, nodePath: FALLBACK_NODE_MODULES };
}

const { cmdPath, nodePath } = resolveEleventyCli();
const result = spawnSync(process.execPath, [cmdPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_PATH: nodePath },
});
process.exit(result.status ?? 1);
