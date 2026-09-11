// shared.js — config + feed fetching/parsing shared by background.js and popup.js

// Real, public RSS feeds (no login, no scraping of private research portals).
const DEFAULT_FEEDS = [
  { name: "Moneycontrol", url: "http://www.moneycontrol.com/rss/latestnews.xml" },
  { name: "Business Standard", url: "http://www.business-standard.com/rss/home_page_top_stories.rss" },
  { name: "Hindustan Times Business", url: "https://feeds.hindustantimes.com/HT-Business?format=xml" },
  { name: "Livemint Markets", url: "https://www.livemint.com/rss/markets" }
];

// Firm names to watch for in headlines/descriptions. Editable on the Options page.
const DEFAULT_FIRMS = [
  "Nomura",
  "Goldman Sachs",
  "Morgan Stanley",
  "JP Morgan",
  "JPMorgan",
  "HSBC",
  "UBS",
  "Credit Suisse",
  "Macquarie",
  "ICICI Securities",
  "Motilal Oswal",
  "Sharekhan",
  "Ventura Securities",
  "Prabhudas Lilladher",
  "Jefferies",
  "CLSA",
  "Kotak Institutional",
  "Citi",
  "Bernstein",
  "Emkay Global"
];

const CACHE_KEY = "bb_cached_items";
const CACHE_TIME_KEY = "bb_cache_time";
const SETTINGS_KEY = "bb_settings";

async function getSettings() {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY];
  if (settings && settings.feeds && settings.firms) return settings;
  return { feeds: DEFAULT_FEEDS, firms: DEFAULT_FIRMS };
}

async function saveSettings(settings) {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
}

function stripTags(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .trim();
}

// Regex-based RSS parsing on purpose: this file is shared by popup.js (has DOM,
// could use DOMParser) AND background.js (a service worker, which has NO DOM /
// DOMParser). A single regex-based parser keeps behavior identical in both places.
function extractTag(itemXml, tag) {
  const cdataRe = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, "i");
  const plainRe = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const cdataMatch = itemXml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1];
  const plainMatch = itemXml.match(plainRe);
  return plainMatch ? plainMatch[1] : "";
}

function parseRSS(xmlText, sourceName) {
  const items = [];
  const itemBlocks = xmlText.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of itemBlocks) {
    const title = stripTags(extractTag(block, "title"));
    const link = stripTags(extractTag(block, "link")).trim();
    const description = stripTags(extractTag(block, "description"));
    const pubDateRaw = stripTags(extractTag(block, "pubDate")).trim();
    let pubDate = null;
    if (pubDateRaw) {
      const d = new Date(pubDateRaw);
      if (!isNaN(d.getTime())) pubDate = d.toISOString();
    }
    if (title) items.push({ title, link, description, pubDate, source: sourceName });
  }
  return items;
}

async function fetchFeed(feed) {
  try {
    const res = await fetch(feed.url, { cache: "no-store" });
    if (!res.ok) return [];
    const text = await res.text();
    return parseRSS(text, feed.name);
  } catch (e) {
    console.warn("Feed fetch failed:", feed.name, e);
    return [];
  }
}

function matchFirms(text, firms) {
  const hits = [];
  const lower = text.toLowerCase();
  for (const firm of firms) {
    if (lower.includes(firm.toLowerCase())) hits.push(firm);
  }
  return hits;
}

async function fetchAllAndTag() {
  const settings = await getSettings();
  const results = await Promise.all(settings.feeds.map(fetchFeed));
  const allItems = results.flat();

  // De-dupe by link/title
  const seen = new Set();
  const deduped = [];
  for (const item of allItems) {
    const key = item.link || item.title;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  // Tag with matched firms; keep only items that mention at least one tracked firm
  const tagged = deduped
    .map((item) => ({
      ...item,
      firms: matchFirms(`${item.title} ${item.description}`, settings.firms)
    }))
    .filter((item) => item.firms.length > 0);

  // Sort newest first when we have dates
  tagged.sort((a, b) => {
    if (a.pubDate && b.pubDate) return new Date(b.pubDate) - new Date(a.pubDate);
    if (a.pubDate) return -1;
    if (b.pubDate) return 1;
    return 0;
  });

  return tagged;
}

async function refreshCache() {
  const items = await fetchAllAndTag();
  await chrome.storage.local.set({
    [CACHE_KEY]: items,
    [CACHE_TIME_KEY]: Date.now()
  });
  return items;
}

async function getCached() {
  const stored = await chrome.storage.local.get([CACHE_KEY, CACHE_TIME_KEY]);
  return {
    items: stored[CACHE_KEY] || [],
    time: stored[CACHE_TIME_KEY] || null
  };
}
