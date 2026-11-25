import { mountLibrary } from "./widgets/library.js";
import { mountBookmarks } from "./widgets/bookmarks.js";
import { mountWeather, mountHomeWeather } from "./widgets/weather.js";
import { mountSettings, applyWallpaper, applyWallpaperTint, rememberWallpaper } from "./widgets/settings.js";
import { applyTheme } from "./widgets/theme.js";
import { mountSearch } from "./widgets/search.js";
import { mountLayout, setupQuickStrip, setupSystemShortcuts } from "./widgets/home.js";
import { initializeWallpaperRotation, mountWallpapers, nextWallpaper } from "./widgets/wallpapers.js";

const byId = id => document.getElementById(id);
const drawings = {
  rotate: '<path d="M4 10a8 8 0 1 1 1.5 7M4 4v6h6"/>',
  left: '<path d="M20 12H5m6-6-6 6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  bookmark: '<path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5v16l-6-4-6 4z"/>',
  settings: '<path d="M4 7h6m5 0h5M4 17h3m5 0h8"/><circle cx="12.5" cy="7" r="2.5"/><circle cx="9.5" cy="17" r="2.5"/>',
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
let homeWeather;
function applyPreferences(updated) {
  preferences = updated;
  applyTheme(updated.accent);
  document.body.dataset.wallTheme = updated.theme;
  applyWallpaperTint(updated);
  for (const target of [byId("hero"),byId("wall-layer")]) applyWallpaper(target,updated);
  rememberWallpaper(updated);
  search.update(updated);
  for (const shortcut of byId("system-shortcuts").querySelectorAll("[data-module]")) {
    if (shortcut.dataset.module === "weather") shortcut.hidden = !updated.weather;
  }
  const weatherHost = document.querySelector("#settings-content .weather-settings-host");
  if (updated.weather && !weatherCleanup && weatherHost) weatherCleanup = mountWeather(weatherHost);
  if (!updated.weather && weatherCleanup) { weatherCleanup(); weatherCleanup = null; }
  if (updated.weather && !homeWeather) homeWeather = mountHomeWeather(byId("home-weather"));
  if (!updated.weather && homeWeather) { homeWeather.destroy(); homeWeather = null; }
  showTime();
}

const titles = { bookmarks:"浏览器书签" };
const settingsScroll = byId("settings-scroll");
let settingsOpener = null;
let cleanupDetail;
let settingsExtrasReady=false;
function navigate(shouldFocus = true) {
  const wallpaperSettings = location.hash === "#settings/wallpaper";
  const weatherSettings = location.hash === "#settings/weather";
  const name = wallpaperSettings || weatherSettings ? "settings" : location.hash.slice(1);
  const detail = Object.hasOwn(titles, name);
  const route = detail || name === "settings" ? name : "home";
  const wasOpen = document.body.dataset.settingsOpen === "true";
  const open = route === "settings";
  if (open && !wasOpen) {
    const active = document.activeElement;
    settingsOpener = active instanceof HTMLElement && active !== document.body ? active : null;
    settingsScroll.scrollTop = 0;
    byId("settings-view").dataset.scrolled = "false";
  }
  // Keep the home route under the drawer so the wallpaper, glass and layout
  // stay exactly as they are while settings slides over them.
  document.body.dataset.route = open ? "home" : route;
  document.body.dataset.settingsOpen = String(open);
  if (route === "home") homeWeather?.sync();
  byId("home-view").hidden = detail;
  byId("detail-view").hidden = !detail;
  byId("home-view").inert = open || detail;
  document.querySelector(".wall-actions").inert = open;
  if(open && !settingsExtrasReady){
    mountWallpapers(byId("wallpaper-collections"));
    settingsExtrasReady=true;
  }
  cleanupDetail?.();
  cleanupDetail = null;
  if (detail) {
    byId("detail-title").textContent = titles[name];
    const root = byId("detail-content");
    cleanupDetail=mountLibrary(root);
  }
  document.title = route === "home" ? "Daybreak 晨屿" : (titles[route] || "个人设置") + " · 晨屿";
  if (shouldFocus) {
    if (open) {
      byId("settings-close").focus({preventScroll:true});
    } else {
      window.scrollTo(0, 0);
      // Return focus to whatever opened the drawer, not the page root.
      const back = wasOpen && settingsOpener?.isConnected ? settingsOpener : byId("main");
      back.focus({preventScroll:true});
      if (wasOpen) settingsOpener = null;
    }
  }
  if (wallpaperSettings) sections.find(entry => entry.selector === wallpaperSection)?.button.click();
  if (weatherSettings) sections.find(entry => entry.selector === "#settings-content .settings-weather")?.button.click();
  if (open) scheduleSettingsIndex();
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
  // nextWallpaper resolves with {ok, message}; it never throws.
  const result=await nextWallpaper();
  if(!result?.ok)status.textContent=result?.message||"未能切换壁纸。";
  button.disabled=false;
});
const settingsIndex = byId("settings-index");
const wallpaperSection = "#settings-content .settings-themes";
let chosenSettingsSection;
const sections = [
  ["个人偏好", "#settings-content [name=name]"], ["界面配色", "#settings-content .settings-palette"],
  ["搜索", "#settings-content [name=engine]"],
  ["天气服务", "#settings-content .settings-weather"], ["首页壁纸", wallpaperSection],
  ["内置工具", "#settings-content .settings-tools"],
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
    // Move context without painting a focus box for pointer-driven jumps.
    target.focus({preventScroll:true, focusVisible:false});
    chosenSettingsSection = {button, y:settingsScroll.scrollTop};
    markSettingsSection(button);
  });
  settingsIndex.append(button);
  return {button, section, selector};
});
let markedSettingsSection;
function markSettingsSection(current) {
  for (const {button} of sections) {
    if (button === current) button.setAttribute("aria-current","location");
    else button.removeAttribute("aria-current");
  }
  if (current === markedSettingsSection) return;
  markedSettingsSection = current;
  // Keep the active pill visible in the horizontally scrolling index.
  const nav = settingsIndex.getBoundingClientRect();
  const rect = current.getBoundingClientRect();
  if (rect.left >= nav.left && rect.right <= nav.right - 8) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  settingsIndex.scrollTo({left:settingsIndex.scrollLeft + rect.left - nav.left - 12, behavior:reduce ? "auto" : "smooth"});
}
let settingsFrame = 0;
function scheduleSettingsIndex() {
  if (settingsFrame || document.body.dataset.settingsOpen !== "true") return;
  settingsFrame = requestAnimationFrame(() => {
    settingsFrame = 0;
    if (document.body.dataset.settingsOpen !== "true") return;
    const rects = sections.map(entry => [entry, entry.section()?.getBoundingClientRect()]).filter(([, rect]) => rect);
    if (!rects.length) return;
    const view = settingsScroll.getBoundingClientRect();
    const atEnd = settingsScroll.scrollTop + settingsScroll.clientHeight >= settingsScroll.scrollHeight - 2;
    // The index lives outside the scroller, so a section is "current" once its
    // top tucks under the scroll viewport's top edge.
    const threshold = view.top + 16;
    if (chosenSettingsSection) {
      const chosenRect = rects.find(([entry]) => entry.button === chosenSettingsSection.button)?.[1];
      // Bottom cards can never reach the top line; keep the click highlight while they stay on screen at page end.
      const keep = Math.abs(chosenSettingsSection.y - settingsScroll.scrollTop) < 2 || (atEnd && chosenRect && chosenRect.top < view.bottom && chosenRect.bottom > view.top);
      if (keep) { markSettingsSection(chosenSettingsSection.button); return; }
      chosenSettingsSection = null;
    }
    let current = rects.filter(([, rect]) => rect.top <= threshold).at(-1)?.[0];
    if (atEnd) {
      const upcoming = rects.find(([, rect]) => rect.top > threshold);
      if (upcoming && upcoming[1].top < view.top + settingsScroll.clientHeight * .5) current = upcoming[0];
    }
    current ||= rects[0][0];
    markSettingsSection(current.button);
  });
}
settingsScroll.addEventListener("scroll", () => {
  // Lift the fixed head/index once content scrolls under them.
  byId("settings-view").dataset.scrolled = String(settingsScroll.scrollTop > 4);
  scheduleSettingsIndex();
}, {passive:true});
window.addEventListener("resize", scheduleSettingsIndex);
// Content height changes (expanded details, mounted weather panel) move section
// tops without a scroll event; re-sync the index then too.
const settingsResize = new ResizeObserver(scheduleSettingsIndex);
settingsResize.observe(byId("settings-content"));
settingsResize.observe(byId("layout-options"));
settingsResize.observe(byId("more-preferences"));
function closeSettings() {
  if (document.body.dataset.settingsOpen === "true") location.hash = "#home";
}
byId("settings-close").addEventListener("click", closeSettings);
byId("settings-scrim").addEventListener("click", closeSettings);
document.addEventListener("keydown", event => {
  // Esc during IME composition cancels the input, not the drawer.
  if (event.key === "Escape" && !event.isComposing && !event.defaultPrevented && document.body.dataset.settingsOpen === "true") closeSettings();
});
// Modal drawer: keep Tab cycling inside while it is open.
byId("settings-view").addEventListener("keydown", event => {
  if (event.key !== "Tab" || document.body.dataset.settingsOpen !== "true") return;
  const items = [...byId("settings-view").querySelectorAll('a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])')]
    .filter(node => node.getClientRects().length);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
window.addEventListener("hashchange", () => navigate());
navigate(false);
