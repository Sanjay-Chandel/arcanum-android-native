const state = {
  tab: "results",
  q: "",
  watch: JSON.parse(localStorage.getItem("arcanum_watch") || "[]"),
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
function yahooUrl(symbol) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
}

async function yahooQuote(symbol) {
  let lastError = "";

  for (const s of [symbol + ".NS", symbol + ".BO"]) {
    try {
      const raw = JSON.parse(await nativeFetch(yahooUrl(s)));
      const m = raw?.chart?.result?.[0]?.meta;

      if (m && m.regularMarketPrice != null) {
        return {
          ok: true,
          symbol,
          price: Number(m.regularMarketPrice),
          previous: Number(m.chartPreviousClose || m.previousClose || 0),
          change: Number(
            m.regularMarketPrice -
            (m.chartPreviousClose || m.previousClose || m.regularMarketPrice)
          ),
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

  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")
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
        date:
          x.re_broadcast_date ||
          x.date ||
          ""
      };
    }

    if (key === "actions") {
      return {
        id: "a" + i,
        symbol: sym,
        company,
        headline:
          x.subject ||
          x.purpose ||
          x.ex_date ||
          "Corporate action",
        detail:
          x.faceVal ||
          x.purpose ||
          x.subject ||
          "",
        date:
          x.exDate ||
          x.recordDate ||
          x.ex_date ||
          x.date ||
          ""
      };
    }

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
        x.attchmntFile ||
        x.description ||
        x.subject ||
        "",
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
        detail: desc.replace(/<[^>]*>/g, "").slice(0, 180),
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
    ? "News OK, NSE failed → " + nseErrors.join(" · ")
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

  return `
    <div class="market ${cls}">
      <b>${esc(q.symbol)}</b>
      <strong>₹${q.price.toFixed(2)}</strong>
      <span>${arrow} ${q.change.toFixed(2)}</span>
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

async function enrichPrices(items) {
  const syms = [
    ...new Set(
      items
        .map(x => x.symbol)
        .filter(Boolean)
    )
  ].slice(0, 20);

  const qs = await Promise.all(
    syms.map(s => yahooQuote(s))
  );

  const map = Object.fromEntries(
    qs.map(q => [q.symbol, q])
  );

  document
    .querySelectorAll("[data-symbol]")
    .forEach(n => {
      const q = map[n.dataset.symbol];

      if (!q?.ok) return;

      const cls =
        q.change > 0 ? "up" :
        q.change < 0 ? "down" :
        "flat";

      n.textContent =
        `₹${q.price.toFixed(2)} ${q.change >= 0 ? "+" : ""}${q.change.toFixed(2)}`;

      n.className = "price " + cls;
    });
}

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

  $("list").innerHTML = items.map(x => `
    <article class="card"
      data-open="${esc(x.link || "")}">

      <div class="cardtop">
        <b class="symbol">${esc(x.symbol || x.company || "-")}</b>

        <span
          class="price"
          data-symbol="${esc(x.symbol || "")}">
        </span>
      </div>

      <div class="company">
        ${esc(x.company || "")}
      </div>

      <div class="headline">
        ${esc(x.headline || "")}
      </div>

      <div class="detail">
        ${esc(x.detail || "")}
      </div>

      <div class="meta">
        ${esc(fmt(x.date))}
      </div>

      <button
        class="star"
        data-star="${esc(x.symbol || "")}">
        ☆
      </button>
    </article>
  `).join("");

  document
    .querySelectorAll("[data-open]")
    .forEach(c => {
      c.addEventListener("click", e => {
        if (e.target.closest("[data-star]")) return;

        const u = c.dataset.open;

        if (u && window.Android?.openExternal) {
          Android.openExternal(u);
        }
      });
    });

  document
    .querySelectorAll("[data-star]")
    .forEach(b => {
      b.addEventListener("click", e => {
        e.stopPropagation();
        toggleWatch(b.dataset.star);
      });
    });

  enrichPrices(items);

  $("updated").textContent = ago(state.ts);
}

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

$("search").addEventListener("input", e => {
  state.q = e.target.value;
  render();
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