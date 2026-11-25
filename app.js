import { mountLibrary } from "./widgets/library.js";
import { mountBookmarks } from "./widgets/bookmarks.js";
import { mountWeather } from "./widgets/weather.js";
import { mountSettings, applyWallpaper } from "./widgets/settings.js";
import { applyTheme } from "./widgets/theme.js";
import { mountSearch } from "./widgets/search.js";
import { mountLayout, setupQuickStrip, setupSystemShortcuts } from "./widgets/home.js";
import { initializeWallpaperRotation, mountWallpapers, nextWallpaper } from "./widgets/wallpapers.js";

const byId = id => document.getElementById(id);
const drawings = {
  rotate: '<path d="M4 10a8 8 0 1 1 1.5 7M4 4v6h6"/>',
  left: '<path d="M20 12H5m6-6-6 6 6 6"/>',
  bookmark: '<path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5v16l-6-4-6 4z"/>',
  settings: '<path d="M4 7h6m5 0h5M4 17h3m5 0h8"/><circle cx="12.5" cy="7" r="2.5"/><circle cx="9.5" cy="17" r="2.5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.6"/><path d="m16 16 4.5 4.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.3" cy="9" r="1.4"/><path d="m7 20 8-9 6 6"/>',
  weather: '<path d="M13.5 16a4.3 4.3 0 1 0-5.8-5.1M12 2v2M4.8 5l1.5 1.4M19.3 5l-1.5 1.4M21 12h-2"/><path d="M6 20a3.5 3.5 0 1 1 .3-7 4.6 4.6 0 0 1 8.3 2A2.6 2.6 0 1 1 15 20z"/>'
};
function drawIcon(element, name) {
  element.setAttribute("aria-hidden", "true");
  element.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false">' + drawings[name] + '</svg>';
}
for (const icon of document.querySelectorAll("[data-icon]")) drawIcon(icon, icon.dataset.icon);

let preferences = { name: "", clock24: true, engine: "bing", theme: "lake", weather: true };
const localDate = new Intl.DateTimeFormat("zh-CN", {month:"long", day:"numeric", weekday:"long"});
const lunarDate = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {month:"long", day:"numeric"});
const lunarDays = ["初一","初二","初三","初四","初五","初六","初七","初八","初九","初十","十一","十二","十三","十四","十五","十六","十七","十八","十九","二十","廿一","廿二","廿三","廿四","廿五","廿六","廿七","廿八","廿九","三十"];
let lunarCache = { key: "", text: "" };
function lunarLabel(now) {
  const key = now.toDateString();
  if (lunarCache.key !== key) {
    const parts = lunarDate.formatToParts(now);
    const month = parts.find(part => part.type === "month")?.value || "";
    const day = Number(parts.find(part => part.type === "day")?.value);
    lunarCache = { key, text: month + (lunarDays[day - 1] || "") };
  }
  return lunarCache.text;
}
function showTime() {
  const now = new Date();
  const hour = now.getHours();
  const hours = preferences.clock24 ? hour : hour % 12 || 12;
  const clock = String(hours).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
  byId("time").textContent = clock;
  byId("time").dateTime = now.toISOString();
  byId("period").textContent = preferences.clock24 ? "" : hour < 12 ? "AM" : "PM";
  const date = localDate.formatToParts(now).map(part => part.type === "weekday" ? " · " + part.value : part.value).join("");
  byId("hero-date").textContent = (preferences.name ? preferences.name + " · " : "") + date + " · " + lunarLabel(now);
}
let weatherCleanup;
function applyPreferences(updated) {
  preferences = updated;
  applyTheme(updated.accent);
  document.body.dataset.wallTheme = updated.theme;
  for (const target of [byId("hero"),byId("wall-layer")]) applyWallpaper(target,updated);
  search.update(updated);
  for (const shortcut of byId("system-shortcuts").querySelectorAll("[data-module]")) {
    if (shortcut.dataset.module === "weather") shortcut.hidden = !updated.weather;
  }
  const weatherHost = document.querySelector("#settings-content .weather-settings-host");
  if (updated.weather && !weatherCleanup && weatherHost) weatherCleanup = mountWeather(weatherHost);
  if (!updated.weather && weatherCleanup) { weatherCleanup(); weatherCleanup = null; }
  showTime();
}

