// Main-content extraction. Two strategies, hybrid:
//   1. @mozilla/readability (Firefox Reader Mode — the Node counterpart of
//      trafilatura's approach): excellent on article/content pages.
//   2. Heuristic non-link-text scorer (cheerio): fallback for portal and
//      link-directory pages where Readability comes up thin.
// Link extraction uses cheerio in both paths so crawling is unaffected.
import * as cheerio from "cheerio";
import { Readability } from "@mozilla/readability";
import jsdomPkg from "jsdom";

const { JSDOM } = jsdomPkg;

export function extractPage(html, url) {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, footer, header, aside, svg, iframe, form").remove();
  // drop common boilerplate containers (skip-links, menus, breadcrumbs...)
  // never html/body — e.g. <html class="...main-menu-disabled..."> would nuke the page
  $("[class],[id]").each((_, el) => {
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "html" || tag === "body") return;
    const s = `${$(el).attr("class") || ""} ${$(el).attr("id") || ""}`.toLowerCase();
    if (/\b(skip|nav|menu|breadcrumb|sidebar|cookie|banner)\b/.test(s) && $(el).find("main, article").length === 0) {
      $(el).remove();
    }
  });
  $("a").each((_, el) => {
    if (/^skip to/i.test($(el).text().trim())) $(el).remove();
  });
  $('[role="navigation"], [role="banner"], [role="contentinfo"]').remove();

  // readability-style main-content selection: the element with the most
  // non-link text wins. Deterministic, keeps all links for crawling, and
  // works for link-portal pages (gov.hk) and JS-rendered pages alike.
  let main = $("body");
  let bestScore = -1;
  $("main, article, div, section, td").each((_, el) => {
    const $el = $(el);
    const total = $el.text().replace(/\s+/g, "").length;
    const link = $el.find("a").text().replace(/\s+/g, "").length;
    const score = total - link;
    if (score >= bestScore) {
      bestScore = score;
      main = $el;
    }
  });
  const title = ($("title").first().text() || "").trim().slice(0, 200);
  const text = main.text().replace(/\s+/g, " ").trim();
  const links = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href) links.push(href);
  });
  return { title, text, links: [...new Set(links)] };
}

export function extractPageSmart(html, url) {
  const fallback = extractPage(html, url);
  try {
    const doc = new JSDOM(html, { url }).window.document;
    const art = new Readability(doc).parse();
    const text = (art?.textContent || "").replace(/\s+/g, " ").trim();
    const title = (art?.title || fallback.title || "").trim();
    if (text.length > Math.max(500, fallback.text.length)) {
      return { title, text, links: fallback.links };
    }
    // readability thin but better than static fallback? combine
    if (text.length > fallback.text.length) {
      return { title, text, links: fallback.links };
    }
  } catch {
    // readability failed; use heuristic fallback
  }
  return fallback;
}
