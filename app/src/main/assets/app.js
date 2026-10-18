const state = {
  tab: "results",
  q: "",
  watch: JSON.parse(localStorage.getItem("arcanum_watch") || "[]"),
  open: new Set(),
  shown: 60,
  data: {
    results: [],
    actions: [],
    filings: [],
    news: [],
    firms: []
  },
  ts: 0
};

const $ = id => document.getElementById(id);

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
}[c]));

const cb = {};
let seq = 0;

/* Android -> JavaScript callback */
window.nativeResult = (id, payload, ok) => {
  const x = cb[id];
  if (!x) return;

  delete cb[id];

  if (ok) {
    x.resolve(payload);
  } else {
    x.reject(new Error(payload || "Network request failed"));
  }
};

/* JavaScript -> Android network request */
function nativeFetch(url) {
  return new Promise((resolve, reject) => {
    const id = "r" + (++seq);

    const timer = setTimeout(() => {
      delete cb[id];
      reject(new Error("Request timeout"));
    }, 12000);

    cb[id] = {
      resolve: v => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: e => {
        clearTimeout(timer);
        reject(e);
      }
    };

    try {
      if (!window.Android || !Android.fetch) {
        clearTimeout(timer);
        delete cb[id];
        reject(new Error("Android network bridge unavailable"));
        return;
      }

      Android.fetch(url, id);
    } catch (e) {
      clearTimeout(timer);
      delete cb[id];
      reject(e);
    }
  });
}

const NSE_MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
};

/* NSE dates look like "16-Jan-2025 20:20:21" or "16-Jan-2025",
   which the WebView's Date parser handles inconsistently. */
function parseNseDate(s) {
  if (!s) return null;

  const m = String(s).match(
    /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?/
  );

  if (!m) return null;

  const mon = NSE_MONTHS[m[2]];
  if (mon == null) return null;

  return new Date(
    +m[3], mon, +m[1],
    +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)
  );
}

/* Some sites auto-republish old corporate news with a fresh timestamp on
   every crawl - the date looks "today" but the underlying news is stale.
   Block by domain/title-suffix instead, since date filtering alone can't
   catch these. */
const AGGREGATOR_BLOCKLIST = [
  "scanx.trade", "univest.in", "tipranks.com",
  "simplywall.st", "marketbeat.com", "stockanalysis.com"
];

function isBlockedAggregator(url, title) {
  const t = (title || "").toLowerCase();

  if (AGGREGATOR_BLOCKLIST.some(d =>
    t.endsWith("- " + d.split(".")[0]) || t.includes(d)
  )) return true;

  if (!url) return false;

  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return AGGREGATOR_BLOCKLIST.some(d => host === d || host.endsWith("." + d));
  } catch (e) {
    return false;
  }
}

/* Strip tracking params and trailing slash so the same article linked
   two different ways still dedupes as one item. */
function normalizeUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    u.hash = "";
    const kept = [...u.searchParams.entries()].filter(
      ([k]) => !["utm_source", "utm_medium", "utm_campaign", "utm_content"].includes(k)
    );
    u.search = new URLSearchParams(kept).toString();
    return u.toString().replace(/\/$/, "");
  } catch (e) {
    return url;
  }
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return h;
}

/* Combines a normalized link with a hash of the headline, so the same
   story from two feeds (even with slightly different query params on
   the link) collapses to one dedup key. */
function dedupKey(item) {
  if (item.link) {
    const titleHash = Math.abs(hashCode(item.headline || "")) % 1000000;
    return normalizeUrl(item.link) + "_" + titleHash;
  }
  return item.id || (item.headline + "_" + item.company);
}

function itemTime(x) {
  const d = parseNseDate(x?.date) || new Date(x?.date || 0);
  const t = d.getTime ? d.getTime() : 0;
  return isNaN(t) ? 0 : t;
}

const MAX_PER_BUCKET = 150;

/* However wide the fetch window was, don't actually show anything older
   than this per tab - a stray old-dated item from a supplement feed
   shouldn't sit at the bottom of "latest" results. */
const DAYS_TO_KEEP = { results: 45, actions: 30, filings: 30, news: 2, firms: 7 };

function withinWindow(x, bucket) {
  const t = itemTime(x);
  if (!t) return false;
  const daysAgo = (Date.now() - t) / 86400000;
  const maxDays = DAYS_TO_KEEP[bucket] ?? 30;
  return daysAgo >= -1 && daysAgo <= maxDays;
}

function capRecent(items, bucket) {
  const filtered = bucket
    ? items.filter(x => withinWindow(x, bucket))
    : items;

  return [...filtered]
    .sort((a, b) => itemTime(b) - itemTime(a))
    .slice(0, MAX_PER_BUCKET);
}

/* ===== One entry per story (v1.5) =====
   The same result ("TCS Q2") is reported by a dozen sites in different words.
   foldStories() folds those into ONE card - NSE's own record if there is one,
   otherwise the most trusted publisher - and alsoLine() shows the others as a
   small "Also reported by ..." line, so nothing repeats and nothing is lost. */

