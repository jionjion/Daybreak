const item = "daybreak.tasks.item.";
const done = "daybreak.tasks.done.";
const edited = "daybreak.tasks.edit.";
const reminder = "daybreak.tasks.reminder.";
const alarm = "daybreak-next-task";
const badge = "daybreak.tasks.badge";
let queue = Promise.resolve();

async function refreshReminders() {
  const keys = chrome.storage.local.getKeys ? (await chrome.storage.local.getKeys()).filter(key => key.startsWith("daybreak.tasks.")) : null;
  const values = await chrome.storage.local.get(keys);
  let next = Infinity;
  let pending = 0;
  for (const [key, record] of Object.entries(values)) {
    if (!key.startsWith(item) || typeof record?.text !== "string") continue;
    const id = key.slice(item.length);
    if (values[done + id]) continue;
    pending++;
    const time = values[reminder + id];
    if (!Number.isFinite(time)) continue;
    if (time > Date.now()) { next = Math.min(next, time); continue; }
    const current = await chrome.storage.local.get([reminder + id, done + id, item + id]);
    if (!current[item + id] || current[done + id] || current[reminder + id] !== time) continue;
    if (await chrome.permissions.contains({permissions: ["notifications"]})) {
      try {
        await chrome.notifications.create("daybreak-task-" + id + "-" + time, {
          type: "basic", title: "待办提醒", message: values[edited + id] || record.text,
          iconUrl: chrome.runtime.getURL("assets/icon128.png"),
        });
      } catch {
        next = Math.min(next, Date.now() + 300000);
        continue;
      }
    }
    if ((await chrome.storage.local.get(reminder + id))[reminder + id] === time) await chrome.storage.local.remove(reminder + id);
  }
  await chrome.action.setBadgeText({text: values[badge] && pending ? String(Math.min(999, pending)) : ""});
  if (Number.isFinite(next)) await chrome.alarms.create(alarm, {when: next});
  else await chrome.alarms.clear(alarm);
}
function schedule() { queue = queue.then(refreshReminders).catch(error => console.error("待办提醒未能更新", error)); }
chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener(event => { if (event.name === alarm) schedule(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && Object.keys(changes).some(key => key.startsWith("daybreak.tasks."))) schedule();
});
