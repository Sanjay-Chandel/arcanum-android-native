const state = {
  data: { results: [], actions: [], filings: [], news: [], errors: [], fetchedAt: null },
  activeTab: "results",
  query: "",
  watchOnly: false,
  watchlist: []
};

const NSE_QUOTE_BASE = "https://www.nseindia.com/get-quotes/equity?symbol=";

const els = {
  tickerTrackNse: document.getElementById("tickerTrackNse"),
  tickerTrackBse: document.getElementById("tickerTrackBse"),
  statusLine: document.getElementById("statusLine"),
  refreshBtn: document.getElementById("refreshBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  searchInput: document.getElementById("searchInput"),
  watchOnlyBtn: document.getElementById("watchOnlyBtn"),
  tabs: document.getElementById("tabs"),
  list: document.getElementById("list"),
  emptyState: document.getElementById("emptyState"),
  lastUpdated: document.getElementById("lastUpdated"),
  cardTemplate: document.getElementById("cardTemplate"),
  watchlistPanel: document.getElementById("watchlistPanel"),
  wlAddInput: document.getElementById("wlAddInput"),
  wlAddBtn: document.getElementById("wlAddBtn"),
  wlList: document.getElementById("wlList"),
  countWatch: document.getElementById("countWatch"),
  counts: {
    results: document.getElementById("countResults"),
    actions: document.getElementById("countActions"),
    filings: document.getElementById("countFilings"),
    news: document.getElementById("countNews")
  }
};

const TAB_LABELS = { results: "RESULT", actions: "ACTION", filings: "FILING", news: "NEWS" };

function fmtDate(d) {
  if (!d) return "";
  const hasTime = /\d{1,2}:\d{2}/.test(d);
  const parsed = new Date(d);
  if (isNaN(parsed)) return d;
  if (hasTime) {
    return parsed.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "numeric",
      minute: "2-digit"
    });
  }
  return parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function timeAgo(ts) {
  if (!ts) return "Never updated";
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "Updated just now";
  if (mins < 60) return `Updated ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `Updated ${hrs}h ago`;
}

function itemLink(item) {
  if (item.link) return item.link;
  if (item.symbol) return NSE_QUOTE_BASE + encodeURIComponent(item.symbol);
  return "";
}

function openItem(item) {
  const url = itemLink(item);
  if (url) window.open(url, "_blank", "noopener");
}

function renderTickerRow(trackEl, rows, errorMsg) {
  if (!rows || rows.length === 0) {
    trackEl.innerHTML = `<span class="ticker__item">${
      errorMsg ? "Feed unavailable right now" : "No data"
    }</span>`;
    return;
  }
  const makeItem = (r) => {
    const dir = r.change > 0 ? "up" : r.change < 0 ? "down" : "flat";
    const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "•";
    const pct = typeof r.pChange === "number" ? `${r.pChange > 0 ? "+" : ""}${r.pChange.toFixed(2)}%` : "";
    return `<span class="ticker__item ${dir}"><b>${escapeHtml(r.symbol)}</b>₹${r.lastPrice} ${arrow} ${pct}</span>`;
  };
  // Duplicate the row so the scroll loop (translateX -50%) has no visible seam.
  const html = rows.map(makeItem).join("") + rows.map(makeItem).join("");
  trackEl.innerHTML = html;
}

async function loadTickers() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "BB_GET_TICKER" });
    const data = res?.data || { nse: [], bse: [] };
    renderTickerRow(els.tickerTrackNse, data.nse, data.nseError);
    renderTickerRow(els.tickerTrackBse, data.bse, data.bseError);
  } catch (e) {
    // Background not ready yet or messaging failed — leave the "Loading…" state,
    // the next interval tick will retry.
  }
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function currentItems() {
  const raw = state.data[state.activeTab] || [];
  return raw
    .filter((it) => {
      if (state.watchOnly && !state.watchlist.includes(it.symbol)) return false;
      if (!state.query) return true;
      const q = state.query.toLowerCase();
      return (
        (it.symbol || "").toLowerCase().includes(q) ||
        (it.company || "").toLowerCase().includes(q) ||
        (it.headline || "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, 150);
}

function renderCounts() {
  els.counts.results.textContent = state.data.results.length;
  els.counts.actions.textContent = state.data.actions.length;
  els.counts.filings.textContent = state.data.filings.length;
  els.counts.news.textContent = state.data.news.length;
}

function renderList() {
  const items = currentItems();
  els.list.querySelectorAll(".card").forEach((n) => n.remove());

  if (items.length === 0) {
    els.emptyState.style.display = "block";
    const relevantErrors = (state.data.errors || []).filter((e) => e.key && e.key.startsWith(state.activeTab));
    if (relevantErrors.length > 0) {
      const msgs = relevantErrors.map((e) => escapeHtml(e.message)).join("<br/>");
      els.emptyState.innerHTML = `<p>Couldn't load ${state.activeTab} this refresh:<br/><span style="font-size:10px">${msgs}</span><br/>Tap ⟳ to retry.</p>`;
    } else {
      els.emptyState.innerHTML = `<p>No ${state.activeTab} match your filters right now.<br/>Try clearing search or the watchlist filter, or tap ⟳ to refresh.</p>`;
    }
    return;
  }
  els.emptyState.style.display = "none";

  const frag = document.createDocumentFragment();
  const priceTargets = new Map(); // symbol -> [priceElements]
  let rendered = 0;
  for (const item of items) {
    try {
      const node = els.cardTemplate.content.cloneNode(true);
      const card = node.querySelector(".card");
      const url = itemLink(item);
      card.dataset.clickable = String(Boolean(url));

      node.querySelector(".card__symbol").textContent = item.symbol || item.source || "—";
      node.querySelector(".card__company").textContent = item.symbol ? item.company || "" : item.source ? `via ${item.source}` : "";
      node.querySelector(".card__headline").textContent = item.headline || "";
      const badge = node.querySelector(".card__badge");
      badge.textContent = TAB_LABELS[item.type] || String(item.type || "").toUpperCase();
      badge.className = `card__badge card__badge--${item.type || "news"}`;
      node.querySelector(".card__detail").textContent = item.detail || "";
      node.querySelector(".card__date").textContent = fmtDate(item.date);
      node.querySelector(".card__open").style.visibility = url ? "visible" : "hidden";

      const priceEl = node.querySelector(".card__price");
      if (item.symbol) {
        priceEl.textContent = "";
        if (!priceTargets.has(item.symbol)) priceTargets.set(item.symbol, []);
        priceTargets.get(item.symbol).push(priceEl);
      }

      const star = node.querySelector(".card__star");
      if (item.symbol) {
        const on = state.watchlist.includes(item.symbol);
        star.textContent = on ? "★" : "☆";
        star.dataset.on = String(on);
        star.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleWatch(item.symbol, star);
        });
      } else {
        star.style.display = "none";
      }

      card.addEventListener("click", () => openItem(item));
      frag.appendChild(node);
      rendered++;
    } catch (e) {
      // Skip a malformed row rather than let it blank the whole tab.
      console.warn("Bazaar Board: skipped a card that failed to render", e, item);
    }
  }
  els.list.appendChild(frag);
  loadPrices(priceTargets);

  if (rendered === 0 && items.length > 0) {
    els.emptyState.style.display = "block";
    els.emptyState.innerHTML = `<p>Found ${items.length} ${state.activeTab} items but couldn't display them. Tap ⟳ to retry.</p>`;
  }
}