const STORY_STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "are", "was", "has", "have", "will", "its", "into",
  "over", "after", "amid", "says", "said", "new", "live", "today", "update", "updates", "stock", "stocks",
  "share", "shares", "price", "check", "here", "how", "why", "what", "key", "news", "report", "reports",
  "market", "markets", "limited", "ltd", "pvt", "private", "corporation", "co", "inc", "fy"
]);
/* If the longer name has one of these extra words it is a different company (SBI vs SBI Life). */
const STORY_DISTINCT = new Set([
  "life", "insurance", "general", "cards", "mutual", "fund", "amc", "securities",
  "capital", "housing", "small", "hotels", "finance", "infra", "retail"
]);
/* First words shared by many unrelated companies - for these the whole name must match. */
const STORY_GENERIC_FIRST = new Set([
  "tata", "bajaj", "hdfc", "icici", "sbi", "adani", "birla", "mahindra", "bharat", "indian", "india",
  "state", "national", "hindustan", "larsen", "jsw", "reliance", "aditya", "kotak", "axis", "power", "coal", "bank"
]);
const TRUSTED_PUBLISHERS = [
  "economic times", "moneycontrol", "mint", "livemint", "business standard", "reuters", "businessline",
  "cnbc", "ndtv profit", "financial express", "bloomberg", "the hindu", "hindustan times"
];
const TYPE_STRENGTH = { results: 3, actions: 2, filings: 1, news: 0 };
const storyTokenCache = new WeakMap();

function storyTokens(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9.%\s]/g, " ")
      .split(/\s+/)
      .map(w => w.replace(/^\.+|\.+$/g, ""))
      .filter(w => w.length >= 2 && !STORY_STOP.has(w))
  );
}

function headlineTokens(x) {
  let t = storyTokenCache.get(x);
  if (!t) {
    t = storyTokens(x.headline);
    storyTokenCache.set(x, t);
  }
  return t;
}

function jaccard(a, b) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return { inter, score: union ? inter / union : 0 };
}

function quarterOf(h) {
  let m = h.match(/\bQ\s?([1-4])\b/i) || h.match(/\bQ([1-4])\s?FY\d{2}\b/i);
  if (m) return "q" + m[1];
  m = h.match(/\b(first|second|third|fourth)[\s-]quarter\b/i);
  return m ? "q" + { first: 1, second: 2, third: 3, fourth: 4 }[m[1].toLowerCase()] : null;
}

function topicOf(x) {
  const h = x.headline || "";
  if (x.type === "results" || quarterOf(h) || /\b(results?|net profit|net loss|earnings)\b/i.test(h)) return "results";
  if (/\bdividend\b/i.test(h)) return "dividend";
  if (/\bbonus\b/i.test(h)) return "bonus";
  if (/\bsplit\b/i.test(h)) return "split";
  if (/\bbuy-?back\b/i.test(h)) return "buyback";
  if (/\brights issue\b/i.test(h)) return "rights";
  return null;
}

/* Who the story is about: NSE items carry the symbol/company; for news it is
   the words in front of "Q2 results" / "dividend" etc. */
function storySubject(x) {
  if (x.symbol) return [...new Set([...storyTokens(x.symbol), ...storyTokens(x.company || "")])];
  const h = x.headline || "";
  const m = h.match(/\bQ\s?[1-4]\b|\bQ[1-4]\s?FY\d{2}\b|\b(?:first|second|third|fourth)[\s-]quarter\b|\bresults?\b|\bnet profit\b|\bnet loss\b|\bearnings\b|\bdividend\b|\bbonus\b|\bsplit\b|\bbuy-?back\b|\brights issue\b/i);
  if (!m) return null;
  const before = h.slice(0, m.index).split(/[:|\u2014\u2013]|\s-\s/).pop();
  let toks = [...storyTokens(before.replace(/\b(?:fy\s?\d{2,4}|preview|review|live)\b/gi, " "))];
  // "Q2 Results Live: TCS posts ..." - the company is the first word after the colon.
  if (!toks.length && h.includes(":")) toks = [...storyTokens(h.split(":").slice(1).join(" "))].slice(0, 1);
  return toks.length ? toks : null;
}

function sameSubject(a, b) {
  /* One side has a distinguishing word the other lacks (SBI vs SBI Life, ITC vs ITC Hotels). */
  const conflict = (x, y) => x.slice(0, 3).some(t => STORY_DISTINCT.has(t) && !y.includes(t));
  if (conflict(a, b) || conflict(b, a)) return false;
  /* Same leading name ("ITC announces..." / "ITC declares...") is the same company,
     unless that first word is shared by many companies (Tata, Bajaj, HDFC...). */
  if (a[0] === b[0] && !STORY_GENERIC_FIRST.has(a[0])) return true;
  const A = new Set(a), B = new Set(b);
  const [s, l] = A.size <= B.size ? [A, B] : [B, A];
  if (![...s].every(t => l.has(t))) return false;
  if (s.size === l.size) return true;
  if (l.size > 6) return false;
  return [...l].filter(t => !s.has(t)).every(t => !STORY_DISTINCT.has(t));
}

