/**
 * macOS app shell for local testing. Spawns the project server using
 * Electron's own bundled Node (no dependency on shell PATH), pointed at the
 * live project directory — so the API key stays in the project's .env, the
 * artifacts stay in the repo, and code changes apply without rebuilding.
 */
const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

// Distributable builds carry the whole server under app/server (see
// scripts/package-app.sh); the dev wrapper points at the live project instead.
const BUNDLED_SERVER = path.join(__dirname, "server");
const BUNDLED = fs.existsSync(path.join(BUNDLED_SERVER, "src", "server.ts"));
const SERVER_DIR =
  process.env.CAREER_COUNSELING_DIR ??
  (BUNDLED ? BUNDLED_SERVER : "/Users/michael/Claude Code/Career Counseling");
const PORT = 4780;
const URL = `http://localhost:${PORT}`;
let serverProc = null;

function ping() {
  return new Promise((resolve) => {
    const req = http.get(`${URL}/api/journey`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureServer() {
  if (await ping()) {
    console.log("app: reusing already-running server");
    return;
  }
  console.log(`app: starting server with Electron's bundled Node (${BUNDLED ? "bundled" : "project"} mode)…`);
  serverProc = spawn(
    process.execPath,
    ["--env-file-if-exists=.env", "src/server.ts"],
    {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        // Bundled builds keep artifacts per-user, never inside the .app.
        ...(BUNDLED ? { CC_ARTIFACTS_DIR: path.join(app.getPath("userData"), "artifacts") } : {}),
      },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  serverProc.on("exit", (code) => console.log(`app: server exited (${code})`));
  for (let i = 0; i < 60; i++) {
    if (await ping()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not become ready within 15s");
}

async function createWindow() {
  await ensureServer();
  const win = new BrowserWindow({
    width: 1180,
    height: 940,
    title: "Career Counseling",
    backgroundColor: "#EFE9E0",
    webPreferences: { contextIsolation: true },
  });
  win.loadURL(URL);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  console.log("app: window created");
}

app.whenReady().then(createWindow).catch((err) => {
  console.error("app: failed to start —", err.message);
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("window-all-closed", () => app.quit());
app.on("quit", () => serverProc?.kill());
