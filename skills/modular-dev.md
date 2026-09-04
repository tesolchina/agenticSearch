---
name: modular-dev
description: Discipline for developing the agenticSearch engine in small, testable modules with clean boundaries. Apply whenever changing engine code.
---

# Modular development — agenticSearch

## 1. Module map (keep it true)

| Module | Responsibility | Must not do |
|--------|----------------|-------------|
| `src/http.js` | fetch w/ TLS fallback, per-host politeness, UA | parse HTML, rank pages |
| `src/robots.js` | robots.txt rules + crawl-delay | fetch pages |
| `src/sitemap.js` | sitemap discovery (incl. .gz, index files) | score pages |
| `src/url.js` | URL normalization | fetch |
| `src/extract.js` | main-content + link extraction (readability → heuristic fallback) | fetch, rank |
| `src/relevance.js` | keywords, scoring, summaries | fetch |
| `src/browser.js` | Playwright render + self-install | BFS logic |
| `src/crawler.js` | BFS frontier, meta-refresh, render fallback | storage |
| `src/indexStore.js` | Postgres index: upsert, search, stats | crawl |
| `server.mjs` | HTTP surface only | engine logic |
| `skills/gdoc-tabs.md` | progress-log/plan writes to the GCAP3056 Google Doc (tab targeting, quirks) | — |

## 2. Rules

1. New behaviour goes in the module that owns it; `server.mjs` stays a thin HTTP shell.
2. Every module exports pure functions where possible (unit-testable without network).
3. Network-dependent logic must be injectable/mocked in tests (fetch, clock).
4. No cross-module globals except `UA` and the politeness map (documented in http.js).

## 3. Change workflow

1. Write/extend a unit test in `test/unit.test.mjs` for the module behaviour.
2. Implement; keep `npm test` green.
3. If the change affects crawl outcomes (extraction, robots, politeness), run `npm run test:regression` before commit.
4. If endpoints changed, run `npm run test:e2e` against a deployed instance.
5. If the change touches docs/plans/progress logs in the GCAP3056 Google Doc, follow `skills/gdoc-tabs.md` — write into the exact tab ID the user provides and verify the write with a plaintext re-fetch.

## 4. Never

- Never add engine logic to `server.mjs`.
- Never break robots.txt compliance for a feature.
- Never let a single site's failure fail the whole crawl (allSettled semantics).
