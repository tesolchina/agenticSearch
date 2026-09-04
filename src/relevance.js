// Relevance scoring and extractive summarisation.
const STOPWORDS = new Set(
  "the a an and or of to in for on with is are was were be been this that these those it its as at by from about into over after their they them we our you your what which who how why when where will would can could should may might must not no yes do does did done have has had more most other such only own same so than too very just also may many much some any each few both all one two new page site home menu skip content search click here read please contact us copyright rights reserved privacy policy terms use cookies help faq login sign register english chinese".split(
    " "
  )
);

export function keywordsFrom(objective) {
  return [
    ...new Set(
      objective
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fff]+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    ),
  ];
}

export function scoreRelevance(text, title, keywords) {
  if (!keywords.length) return 50;
  const lower = (title + " ").toLowerCase();
  const body = text.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    const inTitle = lower.includes(kw) ? 15 : 0;
    const occurrences = body.split(kw).length - 1;
    // log-ish scaling so one keyword spamming doesn't dominate
    const inBody = Math.min(20, Math.round(Math.log2(occurrences + 1) * 7));
    score += inTitle + inBody;
  }
  return Math.max(0, Math.min(100, Math.round(score / keywords.length)));
}

export function scoreUrlBoost(url, keywords) {
  const lower = url.toLowerCase();
  const hits = keywords.filter((k) => lower.includes(k)).length;
  return Math.min(15, hits * 5);
}

export function summarize(text, keywords, maxSentences = 2) {
  text = text.replace(/Skip to \w+(\s+(panel|links|content))?/gi, " ");
  const sentences = text.split(/(?<=[.。！？!?])\s+/).filter((s) => s.length > 40);
  const scored = sentences.map((s, i) => {
    const lower = s.toLowerCase();
    const hits = keywords.reduce((n, k) => n + (lower.split(k).length - 1), 0);
    return { s, i, hits };
  });
  const top = scored
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.i - b.i)
    .slice(0, maxSentences);
  const picked = (top.length ? top : scored.slice(0, maxSentences))
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);
  return picked.join(" ").slice(0, 400) || text.slice(0, 300);
}
