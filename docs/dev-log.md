# Development log — agenticSearch

Reverse-chronological. Extracted from the GCAP3056 progress log (Google Doc,
tab t.0) and local session history.

## 2026-09-04 — v0.1.0 extraction & release

- Extracted the engine from `GCAP3056/frontend/server.mjs` into this
  standalone repo (github.com/tesolchina/agenticSearch).
- Modularized into `src/` (http, robots, sitemap, url, extract, relevance,
  browser, crawler, indexStore); `server.mjs` is now a thin HTTP shell.
- Wrote skills following the tesolchina/vibeCoding101 SKILL.md convention:
  `skills/modular-dev.md`, `skills/e2e-test.md`, `skills/regression-test.md`.
  (Note: the referenced "vibecodingskills" repo does not exist on GitHub;
  vibeCoding101 is the closest match and its template was followed.)
- Tests: unit (7 pass), regression (10 pass; guards 7 production bugs with
  HTML fixtures from real crawled pages), e2e (11 checks, ALL PASS against
  production).
- Deployed as separate Railway service `agenticsearch` in the gcap3056
  project; shares the project Postgres (`DATABASE_URL` reference variable).
- Frontend now proxies `/api/crawl` + `/api/index/*` to the engine via
  `AGENTICSEARCH_URL` (internal), with built-in fallback.

## 2026-09-04 — crawler hardening (pre-extraction, in frontend monolith)

Bugs hit in production, fixed and now guarded by `test/regression.mjs`:

1. **Railpack builds with bun** — `npm install` changed `package-lock.json`
   only → `bun install --frozen-lockfile` failed. Fix: sync `bun.lock`.
2. **Global `fetch` ignores undici `dispatcher`** → strict→lenient TLS retry
   silently didn't apply. Fix: use undici's own `fetch`.
3. **Chromium runtime libs missing** (railpack ships build-stage apt deps
   only; `libglib-2.0.so.0` absent) → launch crash. Fix: lazy one-off
   `node node_modules/playwright/cli.js install --with-deps chromium` at
   runtime. (`npx playwright` resolves the wrong version — avoid it.)
4. **Chromium revision mismatch** (build installed 1200, runtime wanted 1234)
   → same fix: install with the runtime playwright CLI.
5. **Boilerplate filter removed `<html>`/`<body>`** — `<html
   class="client-nojs vector-feature-main-menu-disabled">` matched
   `\bmenu\b` → whole page wiped (Wikipedia regression). Fix: never remove
   html/body; skip containers holding `main`/`article`.
6. **Link-density heuristic nuked portal pages** (gov.hk) → replaced ancestor
   removal with deterministic non-link-text scorer (readability-style).
7. **IPv6 routes broken in containers** (data.gov.hk ETIMEDOUT; IPv4 connect
   OK in 38ms) → `dns.setDefaultResultOrder("ipv4first")`.
8. **Page-index INSERT param count** (5 params for 6 placeholders) → fixed.

## 2026-09-04 — index & ecosystem borrow

- Indexed all 316 data.gov.hk datasets via CKAN API (`/api/index/build`).
- Crawled + indexed 47 LegCo pages (incl. `/open-legco/`), 77 EDB pages,
  8 Wikipedia pages → 448 entries total.
- Added `data.legco.gov.hk` does **not** exist (DNS NXDOMAIN) — LegCo
  coverage comes from crawling legco.gov.hk directly; data.gov.hk itself
  carries few LegCo-specific datasets (e.g. CenStatD 990-97011 elected
  members table).
- Borrowed from the OSS crawler ecosystem (apify/crawlee 25.6k★, crawl4ai
  81k★, trafilatura 6.8k★, scrapy): `robots-parser` lib (wildcards +
  crawl-delay replacing hand-rolled parsing), per-host politeness gaps,
  `@mozilla/readability` main-content extraction with heuristic fallback.
- Environment notes: `search.simonsays.hk` mapped via Aliyun DNS (CNAME
  `search` → `85mbym3a.up.railway.app` + TXT verify record); TLS issued by
  Railway. DEBUG=pw:browser Railway variable enabled chromium launch tracing
  during debugging.

## 2026-09-04 — Search Pilot MVP (pre-extraction)

- `/pilot` UI (two modes: paste-sites or agent-proposes) + `/pilot/about.html`
  notes page; both public (no site password).
- Initially simulated crawl in-browser; replaced same day with the real
  server-side crawler after feedback that it "only scratched the surface".
- Progress log kept in the GCAP3056 Google Doc, tab `t.0` (updates 1–7).
