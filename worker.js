chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html") });
});
// Clear the badge left behind by the removed task reminders.
chrome.runtime.onInstalled.addListener(() => chrome.action.setBadgeText({ text: "" }));
chrome.runtime.onStartup.addListener(() => chrome.action.setBadgeText({ text: "" }));