let settings = { feeds: [], firms: [] };

function renderFeeds() {
  const el = document.getElementById("feedList");
  el.innerHTML = "";
  settings.feeds.forEach((feed, idx) => {
    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `<span>${feed.name} <span class="meta">${feed.url}</span></span>`;
    const btn = document.createElement("button");
    btn.textContent = "Remove";
    btn.onclick = () => { settings.feeds.splice(idx, 1); renderFeeds(); };
    row.appendChild(btn);
    el.appendChild(row);
  });
}

function renderFirms() {
  const el = document.getElementById("firmList");
  el.innerHTML = "";
  settings.firms.forEach((firm, idx) => {
    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `<span>${firm}</span>`;
    const btn = document.createElement("button");
    btn.textContent = "Remove";
    btn.onclick = () => { settings.firms.splice(idx, 1); renderFirms(); };
    row.appendChild(btn);
    el.appendChild(row);
  });
}

document.getElementById("addFeed").onclick = () => {
  const name = document.getElementById("feedName").value.trim();
  const url = document.getElementById("feedUrl").value.trim();
  if (!name || !url.startsWith("http")) return;
  settings.feeds.push({ name, url });
  document.getElementById("feedName").value = "";
  document.getElementById("feedUrl").value = "";
  renderFeeds();
};

document.getElementById("addFirm").onclick = () => {
  const name = document.getElementById("firmName").value.trim();
  if (!name) return;
  settings.firms.push(name);
  document.getElementById("firmName").value = "";
  renderFirms();
};

document.getElementById("saveBtn").onclick = async () => {
  await saveSettings(settings);
  const status = document.getElementById("saveStatus");
  status.textContent = "Saved ✓";
  setTimeout(() => (status.textContent = ""), 2000);
};

document.getElementById("resetBtn").onclick = async () => {
  settings = { feeds: [...DEFAULT_FEEDS], firms: [...DEFAULT_FIRMS] };
  renderFeeds();
  renderFirms();
};

(async () => {
  settings = await getSettings();
  renderFeeds();
  renderFirms();
})();