/* An NSE record names the company by symbol; a headline may only say "TCS". */
function nseMentions(nse, other) {
  const toks = headlineTokens(other);
  const sym = (nse.symbol || "").toLowerCase();
  const company = [...storyTokens(nse.company || "")].filter(t => t !== sym);
  let hit = sym.length >= 3 && toks.has(sym);
  if (!hit) {
    const n = company.filter(t => toks.has(t)).length;
    hit = company.length >= 2 ? n >= 2 : company.length === 1 && n === 1;
  }
  if (!hit) return false;
  /* "ITC Hotels Q2 results" is not "ITC Q2 results". */
  const subj = storySubject(other);
  const known = new Set([sym, ...company]);
  return !(subj && [...subj].some(t => STORY_DISTINCT.has(t) && !known.has(t)));
}

function sameStory(x, y) {
  const tx = itemTime(x), ty = itemTime(y);
  if (tx && ty && Math.abs(tx - ty) > 72 * 3600000) return false;

  /* Results for different quarters are never the same story. */
  const qx = quarterOf(x.headline || ""), qy = quarterOf(y.headline || "");
  if (qx && qy && qx !== qy) return false;

  const topic = topicOf(x);
  if (topic && topic === topicOf(y)) {
    if (x.symbol && !y.symbol) {
      if (nseMentions(x, y)) return true;
    } else if (y.symbol && !x.symbol) {
      if (nseMentions(y, x)) return true;
    } else {
      const sx = storySubject(x), sy = storySubject(y);
      /* When both headlines name their company, that decides it - agree: same story,
         disagree: different stories, however alike the rest of the wording is. */
      if (sx && sy) return sameSubject(sx, sy);
    }
  }
  /* Same wording (syndicated copy). */
  const { inter, score } = jaccard(headlineTokens(x), headlineTokens(y));
  return inter >= 3 && score >= 0.6;
}

function storyRank(x) {
  if (x.pub === "NSE") return 0;
  const p = String(x.pub || "").toLowerCase();
  return TRUSTED_PUBLISHERS.some(t => p.includes(t)) ? 1 : 2;
}

function dedupeStories(items) {
  const ranked = [...items].sort((a, b) => storyRank(a) - storyRank(b) || itemTime(a) - itemTime(b));
  const clusters = [];
  for (const it of ranked) {
    const home = clusters.find(c => sameStory(c.rep, it));
    if (home) home.others.push(it);
    else clusters.push({ rep: it, others: [] });
  }
  return clusters.map(({ rep, others }) => {
    if (!others.length) return rep;
    /* A story that is a result anywhere belongs on the Results tab. */
    let type = rep.type;
    for (const o of others) if ((TYPE_STRENGTH[o.type] || 0) > (TYPE_STRENGTH[type] || 0)) type = o.type;
    const seen = new Set([rep.pub]);
    const also = [];
    for (const o of [...others].sort((a, b) => itemTime(a) - itemTime(b))) {
      if (seen.has(o.pub)) continue;
      seen.add(o.pub);
      also.push({ pub: o.pub, link: o.link });
    }
    return { ...rep, type, alsoCovered: also.slice(0, 8) };
  });
}

/* Google News appends " - Publisher" to every headline: split it off so cards
   show the real publisher (and so "Also reported by" can name it). */
function splitPublisher(x) {
  if (x.symbol) return { ...x, pub: "NSE" };
  const m = String(x.headline || "").match(/^(.*\S)\s+[-\u2013|]\s+([^-\u2013|\d]{2,40})$/);
  if (m && (x.company === "Google News" || x.company === "")) {
    return { ...x, headline: m[1], company: m[2].trim(), pub: m[2].trim() };
  }
  return { ...x, pub: x.company || "" };
}

/* Fold the same story across Results, Actions and News (Filings and Firms
   are separate lists and are left alone). */
function foldStories(data) {
  const pool = [];
  for (const bucket of ["results", "actions", "news"]) {
    for (const x of data[bucket] || []) pool.push(splitPublisher({ ...x, type: bucket }));
  }
  const stories = dedupeStories(pool);
  for (const bucket of ["results", "actions", "news"]) {
    data[bucket] = capRecent(stories.filter(s => s.type === bucket));
  }
}

function alsoLine(x) {
  const also = x.alsoCovered || [];
  if (!also.length) return "";
  const shown = also.slice(0, 4);
  const names = shown
    .map(o => o.link
      ? `<span class="also-src" data-link="${esc(o.link)}">${esc(o.pub || "source")}</span>`
      : esc(o.pub || "source"))
    .join(" \u00b7 ");
  const extra = also.length - shown.length;
  return `<div class="also">Also reported by ${names}${extra > 0 ? ` +${extra} more` : ""}</div>`;
}
/* ===== end of v1.5 block ===== */

/* ===== search across ALL tabs + exact time (v1.5) ===== */

