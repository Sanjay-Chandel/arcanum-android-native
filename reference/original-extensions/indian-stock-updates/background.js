// Bazaar Board — background service worker
// Primary source: NSE India's public corporate-filings API.
// Fallback / supplement: public RSS feeds (Moneycontrol, LiveMint), classified by
// keyword into results / actions / news, because NSE's API frequently rate-limits
// or blocks automated requests even with correct headers — RSS has no such gate.

const NSE_BASE = "https://www.nseindia.com";

// NSE's raw endpoints return their *entire* archive if no date range is given
// (thousands of rows) — scope every query to a recent window so "latest" means
// latest, and the popup isn't asked to render years of history at once.
function nseDate(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}
function dateWindow(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from_date: nseDate(from), to_date: nseDate(to) };
}

function nseEndpoints() {
  const w30 = dateWindow(30);
  const w45 = dateWindow(45);
  return {
    results: `${NSE_BASE}/api/corporates-financial-results?index=equities&period=Quarterly&from_date=${w45.from_date}&to_date=${w45.to_date}`,
    actions: `${NSE_BASE}/api/corporates-corporateActions?index=equities&from_date=${w30.from_date}&to_date=${w30.to_date}`,
    filings: `${NSE_BASE}/api/corporate-announcements?index=equities&from_date=${w30.from_date}&to_date=${w30.to_date}`
  };
}

const MAX_PER_BUCKET = 150;

