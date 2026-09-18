/** Filesystem anchors resolved once, relative to this source file. */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// server/src/paths.ts -> repo root is two levels up.
const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the repository root. */
export const REPO_ROOT = resolve(here, "..", "..");

/** Default location of the Step 1A world content (MINE-audited JSON). */
export const DEFAULT_CONTENT_DIR = resolve(
  REPO_ROOT,
  "houseofghouls-export",
  "content",
);

/** The .env the server reads (repo root). */
export const ENV_FILE = resolve(REPO_ROOT, ".env");