/* With a search term, look through every tab - not just the one you are on. */
function allTabItems() {
  const seen = new Set();
  const out = [];
  for (const b of ["results", "actions", "filings", "news", "firms"]) {
    for (const x of state.data[b] || []) {
      const k = dedupKey(x);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(x);
    }
  }
  return out.sort((a, b) => itemTime(b) - itemTime(a));
}

/* NSE dates carry no time zone - they are India time. Parse them as IST so the
   shown time is right whatever zone the phone is set to. */
function parseStampIst(input) {
  const s = String(input || "").trim();
  if (!s) return { ts: 0, hasTime: false };
  let m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]+(\d{4})(?:[\sT,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m && NSE_MONTHS[m[2][0].toUpperCase() + m[2].slice(1, 3).toLowerCase()] != null) {
    const mon = NSE_MONTHS[m[2][0].toUpperCase() + m[2].slice(1, 3).toLowerCase()];
    const hasTime = m[4] !== undefined;
    const utc = Date.UTC(+m[3], mon, +m[1], hasTime ? +m[4] : 0, hasTime ? +m[5] : 0, hasTime && m[6] ? +m[6] : 0);
    return { ts: utc - 330 * 60000, hasTime };
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const hasTime = m[4] !== undefined;
    const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], hasTime ? +m[4] : 0, hasTime ? +m[5] : 0, hasTime && m[6] ? +m[6] : 0);
    return { ts: utc - 330 * 60000, hasTime };
  }
  const d = new Date(s); /* RSS pubDate / ISO strings carry their own zone */
  return isNaN(d.getTime()) ? { ts: 0, hasTime: false } : { ts: d.getTime(), hasTime: /\d{1,2}:\d{2}/.test(s) };
}

