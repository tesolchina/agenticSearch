// Unit tests — node:test, no network. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUrl } from "../src/url.js";
import { keywordsFrom, scoreRelevance, scoreUrlBoost, summarize } from "../src/relevance.js";
import { extractPage, extractPageSmart } from "../src/extract.js";

test("normalizeUrl resolves relative, strips hash and tracking params", () => {
  assert.equal(
    normalizeUrl("https://x.com/a/b", "../c?utm_source=x&id=3#frag"),
    "https://x.com/c?id=3"
  );
  assert.equal(normalizeUrl("https://x.com/", "mailto:a@b.c"), null);
  assert.equal(normalizeUrl("https://x.com/", "javascript:void(0)"), null);
});

test("keywordsFrom drops stopwords and short tokens, keeps CJK", () => {
  const kws = keywordsFrom("The Membership and Functions of the Legislative Council 教育局");
  assert.ok(!kws.includes("the"));
  assert.ok(!kws.includes("and"));
  assert.ok(kws.includes("membership"));
  assert.ok(kws.includes("functions"));
  assert.ok(kws.includes("教育局"));
});

test("scoreRelevance: title hit beats body-only hit; clamped 0-100", () => {
  const kws = ["crawler"];
  const high = scoreRelevance("x ".repeat(50) + " a crawler is a bot", "Web crawler - Wikipedia", kws);
  const low = scoreRelevance("x ".repeat(50), "Unrelated page", kws);
  assert.ok(high > low);
  assert.ok(high <= 100 && low >= 0);
});

test("scoreUrlBoost: 5 per matching keyword, capped at 15", () => {
  assert.equal(scoreUrlBoost("https://x.com/crawler/crawler/crawler/crawler", ["crawler"]), 5);
  assert.equal(
    scoreUrlBoost("https://x.com/crawler/spider/bot", ["crawler", "spider", "bot"]),
    15
  );
});

test("summarize prefers sentences with keyword hits", () => {
  const s = summarize(
    "Completely unrelated filler sentence one. A web crawler systematically browses the World Wide Web for indexing purposes today. Another unrelated sentence here.",
    ["crawler"],
    1
  );
  assert.match(s, /web crawler/i);
});

test("extractPage keeps links and drops scripts/styles", () => {
  const html = `<html><head><title>T</title></head><body><script>bad()</script>
    <main><p>Main content paragraph with enough words to survive the thin-page filter.</p>
    <a href="/a">A</a><a href="/b">B</a></main></body></html>`;
  const r = extractPage(html, "https://x.com/");
  assert.ok(r.text.includes("Main content paragraph"));
  assert.ok(!r.text.includes("bad()"));
  assert.equal(r.links.length, 2);
});

test("extractPageSmart: never removes html/body via class filter (regression 4)", () => {
  const html = `<html class="client-nojs vector-feature-main-menu-disabled"><head><title>W</title></head>
    <body><div class="mw-parser-output"><p>Real encyclopedia content about web crawlers with many words.</p></div></body></html>`;
  const r = extractPageSmart(html, "https://en.wikipedia.org/wiki/Web_crawler");
  assert.ok(r.text.includes("Real encyclopedia content"));
});