// ---------------- Yahoo Finance fallback ----------------
// NSE and BSE's own price endpoints are unofficial and sit behind bot-detection
// that a plain background fetch can't always clear (no real page/JS to satisfy a
// challenge). Yahoo Finance's chart endpoint doesn't have that problem and covers
// the same Indian large-caps via .NS (NSE) / .BO (BSE) suffixes, so it's used as
// an automatic fallback rather than surfacing "unavailable" for common stocks.
async function fetchYahooQuote(yahooSymbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=5d`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || meta.regularMarketPrice == null) throw new Error("Yahoo: no price");
  const lastPrice = meta.regularMarketPrice;
  const prevClose = meta.previousClose ?? meta.chartPreviousClose ?? null;
  const change = prevClose != null ? lastPrice - prevClose : null;
  const pChange = prevClose ? (change / prevClose) * 100 : null;
  return { lastPrice, change, pChange, previousClose: prevClose };
}

const RSS_FEEDS = [
  { url: "https://www.moneycontrol.com/rss/latestnews.xml", source: "Moneycontrol" },
  { url: "https://www.livemint.com/rss/markets", source: "LiveMint" }
];

// Google News RSS is CORS-open and not bot-gated the way NSE's API is, so it's
// used as the dependable backbone for each tab — queried directly per topic
// rather than hoping a generic feed happens to mention it.
function googleNewsRss(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
}

const TOPIC_FEEDS = {
  results: [
    { url: googleNewsRss("NSE India Q results net profit when:2d"), source: "Google News" },
    { url: googleNewsRss("quarterly results BSE NSE India when:2d"), source: "Google News" }
  ],
  actions: [
    { url: googleNewsRss("NSE India dividend bonus buyback record date when:3d"), source: "Google News" },
    { url: googleNewsRss("stock split rights issue NSE India when:3d"), source: "Google News" }
  ],
  news: [{ url: googleNewsRss("Indian stock market NSE BSE news when:1d"), source: "Google News" }]
};

const CACHE_KEY = "bb_cache_v3";
const LAST_SEEN_KEY = "bb_last_seen_ids";
const REFRESH_ALARM = "bb_refresh";

let warmedUp = false;

async function warmUpSession() {
  try {
    await fetch(`${NSE_BASE}/`, { credentials: "include", cache: "no-store" });
    await fetch(`${NSE_BASE}/market-data/live-equity-market`, {
      credentials: "include",
      cache: "no-store"
    });
    warmedUp = true;
  } catch (e) {
    warmedUp = false;
  }
}

async function fetchJson(url) {
  const res = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("NSE returned a non-JSON (likely blocked) response");
  }
}

// ---------------- NSE JSON source ----------------

async function fetchNse({ retried = false } = {}) {
  if (!warmedUp) await warmUpSession();
  const endpoints = nseEndpoints();
  const out = { results: [], actions: [], filings: [], errors: [] };

  for (const key of Object.keys(endpoints)) {
    try {
      const data = await fetchJson(endpoints[key]);
      out[key] = normalizeNse(key, data);
    } catch (e) {
      out.errors.push({ key, message: String(e.message || e) });
    }
  }

  const allFailed = out.errors.length === Object.keys(endpoints).length;
  if (allFailed && !retried) {
    warmedUp = false;
    return fetchNse({ retried: true });
  }
  return out;
}

function normalizeNse(key, raw) {
  const list = Array.isArray(raw) ? raw : raw?.data || [];
  return list.map((item, i) => normalizeNseItem(key, item, i)).filter(Boolean);
}

function normalizeNseItem(key, item, i) {
  const symbol = item.symbol || item.sm || "";
  const company = item.sm_name || item.companyName || item.comp || symbol;
  const id = `nse-${key}-${symbol}-${item.seq_id || item.an_dt || item.bm_timestamp || i}`;
  const base = { id, symbol, company, source: "NSE" };

  if (key === "results") {
    return {
      ...base,
      type: "results",
      headline: `Q${item.qtr || ""} results — ${item.re_broadcast_date ? "revised" : "filed"}`,
      detail: item.audited ? "Audited" : "Un-audited",
      date: item.re_broadcast_date || item.re_date || item.to_date || "",
      link: nseQuoteUrl(symbol)
    };
  }
  if (key === "actions") {
    // NSE's actual field is `exDate` (camelCase) — `exdate` never matches, which is why
    // this tab was showing no date/time before. recDate/caBroadcastDate cover action
    // types (e.g. board-meeting-only entries) that don't carry an ex-date at all.
    const actionDate = item.exDate || item.recDate || item.bcStartDate || item.caBroadcastDate || "";
    return {
      ...base,
      type: "actions",
      headline: item.subject || item.purpose || "Corporate action",
      detail: [item.faceVal ? `Face value ${item.faceVal}` : "", actionDate ? `Ex-date ${actionDate}` : ""]
        .filter(Boolean)
        .join(" · "),
      date: actionDate,
      link: nseQuoteUrl(symbol)
    };
  }
  return {
    ...base,
    type: "filings",
    headline: item.desc || item.subject || item.attchmntText || "Announcement",
    detail: item.smIndustry || "",
    date: item.an_dt || item.sort_date || "",
    link: item.attchmntFile || nseQuoteUrl(symbol)
  };
}

function nseQuoteUrl(symbol) {
  return symbol ? `${NSE_BASE}/get-quotes/equity?symbol=${encodeURIComponent(symbol)}` : "";
}

// ---------------- RSS fallback / supplement source ----------------

async function fetchOneFeed(feed) {
  const res = await fetch(feed.url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  return parseRss(xml, feed.source);
}

async function fetchRssAll() {
  const out = { results: [], actions: [], news: [], errors: [] };
  const seen = new Set();

  const addUnique = (bucket, items) => {
    for (const it of items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out[bucket].push(it);
    }
  };

  // Topic-targeted Google News queries — direct bucket, most reliable.
  for (const [bucket, feeds] of Object.entries(TOPIC_FEEDS)) {
    for (const feed of feeds) {
      try {
        const items = await fetchOneFeed(feed);
        addUnique(bucket, items);
      } catch (e) {
        out.errors.push({ key: `${bucket} (${feed.source})`, message: String(e.message || e) });
      }
    }
  }

  // Generic market feeds — classified by keyword as extra coverage.
  for (const feed of RSS_FEEDS) {
    try {
      const items = await fetchOneFeed(feed);
      for (const it of items) {
        const bucket = classify(it.headline);
        addUnique(bucket, [it]);
      }
    } catch (e) {
      out.errors.push({ key: feed.source, message: String(e.message || e) });
    }
  }

  return out;
}

function parseRss(xmlText, source) {
  const items = [];
  const blocks = xmlText.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const pubDate = extractTag(block, "pubDate");
    const description = extractTag(block, "description");
    if (!title) continue;
    const id = `rss-${source}-${link || pubDate || i}`;
    items.push({
      id,
      symbol: "",
      company: source,
      source,
      headline: title,
      detail: stripHtml(description).slice(0, 120),
      date: pubDate ? new Date(pubDate).toISOString() : "",
      link
    });
  }
  return items;
}

function extractTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  return decodeXml(m[1].replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").trim());
}

function decodeXml(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(s) {
  return (s || "").replace(/<[^>]*>/g, "").trim();
}

function classify(titleRaw) {
  const t = (titleRaw || "").toLowerCase();
  const actionWords = [
    "dividend",
    "bonus issue",
    "bonus shares",
    "stock split",
    "share split",
    "buyback",
    "record date",
    "ex-date",
    "rights issue",
    "board meeting"
  ];
  const resultWords = [
    "q1 results",
    "q2 results",
    "q3 results",
    "q4 results",
    "quarterly results",
    "net profit",
    "net loss",
    "posts profit",
    "posts loss",
    "revenue rises",
    "revenue falls",
    "results:",
    "results preview",
    "results review",
    "beats estimates",
    "misses estimates"
  ];
  if (actionWords.some((w) => t.includes(w))) return "actions";
  if (resultWords.some((w) => t.includes(w))) return "results";
  return "news";
}

// ---------------- Merge + persist ----------------

async function fetchAll() {
  const [nse, rss] = await Promise.all([fetchNse(), fetchRssAll()]);

  const combined = {
    results: capRecent([...nse.results, ...rss.results]),
    actions: capRecent([...nse.actions, ...rss.actions]),
    filings: capRecent(nse.filings),
    news: capRecent(rss.news),
    errors: [...nse.errors, ...rss.errors],
    fetchedAt: Date.now()
  };

  await chrome.storage.local.set({ [CACHE_KEY]: combined });
  await maybeNotify(combined);
  return combined;
}

function capRecent(items) {
  return [...items]
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, MAX_PER_BUCKET);
}

// ---------------- Live price quotes ----------------

const QUOTE_CACHE = new Map(); // symbol -> { ts, data }
const QUOTE_TTL = 45_000; // NSE prices don't need to be fetched more than every ~45s per symbol

async function getQuote(symbol) {
  const cached = QUOTE_CACHE.get(symbol);
  if (cached && Date.now() - cached.ts < QUOTE_TTL) return cached.data;

  if (!warmedUp) await warmUpSession();
  let result;
  try {
    const data = await fetchJson(`${NSE_BASE}/api/quote-equity?symbol=${encodeURIComponent(symbol)}`);
    const pi = data.priceInfo || {};
    if (pi.lastPrice == null) throw new Error("NSE: no price in response");
    result = {
      ok: true,
      lastPrice: pi.lastPrice,
      change: pi.change ?? null,
      pChange: pi.pChange ?? null,
      previousClose: pi.previousClose ?? null,
      asOf: data.lastUpdateTime || null,
      source: "NSE"
    };
  } catch (e) {
    try {
      const yq = await fetchYahooQuote(`${symbol}.NS`);
      result = { ok: true, ...yq, asOf: null, source: "Yahoo" };
    } catch (e2) {
      result = { ok: false, error: String(e2.message || e2) };
    }
  }

  // A true failure (both sources down) still gets a shorter effective cache life
  // so the next request retries sooner rather than sitting on the full TTL.
  QUOTE_CACHE.set(symbol, { ts: result.ok ? Date.now() : Date.now() - QUOTE_TTL + 8000, data: result });
  return result;
}

// ---------------- Live ticker (NSE + BSE, CNBC-style scrolling strip) ----------------

// One call returns live prices for all 50 Nifty constituents — this is the same
// endpoint nseindia.com's own index page uses.
const NSE_TICKER_URL = `${NSE_BASE}/api/equity-stockIndices?index=NIFTY%2050`;

// BSE has no equivalent bulk "index constituents" JSON endpoint that's publicly
// documented, so the Sensex row is built from a fixed list of BSE scrip codes for
// the index's heavyweights, queried individually. Codes are BSE's numeric
// "scripcode" identifiers (e.g. RELIANCE = 500325), not the NSE trading symbol.
const BSE_SENSEX_SCRIPS = [
  { symbol: "RELIANCE", code: "500325" },
  { symbol: "TCS", code: "532540" },
  { symbol: "HDFCBANK", code: "500180" },
  { symbol: "ICICIBANK", code: "532174" },
  { symbol: "INFY", code: "500209" },
  { symbol: "HINDUNILVR", code: "500696" },
  { symbol: "ITC", code: "500875" },
  { symbol: "SBIN", code: "500112" },
  { symbol: "BHARTIARTL", code: "532454" },
  { symbol: "KOTAKBANK", code: "500247" },
  { symbol: "LT", code: "500510" },
  { symbol: "AXISBANK", code: "532215" },
  { symbol: "BAJFINANCE", code: "500034" },
  { symbol: "ASIANPAINT", code: "500820" },
  { symbol: "MARUTI", code: "532500" },
  { symbol: "HCLTECH", code: "532281" },
  { symbol: "SUNPHARMA", code: "524715" },
  { symbol: "TITAN", code: "500114" },
  { symbol: "ULTRACEMCO", code: "532538" },
  { symbol: "TATAMOTORS", code: "500570" }
];

const TICKER_TTL = 20_000; // refresh cadence for the scrolling strip
let tickerCache = { ts: 0, data: { nse: [], bse: [] } };

async function fetchNseTickerRow({ retried = false } = {}) {
  if (!warmedUp) await warmUpSession();
  try {
    const data = await fetchJson(NSE_TICKER_URL);
    const rows = Array.isArray(data?.data) ? data.data : [];
    const parsed = rows
      .filter((r) => r.symbol && r.symbol !== "NIFTY 50")
      .map((r) => ({
        symbol: r.symbol,
        lastPrice: r.lastPrice ?? null,
        change: r.change ?? null,
        pChange: r.pChange ?? null
      }))
      .filter((r) => r.lastPrice != null);
    if (parsed.length === 0) throw new Error("NSE: empty index constituent list");
    return parsed;
  } catch (e) {
    // NSE's session cookie is occasionally stale on the very first hit — one retry
    // with a fresh warm-up (same pattern fetchNse already uses) clears most of these.
    if (!retried) {
      warmedUp = false;
      return fetchNseTickerRow({ retried: true });
    }
    // Still blocked — NSE's site sits behind bot-detection that a plain background
    // fetch can't always clear (no real page/JS to satisfy a challenge). Fall back
    // to Yahoo Finance for the same large-cap names rather than showing nothing.
    return fetchNseTickerFallbackYahoo();
  }
}

async function fetchNseTickerFallbackYahoo() {
  const results = await Promise.allSettled(
    BSE_SENSEX_SCRIPS.map(async ({ symbol }) => {
      const q = await fetchYahooQuote(`${symbol}.NS`);
      return { symbol, lastPrice: q.lastPrice, change: q.change, pChange: q.pChange };
    })
  );
  return results.filter((r) => r.status === "fulfilled").map((r) => r.value);
}

function parseBseScripHeader(raw, symbol) {
  // Response shape (confirmed against bseindia.com's own quote page markup):
  // { ScripHeaderData: { CurrRate: { LTP, Chg, PcChg, ... }, ... } }
  // Kept defensive since this is an unofficial, undocumented endpoint that could
  // change shape without notice — a parse miss here should skip the row, not throw.
  const cur = raw?.ScripHeaderData?.CurrRate || raw?.CurrRate || {};
  const lastPrice = parseFloat(cur.LTP);
  if (!isFinite(lastPrice)) return null;
  const change = parseFloat(cur.Chg);
  const pChange = parseFloat(cur.PcChg);
  return {
    symbol,
    lastPrice,
    change: isFinite(change) ? change : null,
    pChange: isFinite(pChange) ? pChange : null
  };
}

async function fetchBseTickerRow() {
  const results = await Promise.allSettled(
    BSE_SENSEX_SCRIPS.map(async ({ symbol, code }) => {
      try {
        const url = `https://api.bseindia.com/BseIndiaAPI/api/getScripHeaderData/w?Debtflag=&scripcode=${code}&seriesid=`;
        const res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        const parsed = parseBseScripHeader(raw, symbol);
        if (!parsed) throw new Error("BSE: unparseable response");
        return parsed;
      } catch (e) {
        // BSE's price endpoint is undocumented and blocks/breaks often — Yahoo
        // Finance's .BO suffix covers the same large-cap names far more reliably.
        const q = await fetchYahooQuote(`${symbol}.BO`);
        return { symbol, lastPrice: q.lastPrice, change: q.change, pChange: q.pChange };
      }
    })
  );
  return results
    .filter((r) => r.status === "fulfilled" && r.value)
    .map((r) => r.value);
}