function fmtWhen(d) {
  if (!d) return "";
  const { ts, hasTime } = parseStampIst(d);
  if (!ts) return String(d);
  const base = { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" };
  if (!hasTime) return new Date(ts).toLocaleDateString("en-IN", { ...base, year: "numeric" });
  return new Date(ts).toLocaleString("en-IN", { ...base, hour: "numeric", minute: "2-digit", hour12: true }) + " IST";
}
/* ===== end of v1.5 additions ===== */

function fmt(d) {
  if (!d) return "";

  const x = parseNseDate(d) || new Date(d);

  if (isNaN(x)) return String(d);

  return x.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function ago(ts) {
  if (!ts) return "Not updated";

  const m = Math.max(
    0,
    Math.round((Date.now() - ts) / 60000)
  );

  if (m < 1) return "Updated just now";

  return m === 1 ? "Updated 1 min ago" : `Updated ${m} min ago`;
}

/* Yahoo Finance */
const quoteCache = new Map();
const QUOTE_TTL = 60 * 1000;

function yahooUrl(symbol) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
}

async function yahooQuote(symbol) {
  const hit = quoteCache.get(symbol);

  if (hit && (Date.now() - hit.at) < QUOTE_TTL) {
    return hit.value;
  }

  if (hit && hit.pending) {
    return hit.pending;
  }

  const job = fetchQuote(symbol);

  quoteCache.set(symbol, { pending: job, at: 0 });

  const value = await job;

  quoteCache.set(symbol, { value, at: Date.now() });

  return value;
}

async function fetchQuote(symbol) {
  let lastError = "";

  /* Index symbols start with ^ and must be used exactly as-is.
     Only company tickers get an exchange suffix. */
  const candidates = symbol.startsWith("^")
    ? [symbol]
    : [symbol + ".NS", symbol + ".BO"];

  for (const s of candidates) {
    try {
      const raw = JSON.parse(await nativeFetch(yahooUrl(s)));
      const m = raw?.chart?.result?.[0]?.meta;

      if (m && m.regularMarketPrice != null) {
        const price = Number(m.regularMarketPrice);

        /* previousClose is the ACTUAL prior session close.
           chartPreviousClose is the close before the whole 5-day
           window, which made the change (and its colour) wrong.
           Fall back to the chart's own closes if neither is given. */
        let prev = null;

        if (m.previousClose != null) {
          prev = Number(m.previousClose);
        } else if (m.chartPreviousClose != null) {
          prev = Number(m.chartPreviousClose);
        } else {
          const closes = (
            raw?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []
          ).filter(v => typeof v === "number");

          if (closes.length >= 2) {
            prev = Number(closes[closes.length - 2]);
          }
        }

        if (prev == null || !isFinite(prev) || prev === 0) {
          prev = price;
        }

        const change = price - prev;

        return {
          ok: true,
          symbol,
          price,
          previous: prev,
          change,
          percent: prev ? (change / prev) * 100 : 0,
          currency: m.currency || "INR"
        };
      }

      lastError = "No price in response";
    } catch (e) {
      lastError = e?.message || String(e);
    }
  }

  return { ok: false, symbol, error: lastError };
}

/* NSE dates */
function nseDate(days) {
  const d = new Date(Date.now() - days * 86400000);

  /* NSE expects DD-MM-YYYY, not YYYY-MM-DD */
  return [
    String(d.getDate()).padStart(2, "0"),
    String(d.getMonth() + 1).padStart(2, "0"),
    d.getFullYear()
  ].join("-");
}

/* NSE API URLs */
function nseUrls() {
  /* 30 days across the whole market was 15,000+ filings - that is
     what made loading and switching tabs feel slow. A week of
     filings/actions is still plenty and loads far faster. */
  return {
    results:
      `https://www.nseindia.com/api/corporates-financial-results?index=equities&period=Quarterly&from_date=${nseDate(45)}&to_date=${nseDate(0)}`,

    actions:
      `https://www.nseindia.com/api/corporates-corporateActions?index=equities&from_date=${nseDate(14)}&to_date=${nseDate(0)}`,

    filings:
      `https://www.nseindia.com/api/corporate-announcements?index=equities&from_date=${nseDate(7)}&to_date=${nseDate(0)}`
  };
}

function normNse(key, raw) {
  const list = Array.isArray(raw)
    ? raw
    : (raw?.data || []);

  return list.map((x, i) => {

    if (key === "results") {
      const sym = x.symbol || "";
      const company = x.companyName || sym;

      const scope =
        x.consolidated === "Consolidated"
          ? "Consolidated"
          : "Standalone";

      const headline = [x.relatingTo, scope]
        .filter(Boolean)
        .join(" \u00b7 ") || "Quarterly results";

      const detailBits = [];
      if (x.audited) detailBits.push(x.audited);
      if (x.fromDate && x.toDate) {
        detailBits.push("Period: " + x.fromDate + " to " + x.toDate);
      }
      if (x.financialYear) detailBits.push("FY: " + x.financialYear);

      return {
        id: "r" + i,
        symbol: sym,
        company,
        headline,
        detail: detailBits.join(" \u00b7 "),
        /* The XBRL link is a raw machine-readable data file, not
           something a person can read - send them to the quote
           page instead. */
        link: sym
          ? "https://www.nseindia.com/get-quotes/equity?symbol=" +
            encodeURIComponent(sym)
          : "",
        date: x.broadCastDate || x.filingDate || ""
      };
    }

    if (key === "actions") {
      const sym = x.symbol || "";
      const company = x.comp || sym;

      const bits = [];
      if (x.exDate && x.exDate !== "-") bits.push("Ex-date: " + x.exDate);
      if (x.recDate && x.recDate !== "-") bits.push("Record date: " + x.recDate);
      if (x.faceVal) bits.push("Face value: \u20b9" + x.faceVal);

      return {
        id: "a" + i,
        symbol: sym,
        company,
        headline: x.subject || "Corporate action",
        detail: bits.join(" \u00b7 "),
        link: sym
          ? "https://www.nseindia.com/get-quotes/equity?symbol=" +
            encodeURIComponent(sym)
          : "",
        /* Show when NSE announced it (has a time); the ex-date stays in the
           detail line above. Falls back to the ex-date if there is no
           announcement time. */
        date: x.caBroadcastDate || (x.exDate && x.exDate !== "-" ? x.exDate : "")
      };
    }

    /* filings / announcements */
    const sym = x.symbol || "";
    const company = x.sm_name || sym;

    return {
      id: "f" + i,
      symbol: sym,
      company,
      headline: x.desc || "Corporate announcement",
      detail: x.attchmntText || "",
      link:
        x.attchmntFile ||
        (sym
          ? "https://www.nseindia.com/get-quotes/equity?symbol=" +
            encodeURIComponent(sym)
          : ""),
      date: x.an_dt || ""
    };
  })
    .filter(x => x.headline)
    .filter((() => {
      /* Keep the first occurrence of each symbol+date+headline
         combination, drop exact repeats. Set-based so it stays
         fast even with thousands of rows. */
      const seen = new Set();
      return x => {
        const key = x.symbol + "|" + x.date + "|" + x.headline;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      };
    })());
}

/* Google News RSS */
function gnews(q) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
}

/* /rss/search ranks by RELEVANCE, not recency - a keyword match from three
   days ago can outrank something from an hour ago. /rss/headlines/section
   is a true chronological feed, most-recent-first, which is what a "latest
   news" tab actually needs. */
function gnewsTopic(topic) {
  return `https://news.google.com/rss/headlines/section/topic/${topic}?hl=en-IN&gl=IN&ceid=IN:en`;
}

/* Supplementary market-news sources. If NSE itself is slow, blocked, or a
   company simply hasn't been picked up by NSE's feed yet, these often have
   it already - keeps results/actions from silently going empty. */
const GENERIC_FEEDS = [
  { url: "https://www.moneycontrol.com/rss/latestnews.xml", source: "Moneycontrol" },
  { url: "https://www.livemint.com/rss/markets", source: "LiveMint" },
  { url: "https://www.business-standard.com/rss/markets-106.rss", source: "Business Standard" },
  { url: "https://feeds.hindustantimes.com/HT-Business?format=xml", source: "Hindustan Times" }
];

