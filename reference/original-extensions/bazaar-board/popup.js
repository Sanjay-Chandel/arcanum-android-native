const listEl = document.getElementById("list");
const emptyState = document.getElementById("emptyState");
const statusText = document.getElementById("statusText");
const chipRow = document.getElementById("chipRow");
const refreshBtn = document.getElementById("refreshBtn");
const optionsLink = document.getElementById("optionsLink");

let allItems = [];
let activeFirm = null;

function timeAgo(iso) {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function render() {
  const firms = new Set();
  allItems.forEach((i) => i.firms.forEach((f) => firms.add(f)));

  chipRow.innerHTML = "";
  const allChip = document.createElement("span");
  allChip.className = "chip" + (activeFirm === null ? " active" : "");
  allChip.textContent = "All";
  allChip.onclick = () => { activeFirm = null; render(); };
  chipRow.appendChild(allChip);

  Array.from(firms).sort().forEach((firm) => {
    const chip = document.createElement("span");
    chip.className = "chip" + (activeFirm === firm ? " active" : "");
    chip.textContent = firm;
    chip.onclick = () => { activeFirm = activeFirm === firm ? null : firm; render(); };
    chipRow.appendChild(chip);
  });

  const filtered = activeFirm ? allItems.filter((i) => i.firms.includes(activeFirm)) : allItems;

  listEl.querySelectorAll(".card").forEach((c) => c.remove());
  if (filtered.length === 0) {
    emptyState.hidden = false;
  } else {
    emptyState.hidden = true;
    filtered.slice(0, 60).forEach((item) => {
      const card = document.createElement("div");
      card.className = "card";
      card.onclick = () => item.link && chrome.tabs.create({ url: item.link });

      const top = document.createElement("div");
      top.className = "card-top";
      item.firms.forEach((f) => {
        const tag = document.createElement("span");
        tag.className = "firm-tag";
        tag.textContent = f;
        top.appendChild(tag);
      });

      const title = document.createElement("p");
      title.className = "card-title";
      title.textContent = item.title;

      const meta = document.createElement("div");
      meta.className = "card-meta";
      meta.innerHTML = `<span>${item.source}</span><span>${timeAgo(item.pubDate)}</span>`;

      card.appendChild(top);
      card.appendChild(title);
      card.appendChild(meta);
      listEl.appendChild(card);
    });
  }
}

async function load(forceRefresh) {
  refreshBtn.classList.add("spinning");
  statusText.textContent = "Loading…";
  try {
    if (forceRefresh) {
      allItems = await refreshCache();
    } else {
      const cached = await getCached();
      if (cached.items.length > 0) {
        allItems = cached.items;
      } else {
        allItems = await refreshCache();
      }
    }
    const cached = await getCached();
    statusText.textContent = cached.time
      ? `Updated ${timeAgo(new Date(cached.time).toISOString())} · ${allItems.length} mentions`
      : `${allItems.length} mentions`;
  } catch (e) {
    statusText.textContent = "Couldn't load feeds — check your connection.";
    console.error(e);
  } finally {
    refreshBtn.classList.remove("spinning");
    render();
  }
}

refreshBtn.addEventListener("click", () => load(true));
optionsLink.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

load(false);
