importScripts("shared.js");

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get("bb_settings");
  if (!stored.bb_settings) {
    await saveSettings({ feeds: DEFAULT_FEEDS, firms: DEFAULT_FIRMS });
  }
  await refreshAndBadge();
  chrome.alarms.create("bb_refresh", { periodInMinutes: 30 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "bb_refresh") refreshAndBadge();
});

async function refreshAndBadge() {
  try {
    const items = await refreshCache();
    const count = items.length;
    chrome.action.setBadgeText({ text: count > 0 ? String(Math.min(count, 99)) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#0f4c3a" });
  } catch (e) {
    console.warn("Bazaar Board refresh failed:", e);
  }
}
