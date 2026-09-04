---
name: regression-test
description: Guard known-fixed crawler bugs from regressing — run before every commit that touches src/.
---

# Regression testing — agenticSearch

These are bugs we actually hit in production. Each maps to a check in `test/regression.mjs`. Run `npm run test:regression` before committing changes to `src/`.

## Known regressions to guard

1. **robots.txt parsed by hand** missed wildcards/crawl-delay → must use robots-parser (`src/robots.js`), never regex line parsing.
2. **Global fetch ignores undici dispatcher** → all fetches must go through `src/http.js` `fetchWithTimeout` (undici fetch), never bare `fetch`.
3. **Broken IPv6 routes in containers** (data.gov.hk ETIMEDOUT) → `dns.setDefaultResultOrder("ipv4first")` must be set in `src/http.js`.
4. **Boilerplate filter removed `<html>`/`<body>`** because of feature-flag classes like `main-menu-disabled` → class/id cleanup must skip html/body (`src/extract.js`).
5. **Link-density removal nuked whole portal pages** (gov.hk) → extraction must not remove large ancestors; use the non-link-text scorer without ancestor removal.
6. **Generic `<title>` sites produced identical index titles** → `deriveTitles` must rewrite duplicates from URL path segments.
7. **Chromium revision mismatch** → browser self-install must use the runtime playwright CLI (`node node_modules/playwright/cli.js install --with-deps chromium`), never npx (wrong version).

## Regression harness

`test/regression.mjs` asserts:
- Source-level guards: forbidden patterns (bare `fetch(` in engine modules, hand-parsed robots), required patterns (`ipv4first`, html/body guard).
- Functional: extraction fixtures in `test/fixtures/` (wiki = large text, gov.hk = survives, legco = survives) all yield text > threshold via `extractPageSmart`.
- Meta-refresh stub re-queues the target instead of indexing the stub.

## Pass criteria

- Zero failures. If a fix changes behaviour, update the fixture expectation AND document why in this file.
