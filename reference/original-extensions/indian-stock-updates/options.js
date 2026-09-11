const els = {
  addForm: document.getElementById("addForm"),
  addInput: document.getElementById("addInput"),
  watchList: document.getElementById("watchList"),
  notifyToggle: document.getElementById("notifyToggle")
};

let watchlist = [];

function renderList() {
  els.watchList.innerHTML = "";
  if (watchlist.length === 0) {
    els.watchList.innerHTML = `<li class="empty">No symbols yet — add one above.</li>`;
    return;
  }
  for (const symbol of watchlist) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${symbol}</span>`;
    const btn = document.createElement("button");
    btn.textContent = "✕";
    btn.addEventListener("click", () => removeSymbol(symbol));
    li.appendChild(btn);
    els.watchList.appendChild(li);
  }
}

async function saveWatchlist() {
  await chrome.storage.local.set({ bb_watchlist: watchlist });
}

function removeSymbol(symbol) {
  watchlist = watchlist.filter((s) => s !== symbol);
  saveWatchlist();
  renderList();
}

els.addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const raw = els.addInput.value.trim().toUpperCase();
  if (!raw) return;
  raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((symbol) => {
      if (!watchlist.includes(symbol)) watchlist.push(symbol);
    });
  els.addInput.value = "";
  saveWatchlist();
  renderList();
});

els.notifyToggle.addEventListener("change", () => {
  chrome.storage.local.set({ bb_notify: els.notifyToggle.checked });
});

async function init() {
  const { bb_watchlist, bb_notify } = await chrome.storage.local.get(["bb_watchlist", "bb_notify"]);
  watchlist = bb_watchlist || [];
  els.notifyToggle.checked = bb_notify !== false;
  renderList();
}

init();