async function loadPrices(priceTargets) {
  // Cap concurrent lookups so we don't hammer NSE with one request per row —
  // most of the value is in the ~25 companies actually visible on screen.
  const symbols = [...priceTargets.keys()].slice(0, 25);
  await Promise.all(
    symbols.map(async (symbol) => {
      let res;
      try {
        res = await chrome.runtime.sendMessage({ type: "BB_GET_QUOTE", symbol });
      } catch (e) {
        return;
      }
      const q = res?.data;
      const els_ = priceTargets.get(symbol) || [];
      if (!q || !q.ok || q.lastPrice == null) return;
      const primarySignal = typeof q.pChange === "number" ? q.pChange : q.change;
      const dir = primarySignal > 0 ? "up" : primarySignal < 0 ? "down" : "flat";
      const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "•";
      const pct = typeof q.pChange === "number" ? `${q.pChange > 0 ? "+" : ""}${q.pChange.toFixed(2)}%` : "";
      for (const el of els_) {
        el.textContent = `₹${q.lastPrice} ${arrow} ${pct}`;
        el.className = `card__price ${dir}`;
      }
    })
  );
}

async function toggleWatch(symbol, starEl) {
  if (!symbol) return;
  const idx = state.watchlist.indexOf(symbol);
  if (idx >= 0) state.watchlist.splice(idx, 1);
  else state.watchlist.push(symbol);
  await chrome.storage.local.set({ bb_watchlist: state.watchlist });
  renderWatchlistCount();
  if (starEl) {
    const on = state.watchlist.includes(symbol);
    starEl.textContent = on ? "★" : "☆";
    starEl.dataset.on = String(on);
  }
}

function renderAll() {
  renderCounts();
  renderList();
  els.lastUpdated.textContent = timeAgo(state.data.fetchedAt);
  els.statusLine.textContent =
    state.data.errors && state.data.errors.length > 0
      ? "Feed partially degraded — retrying in background"
      : "NSE + market news feed · live";
}

function setActiveTab(tab) {
  state.activeTab = tab;
  [...els.tabs.querySelectorAll(".tab")].forEach((btn) => {
    btn.dataset.active = String(btn.dataset.tab === tab);
  });
  if (tab === "watchlist") {
    els.list.style.display = "none";
    els.emptyState.style.display = "none";
    els.watchlistPanel.style.display = "block";
    renderWatchlistPanel();
  } else {
    els.watchlistPanel.style.display = "none";
    els.list.style.display = "";
    renderList();
  }
}

