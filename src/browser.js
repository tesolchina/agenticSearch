// Headless browser (Playwright) for JS-rendered pages, with a lazy one-off
// self-install of the matching browser revision + system libs. The runtime
// image may lack chromium's system libraries, so on first launch failure we
// install them once, then retry.
import { exec } from "child_process";
import dns from "dns";

dns.setDefaultResultOrder("ipv4first");

let _browserPromise = null;
let _depsInstalled = false;

function installChromiumDeps() {
  return new Promise((resolve) => {
    console.log("[crawl] installing chromium + system deps (one-off, ~1-2 min)");
    exec(
      "node node_modules/playwright/cli.js install --with-deps chromium",
      { timeout: 600000, cwd: process.cwd() },
      (err) => {
        if (err) console.log("[crawl] install failed:", String(err.message).slice(0, 200));
        else console.log("[crawl] install done");
        resolve();
      }
    );
  });
}

async function getBrowser() {
  if (!_browserPromise) {
    const { chromium } = await import("playwright");
    const launch = () =>
      chromium.launch({
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions"],
      });
    _browserPromise = (async () => {
      try {
        return await launch();
      } catch (e) {
        const msg = String(e.message || e);
        if (!_depsInstalled && /has been closed|shared librar|Executable doesn't exist/i.test(msg)) {
          _depsInstalled = true;
          await installChromiumDeps();
          return launch();
        }
        throw e;
      }
    })();
    _browserPromise.catch(() => {
      _browserPromise = null; // allow retry on next request
    });
  }
  return _browserPromise;
}

export async function renderPage(url, timeoutMs = 20000) {
  const browser = await getBrowser();
  const page = await browser.newPage({ userAgent: process.env.CRAWLER_UA || "AgenticSearchBot/0.1" });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForTimeout(2500); // let SPA bundles hydrate
    return await page.content();
  } finally {
    await page.close();
  }
}