function classifyHeadline(titleRaw) {
  const t = (titleRaw || "").toLowerCase();

  /* Deliberately strict - a loose match here is how generic market
     chatter ends up misfiled into Results/Actions instead of News. */
  const resultWords = [
    "q1 results", "q2 results", "q3 results", "q4 results",
    "quarterly results", "earnings beat", "earnings miss",
    "posts record", "reports profit of", "reports loss of"
  ];
  const actionWords = [
    "dividend record date", "dividend ex-date",
    "bonus issue record date", "bonus shares record date",
    "stock split record date", "buyback record date",
    "rights issue record date", "board meeting"
  ];

  if (resultWords.some(w => t.includes(w))) return "results";
  if (actionWords.some(w => t.includes(w))) return "actions";
  return "news";
}

/* Brokerage/analyst call tracking - the "Firms" tab. Scans the same
   market-news feeds for mentions of these firms' names. */
const WATCHED_FIRMS = [
  "Nomura", "Goldman Sachs", "Morgan Stanley", "JP Morgan", "JPMorgan",
  "HSBC", "UBS", "Credit Suisse", "Macquarie", "ICICI Securities",
  "Motilal Oswal", "Sharekhan", "Ventura Securities", "Prabhudas Lilladher",
  "Jefferies", "CLSA", "Kotak Institutional", "Citi", "Bernstein",
  "Emkay Global"
];

function matchFirms(text) {
  const lower = (text || "").toLowerCase();
  return WATCHED_FIRMS.filter(f => lower.includes(f.toLowerCase()));
}

function rssItems(xml, source, type) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const out = [];

  [...doc.querySelectorAll("item")].forEach((it, i) => {
    const title =
      it.querySelector("title")?.textContent?.trim() || "";

    const link =
      it.querySelector("link")?.textContent?.trim() || "";

    const desc =
      it.querySelector("description")?.textContent?.trim() || "";

    const date =
      it.querySelector("pubDate")?.textContent?.trim() || "";

    if (title && !isBlockedAggregator(link, title)) {
      out.push({
        id: source + i,
        symbol: "",
        company: source,
        headline: title,
        detail: desc.replace(/<[^>]*>/g, "").trim(),
        date,
        link,
        type
      });
    }
  });

  return out;
}

/* Main feed loader.

   Buckets are now MERGED from two independent sources rather than NSE
   alone: if NSE is slow, rate-limited, or just hasn't picked something
   up yet, the news-based feeds usually already have it, so results and
   actions rarely go empty. Everything is de-duplicated and sorted by
   actual date before display (capRecent) - previously nothing was
   sorted at all, which was the real cause of "not showing the latest". */