// ---------- Dedicated Watchlist tab: add/remove + live NSE prices ----------

function renderWatchlistCount() {
  els.countWatch.textContent = state.watchlist.length;
}

async function renderWatchlistPanel() {
  const listEl = els.wlList;
  if (state.watchlist.length === 0) {
    listEl.innerHTML = `<li class="wl-empty">No symbols yet — add one above to start tracking its live price.</li>`;
    return;
  }
  listEl.innerHTML = state.watchlist
    .map(
      (sym) => `
    <li class="wl-row" data-symbol="${escapeHtml(sym)}">
      <span class="wl-symbol">${escapeHtml(sym)}</span>
      <span class="wl-price wl-price--loading">Loading…</span>
      <button class="wl-remove" title="Remove from watchlist">✕</button>
    </li>`
    )
    .join("");
  listEl.querySelectorAll(".wl-remove").forEach((btn) => {
    btn.addEventListener("click", () => removeFromWatchlist(btn.closest(".wl-row").dataset.symbol));
  });
  await refreshWatchlistPrices();
}

async function refreshWatchlistPrices() {
  const rows = [...els.wlList.querySelectorAll(".wl-row")];
  await Promise.all(
    rows.map(async (row) => {
      const symbol = row.dataset.symbol;
      const priceEl = row.querySelector(".wl-price");
      let res;
      try {
        res = await chrome.runtime.sendMessage({ type: "BB_GET_QUOTE", symbol });
      } catch (e) {
        return;
      }
      const q = res?.data;
      if (!q || !q.ok || q.lastPrice == null) {
        priceEl.textContent = "Unavailable";
        priceEl.className = "wl-price";
        return;
      }
      const primarySignal = typeof q.pChange === "number" ? q.pChange : q.change;
      const dir = primarySignal > 0 ? "up" : primarySignal < 0 ? "down" : "flat";
      const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "•";
      const pct = typeof q.pChange === "number" ? `${q.pChange > 0 ? "+" : ""}${q.pChange.toFixed(2)}%` : "";
      const src = q.source === "Yahoo" ? `<span class="wl-source" title="NSE unreachable — showing Yahoo Finance instead">via Yahoo</span>` : "";
      priceEl.innerHTML = `₹${q.lastPrice} ${arrow} ${pct} ${src}`;
      priceEl.className = `wl-price ${dir}`;
    })
  );
}

async function addToWatchlist() {
  const raw = els.wlAddInput.value.trim().toUpperCase();
  if (!raw) return;
  if (!state.watchlist.includes(raw)) {
    state.watchlist.push(raw);
    await chrome.storage.local.set({ bb_watchlist: state.watchlist });
  }
  els.wlAddInput.value = "";
  renderWatchlistCount();
  renderWatchlistPanel();
  if (state.activeTab !== "watchlist") renderList(); // keep star icons in sync elsewhere
}

async function removeFromWatchlist(symbol) {
  state.watchlist = state.watchlist.filter((s) => s !== symbol);
  await chrome.storage.local.set({ bb_watchlist: state.watchlist });
  renderWatchlistCount();
  renderWatchlistPanel();
  if (state.activeTab !== "watchlist") renderList();
}

async function loadFromCache() {
  const res = await chrome.runtime.sendMessage({ type: "BB_GET_CACHE" });
  if (res?.ok && res.data) {
    state.data = res.data;
    renderAll();
  }
}

async function refresh() {
  els.refreshBtn.classList.add("spinning");
  els.statusLine.textContent = "Syncing with exchange & news feeds…";
  try {
    const res = await chrome.runtime.sendMessage({ type: "BB_REFRESH" });
    if (res?.ok) {
      state.data = res.data;
    }
  } finally {
    els.refreshBtn.classList.remove("spinning");
    renderAll();
  }
}

function init() {
  els.tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (btn) setActiveTab(btn.dataset.tab);
  });
  els.searchInput.addEventListener("input", (e) => {
    state.query = e.target.value.trim();
    renderList();
  });
  els.watchOnlyBtn.addEventListener("click", () => {
    state.watchOnly = !state.watchOnly;
    els.watchOnlyBtn.dataset.active = String(state.watchOnly);
    renderList();
  });
  els.refreshBtn.addEventListener("click", refresh);
  els.settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
  els.wlAddBtn.addEventListener("click", addToWatchlist);
  els.wlAddInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addToWatchlist();
  });

  chrome.storage.local.get(["bb_watchlist"]).then(({ bb_watchlist }) => {
    state.watchlist = bb_watchlist || [];
    renderWatchlistCount();
    renderList();
  });

  loadFromCache().then(refresh);

  loadTickers();
  setInterval(loadTickers, 20_000);
  setInterval(() => {
    if (state.activeTab === "watchlist") refreshWatchlistPrices();
  }, 20_000);
}

init();
