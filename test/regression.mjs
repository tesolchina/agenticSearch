// Regression guards for the known production bugs documented in
// skills/regression-test.md. Run: npm run test:regression
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { extractPageSmart } from "../src/extract.js";
import { deriveTitles } from "../src/crawler.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "..", "src");
const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8");

const httpSrc = read("http.js");
const extractSrc = read("extract.js");
const crawlerSrc = read("crawler.js");
const browserSrc = read("browser.js");

test("R2: no bare fetch( in engine modules — all fetches via src/http.js", () => {
  for (const f of ["crawler.js", "sitemap.js", "extract.js", "relevance.js", "robots.js"]) {
    const src = read(f);
    assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /\bfetch\(/);
  }
});

test("R2: src/http.js uses undici fetch (dispatcher support)", () => {
  assert.match(httpSrc, /from "undici"/);
  assert.match(httpSrc, /undiciFetch\(/);
});

test("R3: IPv4-first DNS set (broken IPv6 routes in containers)", () => {
  assert.match(httpSrc, /setDefaultResultOrder\("ipv4first"\)/);
});

test("R4: class/id boilerplate filter guards html/body", () => {
  assert.match(extractSrc, /tag === "html" \|\| tag === "body"/);
});

test("R5: no link-density ancestor removal (gov.hk portal regression)", () => {
  assert.doesNotMatch(extractSrc, /\$el\.remove\(\)/);
});

test("R7: chromium self-install uses runtime playwright CLI, not npx", () => {
  assert.match(browserSrc, /node_modules\/playwright\/cli\.js/);
  assert.doesNotMatch(browserSrc, /npx playwright/);
});

// Functional: extraction fixtures
const fixtures = {
  "wiki.html": 5000, // content-rich page
  "govhk.html": 200, // link portal — must survive (not zeroed)
  "legco-rendered.html": 200, // JS-rendered page content
};

for (const [file, minText] of Object.entries(fixtures)) {
  test(`R5/R6 fixture: ${file} yields >= ${minText} chars`, () => {
    const p = path.join(__dirname, "fixtures", file);
    if (!fs.existsSync(p)) return; // fixtures optional in fresh clones
    const html = fs.readFileSync(p, "utf8");
    const { text } = extractPageSmart(html, "https://example.com/");
    assert.ok(text.length >= minText, `got ${text.length}`);
  });
}

// R6: deriveTitles rewrites duplicate generic titles from URL path
test("R6: deriveTitles rewrites duplicate titles from URL", () => {
  const rs = [
    { title: "Generic Site", url: "https://x.com/en/council-meetings.html" },
    { title: "Generic Site", url: "https://x.com/en/members-profiles.html" },
  ];
  deriveTitles(rs);
  assert.equal(rs[0].title, "council meetings");
  assert.equal(rs[1].title, "members profiles");
});
