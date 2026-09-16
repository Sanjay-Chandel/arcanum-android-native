const state = {
  tab: "results",
  q: "",
  watch: JSON.parse(localStorage.getItem("arcanum_watch") || "[]"),
  open: new Set(),
  data: {
    results: [],
    actions: [],
    filings: [],
    news: []
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

function fmt(d) {
  if (!d) return "";

  const x = new Date(d);

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
  return {
    results:
      `https://www.nseindia.com/api/corporates-financial-results?index=equities&period=Quarterly&from_date=${nseDate(45)}&to_date=${nseDate(0)}`,

    actions:
      `https://www.nseindia.com/api/corporates-corporateActions?index=equities&from_date=${nseDate(30)}&to_date=${nseDate(0)}`,

    filings:
      `https://www.nseindia.com/api/corporate-announcements?index=equities&from_date=${nseDate(30)}&to_date=${nseDate(0)}`
  };
}

function normNse(key, raw) {
  const list = Array.isArray(raw)
    ? raw
    : (raw?.data || []);

  return list.map((x, i) => {
    const sym =
      x.symbol ||
      x.sml ||
      x.symbolName ||
      "";

    const company =
      x.sm_name ||
      x.companyName ||
      x.company ||
      sym;

    if (key === "results") {
      return {
        id: "r" + i,
        symbol: sym,
        company,
        headline:
          "Quarterly results - " +
          (x.re_broadcast_date || x.re_broadcast_date_new || ""),
        detail:
          x.details ||
          x.description ||
          x.subject ||
          "",
        link:
          x.xbrl ||
          x.naviLink ||
          (sym
            ? "https://www.nseindia.com/get-quotes/equity?symbol=" +
              encodeURIComponent(sym)
            : ""),
        date:
          x.re_broadcast_date ||
          x.date ||
          ""
      };
    }

    if (key === "actions") {
      const bits = [];

      if (x.purpose) bits.push("Purpose: " + x.purpose);
      if (x.exDate || x.ex_date) bits.push("Ex-date: " + (x.exDate || x.ex_date));
      if (x.recDate || x.recordDate) bits.push("Record date: " + (x.recDate || x.recordDate));
      if (x.faceVal) bits.push("Face value: " + x.faceVal);
      if (x.series) bits.push("Series: " + x.series);

      return {
        id: "a" + i,
        symbol: sym,
        company,
        headline:
          x.subject ||
          x.purpose ||
          x.ex_date ||
          "Corporate action",
        detail: bits.join(" \u00b7 "),
        link: sym
          ? "https://www.nseindia.com/get-quotes/equity?symbol=" +
            encodeURIComponent(sym)
          : "",
        date:
          x.exDate ||
          x.recordDate ||
          x.ex_date ||
          x.date ||
          ""
      };
    }

    /* Filings: the attachment is a real PDF link, so use it as the
       link rather than dumping the raw URL into the body text. */
    return {
      id: "f" + i,
      symbol: sym,
      company,
      headline:
        x.subject ||
        x.desc ||
        x.description ||
        "Corporate announcement",
      detail:
        x.attchmntText ||
        x.description ||
        x.desc ||
        x.subject ||
        "",
      link:
        x.attchmntFile ||
        (sym
          ? "https://www.nseindia.com/get-quotes/equity?symbol=" +
            encodeURIComponent(sym)
          : ""),
      date:
        x.an_dt ||
        x.broadcastDate ||
        x.date ||
        ""
    };
  }).filter(x => x.headline);
}

/* Google News RSS */
function gnews(q) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
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

    if (title) {
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

/* Main feed loader */
async function loadFeed() {
  $("status").textContent = "Loading live web data...";

  const urls = nseUrls();

  const keys = Object.keys(urls);
  const nseErrors = [];

  /* NSE requests run independently */
  await Promise.allSettled(
    keys.map(async key => {
      try {
        const raw = JSON.parse(
          await nativeFetch(urls[key])
        );

        state.data[key] = normNse(key, raw);

        if (!state.data[key].length) {
          const shape = Array.isArray(raw)
            ? "array of " + raw.length
            : "keys: " + Object.keys(raw || {}).join(",").slice(0, 60);
          nseErrors.push(key + ": empty (" + shape + ")");
        }
      } catch (e) {
        const msg = e?.message || String(e);
        console.log("NSE " + key + " failed:", msg);
        nseErrors.push(key + ": " + msg);
        state.data[key] = [];
      }
    })
  );

  /* Google News should never block the application */
  const feeds = [
    [
      "news",
      gnews("Indian stocks NSE BSE market companies when:1d")
    ],
    [
      "news",
      gnews("Indian stock corporate announcement firms when:1d")
    ],
    [
      "news",
      gnews("Indian quarterly results stocks when:3d")
    ]
  ];

  let news = [];

  await Promise.allSettled(
    feeds.map(async ([type, url]) => {
      try {
        const xml = await nativeFetch(url);
        news.push(...rssItems(xml, "Google News", type));
      } catch (e) {
        console.log("News failed:", e);
      }
    })
  );

  const seen = new Set();

  state.data.news = news
    .filter(x => {
      if (seen.has(x.id)) return false;
      seen.add(x.id);
      return true;
    })
    .slice(0, 150);

  state.ts = Date.now();

  render();

  $("status").textContent = nseErrors.length
    ? "NSE → " + nseErrors.join(" · ")
    : "Live data • NSE + Google News + Yahoo Finance";
}

/* Market cards */
function marketCard(q) {
  if (!q?.ok) {
    return `<div class="market">
      <b>${esc(q?.symbol || "")}</b>
      <span>Unavailable</span>
      <em class="err">${esc((q?.error || "").slice(0, 60))}</em>
    </div>`;
  }

  const cls =
    q.change > 0 ? "up" :
    q.change < 0 ? "down" :
    "flat";

  const arrow =
    q.change > 0 ? "▲" :
    q.change < 0 ? "▼" :
    "•";

  const pct = (q.percent ?? 0).toFixed(2);

  return `
    <div class="market ${cls}">
      <b>${esc(q.symbol)}</b>
      <strong>${q.price.toFixed(2)}</strong>
      <span>${arrow} ${Math.abs(q.change).toFixed(2)} (${pct}%)</span>
    </div>`;
}

async function loadMarket() {
  const specs = [
    ["NIFTY 50", "^NSEI"],
    ["BANK NIFTY", "^NSEBANK"],
    ["SENSEX", "^BSESN"]
  ];

  const el = $("market");

  if (!el) return;

  el.innerHTML = specs
    .map(x =>
      `<div class="market">
        <b>${esc(x[0])}</b>
        <span>Loading...</span>
      </div>`
    )
    .join("");

  const qs = await Promise.all(
    specs.map(async x => {
      const q = await yahooQuote(x[1]);
      return {
        ...q,
        symbol: x[0]
      };
    })
  );

  el.innerHTML = qs.map(marketCard).join("");
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
  const arr = state.data[state.tab] || [];
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
  ["results", "actions", "filings", "news"].forEach(k => {
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

  $("list").innerHTML = items.map(x => {
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

      <div class="meta">
        <span>${esc(fmt(x.date))}</span>

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
  }).join("");

  enrichPrices(items);

  $("updated").textContent = ago(state.ts);
}

/* One listener for the whole list, attached once. Re-attaching a
   listener per card on every render was part of the slowness. */
$("list").addEventListener("click", e => {
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

  render();
});

let searchTimer = null;

$("search").addEventListener("input", e => {
  state.q = e.target.value;

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
  loadMarket();
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
      "NSE + Google News + Yahoo Finance \u00b7 v1.6.0";
  }
} catch (e) {}

state.ts = Date.now();

render();

loadFeed().catch(e => {
  console.error(e);
  $("status").textContent =
    "Unable to load live data. Tap refresh to try again.";
  render();
});

loadMarket().catch(e => {
  console.error(e);
});

setInterval(() => {
  loadMarket().catch(console.error);

  if (state.tab !== "watchlist") {
    loadFeed().catch(console.error);
  }
}, 5 * 60 * 1000);
