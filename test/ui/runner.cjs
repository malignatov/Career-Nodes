/**
 * UI test runner: hosts the braid in a hidden Electron window (the app's own
 * renderer, throttling off) and collects the driver's results.
 *   npm run test:ui
 */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1280, height: 800,
    webPreferences: { contextIsolation: true, backgroundThrottling: false },
  });
  win.webContents.on("console-message", (e, level, message) => {
    if (level >= 2) console.error("[page]", message);
  });
  await win.loadFile(path.join(__dirname, "host.html"));
  const t0 = Date.now();
  let results = null;
  for (;;) {
    results = await win.webContents.executeJavaScript("window.__uiResults || null");
    if (results) break;
    if (Date.now() - t0 > 150000) {
      console.error("UI tests timed out after 150s");
      return app.exit(2);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  let fails = 0;
  for (const r of results) {
    console.log(`${r.pass ? "✔" : "✖"} ${r.name}${r.pass ? "" : " — " + r.error}`);
    if (!r.pass) fails++;
  }
  console.log(`${results.length} UI tests, ${fails} failing, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  app.exit(fails ? 1 : 0);
}).catch((err) => {
  console.error(err);
  app.exit(2);
});
