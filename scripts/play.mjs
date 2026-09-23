/**
 * One-command launcher for House of Ghouls. Starts the game server and the visual client, waits
 * for the client to come up, and opens your browser to it — from a single command (`npm run play`)
 * or a double-click (Play-HouseOfGhouls.bat on Windows, play.command on macOS).
 *
 * On first run it also copies the .env files from their examples and installs dependencies, so a
 * fresh clone goes from zero to playing with one action. Cross-platform (Windows/macOS/Linux).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, copyFileSync, readFileSync, statSync, readdirSync, createReadStream } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = path.join(ROOT, "client");
const DIST = path.join(CLIENT, "dist");
const PORT = 8081;
const CLIENT_URL = `http://localhost:${PORT}`;
const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";
// `--dev` uses the Expo dev bundler (slower, hot-reload); default builds a fast static bundle.
const DEV = process.argv.includes("--dev");

const c = {
  gold: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
};

function banner() {
  console.log(c.gold("\n  ┌───────────────────────────────────┐"));
  console.log(c.gold("  │        H O U S E   O F            │"));
  console.log(c.gold("  │           G H O U L S             │"));
  console.log(c.gold("  └───────────────────────────────────┘\n"));
}

/** Ensure the two .env files exist (copied from examples on first run). */
function ensureEnv() {
  for (const [file, example] of [
    [path.join(ROOT, ".env"), path.join(ROOT, ".env.example")],
    [path.join(CLIENT, ".env"), path.join(CLIENT, ".env.example")],
  ]) {
    if (!existsSync(file) && existsSync(example)) {
      copyFileSync(example, file);
      console.log(c.green("✓ created ") + path.relative(ROOT, file) + c.dim(" (from example)"));
    }
  }
  // Warn (don't block) if the one required secret is still blank.
  try {
    const env = readFileSync(path.join(ROOT, ".env"), "utf8");
    const m = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m);
    if (!m || !m[1].trim()) {
      console.log(
        c.red("\n! Accounts need one secret before you can log in:") +
          "\n  Add SUPABASE_SERVICE_ROLE_KEY to the file " + c.gold(".env") +
          "\n  Get it at: Supabase dashboard → your project → Project Settings → API Keys → the secret key." +
          "\n  (The project URL + publishable key are already filled in.) Then relaunch.\n",
      );
    }
  } catch { /* .env unreadable; the server will report it */ }
}

/** Install dependencies on first run (root workspaces + the standalone client). */
function ensureDeps() {
  const installs = [];
  if (!existsSync(path.join(ROOT, "node_modules"))) installs.push(["root", ROOT]);
  if (!existsSync(path.join(CLIENT, "node_modules"))) installs.push(["client", CLIENT]);
  for (const [label, cwd] of installs) {
    console.log(c.gold(`\nInstalling ${label} dependencies (first run — this can take a few minutes)…\n`));
    const r = spawnSync(npm, ["install"], { cwd, stdio: "inherit", shell: isWin });
    if (r.status !== 0) {
      console.log(c.red(`\n✗ npm install failed in ${label}. Is Node.js installed? https://nodejs.org\n`));
      process.exit(1);
    }
  }
}

/** Pipe a child's output through, line-prefixed so server/client logs stay legible. */
function pipe(child, label, color) {
  const tag = color(`[${label}]`) + " ";
  const onData = (buf) => {
    for (const line of buf.toString().split(/\r?\n/)) if (line.trim()) console.log(tag + line);
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
}

/** Resolve once a TCP port accepts a connection (client is serving). */
function waitForPort(port, timeoutMs = 120000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.connect({ port, host: "127.0.0.1" }, () => {
        sock.end();
        resolve();
      });
      sock.on("error", () => {
        sock.destroy();
        if (Date.now() - started > timeoutMs) reject(new Error("timeout"));
        else setTimeout(tryOnce, 1000);
      });
    };
    tryOnce();
  });
}

function openBrowser(url) {
  const [cmd, args] = isWin
    ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  try {
    const p = spawn(cmd, args, { detached: true, stdio: "ignore" });
    p.on("error", () => {}); // no browser opener available (e.g. headless) — the URL is printed anyway
    p.unref();
  } catch { /* ignore */ }
}

// --- production web build + static serving (the fast path) ------------------