const titles = { bookmarks:"浏览器书签" };
let cleanupDetail;
let settingsExtrasReady=false;
function navigate(shouldFocus = true) {
  const wallpaperSettings = location.hash === "#settings/wallpaper";
  const weatherSettings = location.hash === "#settings/weather";
  const name = wallpaperSettings || weatherSettings ? "settings" : location.hash.slice(1);
  const detail = Object.hasOwn(titles, name);
  const route = detail || name === "settings" ? name : "home";
  document.body.dataset.route=route;
  byId("home-view").hidden = route !== "home";
  byId("detail-view").hidden = !detail;
  byId("settings-view").hidden = route !== "settings";
  if(route==="settings" && !settingsExtrasReady){
    mountWallpapers(byId("wallpaper-collections"));
    settingsExtrasReady=true;
  }
  cleanupDetail?.();
  cleanupDetail = null;
  if (detail) {
    byId("detail-title").textContent = titles[name];
    const root = byId("detail-content");
    cleanupDetail=mountLibrary(root,name);
  }
  document.title = route === "home" ? "Daybreak 晨屿" : (titles[route] || "个人设置") + " · 晨屿";
  if (shouldFocus) { window.scrollTo(0, 0); byId("main").focus({preventScroll:true}); }
  if (wallpaperSettings) sections.find(entry => entry.selector === wallpaperSection)?.button.click();
  if (weatherSettings) sections.find(entry => entry.selector === "#settings-content .settings-weather")?.button.click();
  if (route === "settings") scheduleSettingsIndex();
}

const input = byId("query");
const search = mountSearch({form:byId("search-form"),input});
setupSystemShortcuts(byId("system-shortcuts"),drawIcon);
const updateQuickStrip = setupQuickStrip(byId("quick-strip"));
mountLayout(byId("layout-options"),values=>{
  updateQuickStrip(values);
});
document.querySelector(".skip").addEventListener("click", event => { event.preventDefault(); byId("main").focus(); });
showTime();
setInterval(showTime, 10000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) showTime(); });
mountBookmarks(byId("bookmarks-compact"));
mountSettings(byId("settings-content"), applyPreferences);
initializeWallpaperRotation();
byId("wall-next").addEventListener("click",async()=>{
  const status=document.querySelector(".wall-message"),button=byId("wall-next");
  button.disabled=true;
  status.textContent="";
  try { await nextWallpaper(); }
  catch(e){status.textContent=e.message||"未能切换壁纸。";}
  finally{button.disabled=false;}
});
const settingsIndex = byId("settings-index");
const wallpaperSection = "#settings-content .settings-themes";
let chosenSettingsSection;
const sections = [
  ["个人偏好", "#settings-content [name=name]"], ["界面配色", "#settings-content .settings-palette"],
  ["搜索", "#settings-content [name=engine]"],
  ["天气服务", "#settings-content .settings-weather"], ["首页壁纸", wallpaperSection],
  ["首页布局", "#layout-options section"],
  ["链接打开方式", "#layout-options [name=linksNewTab]"], ["壁纸库", "#wallpaper-collections"]
].map(([name, selector]) => {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = name;
  const section = () => document.querySelector(selector)?.closest(".settings-card");
  button.addEventListener("click", () => {
    const target = section();
    if (!target) return;
    target.tabIndex = -1;
    target.scrollIntoView({block:"start"});
    target.focus({preventScroll:true});
    chosenSettingsSection = {button, y:window.scrollY};
    markSettingsSection(button);
  });
  settingsIndex.append(button);
  return {button, section, selector};
});
function markSettingsSection(current) {
  for (const {button} of sections) {
    if (button === current) button.setAttribute("aria-current","location");
    else button.removeAttribute("aria-current");
  }
}
let settingsFrame = 0;
function scheduleSettingsIndex() {
  if (settingsFrame || byId("settings-view").hidden) return;
  settingsFrame = requestAnimationFrame(() => {
    settingsFrame = 0;
    if (chosenSettingsSection && Math.abs(chosenSettingsSection.y - window.scrollY) < 1) {
      markSettingsSection(chosenSettingsSection.button);
      return;
    }
    chosenSettingsSection = null;
    const visible = sections.filter(entry => entry.section());
    const atEnd = window.scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
    // Keep the highlighted entry in sync with the sticky header, which covers the section tops.
    const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-height")) || 0;
    const threshold = header + 24;
    const current = atEnd ? visible.at(-1) : visible.filter(entry => entry.section().getBoundingClientRect().top <= threshold).at(-1) || visible[0];
    if (current) markSettingsSection(current.button);
  });
}
window.addEventListener("scroll", scheduleSettingsIndex, {passive:true});
window.addEventListener("resize", scheduleSettingsIndex);
window.addEventListener("hashchange", () => navigate());
navigate(false);
