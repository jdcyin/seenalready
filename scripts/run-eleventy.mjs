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
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);

const FALLBACK_NODE_MODULES = 'C:\\Users\\jdcyin\\Documents\\seenalready-node_modules-build\\node_modules';

function resolveEleventyCli() {
  try {
    return { cmdPath: require.resolve('@11ty/eleventy/cmd.cjs'), nodePath: process.env.NODE_PATH || '' };
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