/** Newest mtime under the client source, so we only rebuild when something changed. */
function newestSourceMtime() {
  const skip = new Set(["node_modules", "dist", ".expo", ".git"]);
  let newest = 0;
  const walk = (dir) => {
    let ents;
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else { try { newest = Math.max(newest, statSync(full).mtimeMs); } catch { /* ignore */ } }
    }
  };
  for (const p of [path.join(CLIENT, "src"), path.join(CLIENT, "assets"), path.join(CLIENT, "App.tsx"), path.join(CLIENT, "package.json"), path.join(CLIENT, ".env")]) {
    if (existsSync(p)) statSync(p).isDirectory() ? walk(p) : (newest = Math.max(newest, statSync(p).mtimeMs));
  }
  return newest;
}

/** Build the static web bundle if it's missing or older than the source (first run / after updates). */
function ensureWebBuild() {
  const index = path.join(DIST, "index.html");
  const fresh = existsSync(index) && statSync(index).mtimeMs >= newestSourceMtime();
  if (fresh) { console.log(c.dim("Using the existing web build (up to date).")); return; }
  console.log(c.gold("\nBuilding the web app (first run / after an update — this takes ~1 minute)…\n"));
  const r = spawnSync(npm, ["run", "build:web"], { cwd: CLIENT, stdio: "inherit", shell: isWin });
  if (r.status !== 0 || !existsSync(index)) {
    console.log(c.red("\n✗ Web build failed. Falling back to the dev bundler…\n"));
    return false; // caller falls back to `expo start`
  }
  return true;
}

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".map": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2", ".wasm": "application/wasm",
  ".txt": "text/plain",
};

/** A tiny static file server for the built app, with SPA fallback to index.html. */
function serveStatic(dir, port) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    let file = path.join(dir, urlPath);
    // prevent path traversal; default + fallback to index.html
    if (!file.startsWith(dir)) file = path.join(dir, "index.html");
    if (!existsSync(file) || statSync(file).isDirectory()) {
      const candidate = path.join(dir, urlPath, "index.html");
      file = existsSync(candidate) ? candidate : path.join(dir, "index.html");
    }
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
    createReadStream(file).on("error", () => { res.writeHead(404); res.end("not found"); }).pipe(res);
  });
  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.log(c.red(`\n! Port ${port} is already in use — is House of Ghouls already running in another window?`));
      console.log(c.dim(`  Close that window (or open ${CLIENT_URL}), then relaunch.\n`));
    } else {
      console.log(c.red(`\n! Web server error: ${err?.message ?? err}\n`));
    }
    process.exit(1);
  });
  server.listen(port, "0.0.0.0");
  return server;
}

async function main() {
  banner();
  ensureEnv();
  ensureDeps();

  // The client: a prebuilt static bundle (fast, quiet) unless --dev was passed.
  let useDevBundler = DEV;
  if (!DEV) {
    if (ensureWebBuild() === false) useDevBundler = true; // build failed → fall back
  }

  console.log(c.gold("\nStarting the game server" + (useDevBundler ? " and the dev client…" : "…")) + c.dim("  (Ctrl-C to stop everything)\n"));

  // detached on posix so we can signal the whole process group on shutdown; taskkill /T on Windows.
  const spawnOpts = { shell: isWin, detached: !isWin };
  const server = spawn(npm, ["run", "dev"], { cwd: ROOT, ...spawnOpts });
  pipe(server, "server", c.green);

  let client = null;
  let httpServer = null;
  if (useDevBundler) {
    client = spawn(npm, ["run", "web"], { cwd: CLIENT, ...spawnOpts });
    pipe(client, "client", c.gold);
  } else {
    httpServer = serveStatic(DIST, PORT);
    console.log(c.green(`[client] serving the built app on ${CLIENT_URL}`));
  }

  const kill = () => {
    for (const ch of [server, client]) {
      if (!ch || !ch.pid) continue;
      if (isWin) spawnSync("taskkill", ["/pid", String(ch.pid), "/T", "/F"], { stdio: "ignore" });
      else try { process.kill(-ch.pid, "SIGTERM"); } catch { try { ch.kill("SIGTERM"); } catch { /* gone */ } }
    }
    try { httpServer?.close(); } catch { /* ignore */ }
  };
  process.on("SIGINT", () => { console.log(c.dim("\nStopping…")); kill(); process.exit(0); });
  process.on("SIGTERM", () => { kill(); process.exit(0); });
  server.on("exit", (code) => { console.log(c.red(`server exited (${code})`)); kill(); process.exit(code ?? 1); });

  try {
    await waitForPort(PORT);
    console.log(c.green(`\n✓ House of Ghouls is ready — opening ${CLIENT_URL}\n`));
    openBrowser(CLIENT_URL);
    console.log(c.dim(`  If your browser doesn't open, go to ${CLIENT_URL} manually.\n`));
  } catch {
    console.log(c.red(`\n! Client didn't come up in time. Open ${CLIENT_URL} once it's ready.\n`));
  }
}

main();
