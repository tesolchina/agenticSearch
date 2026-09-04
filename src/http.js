// HTTP layer: fetching with TLS fallback, per-host politeness.
// Borrowed patterns: crawlee/scrapy per-host politeness; undici dispatcher
// support; IPv4-first DNS for containers with broken IPv6 routes.
import dns from "dns";
import { fetch as undiciFetch, Agent } from "undici";

dns.setDefaultResultOrder("ipv4first");

export const UA =
  process.env.CRAWLER_UA ||
  "AgenticSearchBot/0.1 (+https://github.com/tesolchina/agenticSearch)";

// Some HK gov sites (e.g. legco.gov.hk) serve incomplete TLS chains; retry
// those with relaxed verification rather than excluding them.
const strictAgent = new Agent();
const lenientAgent = new Agent({ connect: { rejectUnauthorized: false } });

export async function fetchWithTimeout(url, timeoutMs = 15000) {
  const attempt = async (dispatcher) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await undiciFetch(url, {
        signal: ctrl.signal,
        redirect: "follow",
        dispatcher,
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      });
    } finally {
      clearTimeout(t);
    }
  };
  try {
    return await attempt(strictAgent);
  } catch (err) {
    if (/certificate|TLS|ssl/i.test(String(err.cause || err))) {
      return attempt(lenientAgent);
    }
    throw err;
  }
}

// Per-host politeness: minimum gap between requests to the same host.
// Honors robots.txt crawl-delay, capped so interactive use stays responsive.
const lastRequestAt = new Map();

export async function politeGap(hostname, extraDelayMs = 0) {
  const gap = Math.max(300, Math.min(extraDelayMs || 0, 2000));
  const last = lastRequestAt.get(hostname) || 0;
  const wait = last + gap - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt.set(hostname, Date.now());
}