async function loadFeed() {
  $("status").textContent = "Loading live web data...";

  const urls = nseUrls();
  const keys = Object.keys(urls);
  const nseErrors = [];
  const nse = { results: [], actions: [], filings: [] };

  await Promise.allSettled(
    keys.map(async key => {
      try {
        const raw = JSON.parse(await nativeFetch(urls[key]));
        nse[key] = normNse(key, raw);

        if (!nse[key].length) {
          const shape = Array.isArray(raw)
            ? "array of " + raw.length
            : "keys: " + Object.keys(raw || {}).join(",").slice(0, 60);
          nseErrors.push(key + ": empty (" + shape + ")");
        }
      } catch (e) {
        const msg = e?.message || String(e);
        console.log("NSE " + key + " failed:", msg);
        nseErrors.push(key + ": " + msg);
      }
    })
  );

  /* Topic-targeted feeds land directly in their bucket. The BUSINESS
     topic feed is chronological (unlike a keyword search), which is
     what keeps the News tab actually current. */
  const targeted = [
    ["results", gnews("NSE India Q results net profit when:2d")],
    ["results", gnews("quarterly results BSE NSE India when:2d")],
    ["actions", gnews("NSE India dividend bonus buyback record date when:3d")],
    ["actions", gnews("stock split rights issue NSE India when:3d")],
    ["news", gnewsTopic("BUSINESS")]
  ];

  const fromNews = { results: [], actions: [], news: [] };

  await Promise.allSettled(
    targeted.map(async ([bucket, url]) => {
      try {
        const xml = await nativeFetch(url);
        fromNews[bucket].push(...rssItems(xml, "Google News", bucket));
      } catch (e) {
        console.log("News (" + bucket + ") failed:", e);
      }
    })
  );

  /* Generic market feeds: classified by keyword into the right bucket,
     and separately scanned for brokerage/analyst firm mentions. */
  const generic = [];

  await Promise.allSettled(
    GENERIC_FEEDS.map(async feed => {
      try {
        const xml = await nativeFetch(feed.url);
        generic.push(...rssItems(xml, feed.source, "news"));
      } catch (e) {
        console.log("Feed (" + feed.source + ") failed:", e);
      }
    })
  );

  generic.forEach(it => {
    const bucket = classifyHeadline(it.headline);
    fromNews[bucket].push(it);
  });

  const firms = generic
    .map(it => {
      const hit = matchFirms(it.headline + " " + it.detail);
      return hit.length
        ? { ...it, id: "firm-" + it.id, detail: hit.join(", ") }
        : null;
    })
    .filter(Boolean);

  /* Mark news-sourced items landing in Results/Actions as such, so it's
     clear which is confirmed NSE data versus news coverage of it. */
  const tagAsNews = items => items.map(it => ({
    ...it,
    detail: it.detail ? "News coverage · " + it.detail : "News coverage"
  }));

  const dedupe = items => {
    const seen = new Set();
    return items.filter(x => {
      const key = dedupKey(x);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  state.data.results = capRecent(
    dedupe([...nse.results, ...tagAsNews(fromNews.results)]), "results"
  );
  state.data.actions = capRecent(
    dedupe([...nse.actions, ...tagAsNews(fromNews.actions)]), "actions"
  );
  state.data.filings = capRecent(nse.filings, "filings");
  state.data.news = capRecent(dedupe(fromNews.news), "news");
  state.data.firms = capRecent(dedupe(firms), "firms");

  /* One entry per story: the same result reported by many sites becomes a
     single card with an "Also reported by" line. */
  foldStories(state.data);

  state.ts = Date.now();

  render();

  $("status").textContent = nseErrors.length
    ? "NSE → " + nseErrors.join(" · ") + " (showing news-source results)"
    : "Live data • NSE + Google News + Yahoo Finance";
}

function paintPrice(node, q) {
  if (!q?.ok) return;

  const cls =
    q.change > 0 ? "up" :
    q.change < 0 ? "down" :
    "flat";

  node.textContent =
    `${q.price.toFixed(2)} ${q.change >= 0 ? "+" : ""}${q.change.toFixed(2)}`;

  node.className = "price " + cls;
}

async function enrichPrices(items) {
  const nodes = [...document.querySelectorAll("[data-symbol]")]
    .filter(n => n.dataset.symbol);

  /* Anything already cached is painted immediately, with no
     network call at all. This is what makes searching feel fast. */
  const need = [];

  nodes.forEach(n => {
    const s = n.dataset.symbol;
    const hit = quoteCache.get(s);

    if (hit && hit.value && (Date.now() - hit.at) < QUOTE_TTL) {
      paintPrice(n, hit.value);
    } else if (!need.includes(s)) {
      need.push(s);
    }
  });

  /* Only fetch what we do not already have, and cap it so a long
     list never fires off dozens of requests at once. */
  const batch = need.slice(0, 12);

  const token = ++enrichPrices.run;

  await Promise.all(
    batch.map(async s => {
      const q = await yahooQuote(s);

      /* A newer render started while this was in flight - drop it. */
      if (token !== enrichPrices.run) return;

      document
        .querySelectorAll(`[data-symbol="${CSS.escape(s)}"]`)
        .forEach(n => paintPrice(n, q));
    })
  );
}

enrichPrices.run = 0;

function filtered() {
  /* With a search term, look through every tab, not just this one. */
  const arr = state.q.trim() ? allTabItems() : (state.data[state.tab] || []);
  const q = state.q.trim().toLowerCase();

  if (!q) return arr;

  return arr.filter(x =>
    (
      x.symbol + " " +
      x.company + " " +
      x.headline + " " +
      x.detail
    ).toLowerCase().includes(q)
  );
}

function render() {
  ["results", "actions", "filings", "news", "firms"].forEach(k => {
    const el = $("n-" + k);
    if (el) {
      el.textContent =
        (state.data[k] || []).length;
    }
  });

  $("n-watch").textContent =
    state.watch.length;

  document
    .querySelectorAll("nav button")
    .forEach(b =>
      b.classList.toggle(
        "active",
        b.dataset.tab === state.tab
      )
    );

  $("watchPanel").hidden =
    state.tab !== "watchlist";

  $("list").hidden =
    state.tab === "watchlist";

  if (state.tab === "watchlist") {
    renderWatch();
    $("updated").textContent = ago(state.ts);
    return;
  }

  const items = filtered();

  $("empty").hidden = items.length > 0;

  $("empty").textContent =
    items.length
      ? ""
      : "No matching items. Try another search or refresh.";

  /* Rendering thousands of cards in one go is what made the app feel
     slow - only build the DOM for a page at a time. */
  const visible = items.slice(0, state.shown);
  const remaining = items.length - visible.length;

  $("list").innerHTML = visible.map(x => {
    const starred =
      x.symbol && state.watch.includes(x.symbol);

    const hasDetail = !!(x.detail || "").trim();
    const hasLink = !!(x.link || "");

    return `
    <article class="card${state.open.has(x.id) ? " open" : ""}"
      data-card="${esc(x.id)}">

      <div class="cardtop">
        <b class="symbol">${esc(x.symbol || x.company || "-")}</b>

        <span
          class="price"
          data-symbol="${esc(x.symbol || "")}">
        </span>

        <button
          class="star${starred ? " on" : ""}"
          data-star="${esc(x.symbol || "")}">
          ${starred ? "\u2605" : "\u2606"}
        </button>
      </div>

      <div class="company">
        ${esc(x.company || "")}
      </div>

      <div class="headline">
        ${esc(x.headline || "")}
      </div>

      ${hasDetail
        ? `<div class="detail">${esc(x.detail)}</div>`
        : ""}

      ${alsoLine(x)}

      <div class="meta">
        <span>${esc(fmtWhen(x.date))}</span>

        ${hasDetail
          ? `<button class="act" data-toggle="${esc(x.id)}">${
              state.open.has(x.id) ? "LESS" : "MORE"
            }</button>`
          : ""}

        ${hasLink
          ? `<button class="act open-link"
               data-link="${esc(x.link)}">OPEN \u2197</button>`
          : ""}
      </div>
    </article>`;
  }).join("") + (
    remaining > 0
      ? `<button id="loadMore" class="loadmore">
           Show ${Math.min(remaining, 60)} more (${remaining} left)
         </button>`
      : ""
  );

  enrichPrices(visible);

  $("updated").textContent = ago(state.ts);
}

/* One listener for the whole list, attached once. Re-attaching a
   listener per card on every render was part of the slowness. */
$("list").addEventListener("click", e => {
  if (e.target.closest("#loadMore")) {
    state.shown += 60;
    render();
    return;
  }

  const star = e.target.closest("[data-star]");
  if (star) {
    e.stopPropagation();
    toggleWatch(star.dataset.star);
    return;
  }

  const link = e.target.closest("[data-link]");
  if (link) {
    e.stopPropagation();
    const u = link.dataset.link;
    if (u && window.Android?.openExternal) {
      Android.openExternal(u);
    }
    return;
  }

  const card = e.target.closest("[data-card]");
  if (!card) return;

  const id = card.dataset.card;

  if (state.open.has(id)) {
    state.open.delete(id);
  } else {
    state.open.add(id);
  }

  card.classList.toggle("open");

  const btn = card.querySelector("[data-toggle]");
  if (btn) {
    btn.textContent = state.open.has(id) ? "LESS" : "MORE";
  }
});

function toggleWatch(s) {
  if (!s) return;

  const i = state.watch.indexOf(s);

  if (i >= 0) {
    state.watch.splice(i, 1);
  } else {
    state.watch.push(s);
  }

  localStorage.setItem(
    "arcanum_watch",
    JSON.stringify(state.watch)
  );

  render();
}

function renderWatch() {
  const el = $("watchRows");

  if (!state.watch.length) {
    el.innerHTML =
      `<div id="empty" style="display:block">
        No stocks in watchlist.
      </div>`;
    return;
  }

  el.innerHTML = state.watch.map(s => `
    <div class="wrow">
      <b class="wsym">${esc(s)}</b>
      <span
        class="wprice"
        id="wp-${esc(s)}">
        Loading...
      </span>
      <button data-remove="${esc(s)}">×</button>
    </div>
  `).join("");

  document
    .querySelectorAll("[data-remove]")
    .forEach(b => {
      b.onclick = () => {
        toggleWatch(b.dataset.remove);
      };
    });

  Promise.all(
    state.watch.map(
      async s => [s, await yahooQuote(s)]
    )
  ).then(all => {
    all.forEach(([s, q]) => {
      const e = $("wp-" + s);

      if (!e) return;

      if (!q.ok) {
        e.textContent = "Unavailable";
        return;
      }

      e.textContent =
        `₹${q.price.toFixed(2)} ` +
        `${q.change >= 0 ? "+" : ""}${q.change.toFixed(2)}`;
    });
  });
}

/* UI */
$("tabs").addEventListener("click", e => {
  const b = e.target.closest("button");

  if (!b) return;

  state.tab = b.dataset.tab;
  state.shown = 60;

  render();
});

let searchTimer = null;

$("search").addEventListener("input", e => {
  state.q = e.target.value;
  state.shown = 60;

  /* Wait until typing pauses before re-rendering the whole list. */
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 220);
});

$("clear").onclick = () => {
  $("search").value = "";
  state.q = "";
  render();
};

$("refresh").onclick = () => {
  loadFeed();
};

$("addWatch").onclick = () => {
  const v =
    $("watchInput").value
      .trim()
      .toUpperCase();

  if (!v) return;

  if (!state.watch.includes(v)) {
    state.watch.push(v);
  }

  localStorage.setItem(
    "arcanum_watch",
    JSON.stringify(state.watch)
  );

  $("watchInput").value = "";

  render();
};

$("watchInput").addEventListener(
  "keydown",
  e => {
    if (e.key === "Enter") {
      $("addWatch").click();
    }
  }
);

/* Start application */
try {
  const vs = document.querySelectorAll("footer span");
  if (vs.length > 1) {
    vs[vs.length - 1].textContent =
      "NSE + Google News + Yahoo Finance \u00b7 v2.0.0";
  }
} catch (e) {}

state.ts = Date.now();

render();

/* Tells index.html the script loaded completely. */
window.__arcanumReady = true;

loadFeed().catch(e => {
  console.error(e);
  $("status").textContent =
    "Unable to load live data. Tap refresh to try again.";
  render();
});

setInterval(() => {
  if (state.tab !== "watchlist") {
    loadFeed().catch(console.error);
  }
}, 5 * 60 * 1000);
