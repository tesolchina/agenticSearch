// URL normalization helpers.
export function normalizeUrl(base, href) {
  try {
    const u = new URL(href, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    // strip common tracking params
    for (const p of [...u.searchParams.keys()]) {
      if (/^utm_|fbclid|gclid/i.test(p)) u.searchParams.delete(p);
    }
    return u.toString();
  } catch {
    return null;
  }
}
