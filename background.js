chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html") });
});
// Clear the badge left behind by the removed task reminders.
chrome.runtime.onInstalled.addListener(async () => {
  chrome.action.setBadgeText({ text: "" });
  await purgeLegacyKeys();
});
chrome.runtime.onStartup.addListener(() => chrome.action.setBadgeText({ text: "" }));

/* 1.1.x stored workbench data (tasks, notes, favorites, QWeather host) and
   layout keys that 1.2.0 no longer reads; sweep them once per update. */
const legacyPrefixes = ["daybreak.tasks.", "daybreak.note.", "daybreak.favorite."];
const legacyKeys = [
  "daybreak.favoriteFolders",
  "daybreak.pref.tasks", "daybreak.pref.notes",
  "daybreak.weather.apiHost",
  "daybreak.layout.columns", "daybreak.layout.rows",
  "daybreak.layout.sideScale", "daybreak.layout.historyNewTab",
];
async function purgeLegacyKeys() {
  try {
    const keys = chrome.storage.local.getKeys
      ? await chrome.storage.local.getKeys()
      : Object.keys(await chrome.storage.local.get(null));
    const stale = keys.filter(key => legacyKeys.includes(key) || legacyPrefixes.some(prefix => key.startsWith(prefix)));
    if (stale.length) await chrome.storage.local.remove(stale);
  } catch { /* Orphan keys are inert; a failed sweep retries on the next update. */ }
}
