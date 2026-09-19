/**
 * One-command launcher for House of Ghouls. Starts the game server and the visual client, waits
 * for the client to come up, and opens your browser to it — from a single command (`npm run play`)
 * or a double-click (Play-HouseOfGhouls.bat on Windows, play.command on macOS).
 *
 * On first run it also copies the .env files from their examples and installs dependencies, so a
 * fresh clone goes from zero to playing with one action. Cross-platform (Windows/macOS/Linux).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, copyFileSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = path.join(ROOT, "client");
const CLIENT_URL = "http://localhost:8081";
const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";

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

async function main() {
  banner();
  ensureEnv();
  ensureDeps();

  console.log(c.gold("Starting the game server and the client…") + c.dim("  (Ctrl-C to stop everything)\n"));

  // detached on posix so we can signal the whole process group on shutdown; taskkill /T on Windows.
  const spawnOpts = { shell: isWin, detached: !isWin };
  const server = spawn(npm, ["run", "dev"], { cwd: ROOT, ...spawnOpts });
  const client = spawn(npm, ["run", "web"], { cwd: CLIENT, ...spawnOpts });
  pipe(server, "server", c.green);
  pipe(client, "client", c.gold);

  const kill = () => {
    for (const ch of [server, client]) {
      if (!ch.pid) continue;
      if (isWin) spawnSync("taskkill", ["/pid", String(ch.pid), "/T", "/F"], { stdio: "ignore" });
      else try { process.kill(-ch.pid, "SIGTERM"); } catch { try { ch.kill("SIGTERM"); } catch { /* gone */ } }
    }
  };
  process.on("SIGINT", () => { console.log(c.dim("\nStopping…")); kill(); process.exit(0); });
  process.on("SIGTERM", () => { kill(); process.exit(0); });
  server.on("exit", (code) => { console.log(c.red(`server exited (${code})`)); kill(); process.exit(code ?? 1); });

  try {
    await waitForPort(8081);
    console.log(c.green(`\n✓ House of Ghouls is ready — opening ${CLIENT_URL}\n`));
    openBrowser(CLIENT_URL);
    console.log(c.dim(`  If your browser doesn't open, go to ${CLIENT_URL} manually.\n`));
  } catch {
    console.log(c.red(`\n! Client didn't come up in time. Open ${CLIENT_URL} once it finishes bundling.\n`));
  }
}

main();