async function getTickerData() {
  if (Date.now() - tickerCache.ts < TICKER_TTL) return tickerCache.data;

  const [nseRes, bseRes] = await Promise.allSettled([fetchNseTickerRow(), fetchBseTickerRow()]);
  const data = {
    nse: nseRes.status === "fulfilled" ? nseRes.value : [],
    bse: bseRes.status === "fulfilled" ? bseRes.value : [],
    nseError: nseRes.status === "rejected" ? String(nseRes.reason?.message || nseRes.reason) : null,
    bseError: bseRes.status === "rejected" ? String(bseRes.reason?.message || bseRes.reason) : null
  };
  // A full failure gets a shorter effective cache life so the next popup poll (every
  // 20s) retries sooner instead of showing "unavailable" for the whole TTL window.
  const bothFailed = nseRes.status === "rejected" && bseRes.status === "rejected";
  tickerCache = { ts: bothFailed ? Date.now() - TICKER_TTL + 5000 : Date.now(), data };
  return data;
}

async function maybeNotify(results) {
  const { bb_watchlist: watchlist = [], bb_notify: notifyEnabled = true } = await chrome.storage.local.get([
    "bb_watchlist",
    "bb_notify"
  ]);
  if (!notifyEnabled || watchlist.length === 0) return;

  const { [LAST_SEEN_KEY]: lastSeen = [] } = await chrome.storage.local.get(LAST_SEEN_KEY);
  const lastSeenSet = new Set(lastSeen);
  const allItems = [...results.results, ...results.actions, ...results.filings, ...results.news];
  const fresh = allItems.filter((it) => it.symbol && watchlist.includes(it.symbol) && !lastSeenSet.has(it.id));

  for (const item of fresh.slice(0, 5)) {
    chrome.notifications.create(item.id, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: `${item.symbol} · ${item.type === "results" ? "Result" : item.type === "actions" ? "Corporate action" : "Filing"}`,
      message: item.headline,
      priority: 1
    });
  }

  const newIds = allItems.map((it) => it.id);
  await chrome.storage.local.set({ [LAST_SEEN_KEY]: newIds.slice(-800) });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 15 });
  fetchAll();
});

chrome.runtime.onStartup.addListener(() => {
  fetchAll();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) fetchAll();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "BB_REFRESH") {
    fetchAll()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === "BB_GET_CACHE") {
    chrome.storage.local.get(CACHE_KEY).then((r) => sendResponse({ ok: true, data: r[CACHE_KEY] || null }));
    return true;
  }
  if (msg?.type === "BB_GET_QUOTE" && msg.symbol) {
    getQuote(msg.symbol).then((data) => sendResponse({ ok: true, data }));
    return true;
  }
  if (msg?.type === "BB_GET_TICKER") {
    getTickerData().then((data) => sendResponse({ ok: true, data }));
    return true;
  }
});
