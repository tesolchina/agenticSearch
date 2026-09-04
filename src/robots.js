// robots.txt compliance via the robots-parser npm lib (the approach used by
// crawlee/scrapy ecosystems): robust rule matching incl. wildcards, per-UA
// groups, and crawl-delay extraction.
import robotsParser from "robots-parser";
import { fetchWithTimeout, UA } from "./http.js";

export async function getRobots(origin) {
  const rules = { parser: null, sitemaps: [] };
  try {
    const res = await fetchWithTimeout(`${origin}/robots.txt`, 8000);
    if (!res.ok) return rules;
    const text = await res.text();
    rules.parser = robotsParser(`${origin}/robots.txt`, text);
    rules.sitemaps = [...text.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  } catch {
    // no robots.txt -> allow all
  }
  return rules;
}

// undefined from the parser means "no matching rule" -> allowed
export function robotsAllows(rules, url) {
  return rules.parser ? rules.parser.isAllowed(url, UA) !== false : true;
}

export function robotsCrawlDelay(rules) {
  return rules.parser?.getCrawlDelay?.(UA) || 0;
}
