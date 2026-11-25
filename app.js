import { mountTasks } from "./widgets/tasks.js";
import { mountNotes } from "./widgets/notes.js";
import { mountLibrary } from "./widgets/library.js";
import { mountFavorites } from "./widgets/favorites.js";
import { mountWeather } from "./widgets/weather.js";
import { mountSettings, applyWallpaper } from "./widgets/settings.js";
import { applyTheme } from "./widgets/theme.js";
import { mountSearch } from "./widgets/search.js";
import { mountLayout, setupQuickStrip, setupWidgetDrawer } from "./widgets/home.js";
import { mountDirectory } from "./widgets/directory.js";
import { initializeWallpaperRotation, mountWallpapers, nextWallpaper } from "./widgets/wallpapers.js";

const byId = id => document.getElementById(id);
const drawings = {
  rotate: '<path d="M4 10a8 8 0 1 1 1.5 7M4 4v6h6"/>',
  left: '<path d="M20 12H5m6-6-6 6 6 6"/>',
  home: '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>',
  star: '<path d="m12 3 2.8 5.8 6.5 1-4.7 4.5 1.1 6.4-5.7-3-5.7 3 1.1-6.4L3 9.8l6.2-1z"/>',
  bookmark: '<path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5v16l-6-4-6 4z"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.7 7M3 5.5V11h5.5M12 7v5l3.2 2"/>',
  settings: '<path d="M4 7h6m5 0h5M4 17h3m5 0h8"/><circle cx="12.5" cy="7" r="2.5"/><circle cx="9.5" cy="17" r="2.5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.6"/><path d="m16 16 4.5 4.5"/>',
  arrow: '<path d="M4 12h15m-6.4-6.4 6.4 6.4-6.4 6.4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.3" cy="9" r="1.4"/><path d="m7 20 8-9 6 6"/>',
  check: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m7.7 12 2.9 2.9 5.7-6.1"/>',
  note: '<path d="M6 3.5h12a1 1 0 0 1 1 1v11l-5 5H6a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1zM13.5 20v-5.5H19M8.5 8h7M8.5 11h5"/>',
  weather: '<path d="M13.5 16a4.3 4.3 0 1 0-5.8-5.1M12 2v2M4.8 5l1.5 1.4M19.3 5l-1.5 1.4M21 12h-2"/><path d="M6 20a3.5 3.5 0 1 1 .3-7 4.6 4.6 0 0 1 8.3 2A2.6 2.6 0 1 1 15 20z"/>'
};
function drawIcon(element, name) {
  element.setAttribute("aria-hidden", "true");
  element.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false">' + drawings[name] + '</svg>';
}
for (const icon of document.querySelectorAll("[data-icon]")) drawIcon(icon, icon.dataset.icon);

let preferences = { name: "", clock24: true, engine: "bing", theme: "lake", tasks: true, notes: true, weather: true };
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
    const key=shortcut.dataset.module;
    if (["tasks","notes","weather"].includes(key)) shortcut.hidden=!updated[key];
  }
  for (const name of ["tasks", "notes", "weather"]) byId(name + "-card").hidden = !updated[name];
  if (updated.weather && !weatherCleanup) weatherCleanup = mountWeather(byId("weather-content"));
  if (!updated.weather && weatherCleanup) { weatherCleanup(); weatherCleanup = null; }
  showTime();
}

const titles = { favorites:"网页收藏", bookmarks:"浏览器书签", history:"历史记录",directory:"添加网站" };
let cleanupDetail;
let settingsExtrasReady=false;
function navigate(shouldFocus = true) {
  if (byId("side-drawer")?.open) byId("side-drawer").close();
  const wallpaperSettings = location.hash === "#settings/wallpaper";
  const name = wallpaperSettings ? "settings" : location.hash.slice(1);
  const detail = Object.hasOwn(titles, name);
  const route = detail || name === "settings" ? name : "home";
  document.body.dataset.route=route;
  closeDrawer();
  byId("home-view").hidden = route !== "home";
  byId("detail-view").hidden = !detail;
  byId("settings-view").hidden = route !== "settings";
  if(route==="settings" && !settingsExtrasReady){
    mountWallpapers(byId("wallpaper-collections"));
    settingsExtrasReady=true;
  }
  markDock(route === "home" ? "home" : "");
  cleanupDetail?.();
  cleanupDetail = null;
  if (detail) {
    byId("detail-title").textContent = titles[name];
    const root = byId("detail-content");
    if (name === "favorites") cleanupDetail=mountFavorites(root);
    else if (name === "directory") cleanupDetail=mountDirectory(root);
    else cleanupDetail=mountLibrary(root,name);
  }
  document.title = route === "home" ? "Daybreak 晨屿" : (titles[route] || "个人设置") + " · 晨屿";
  if (shouldFocus) { window.scrollTo(0, 0); byId("main").focus({preventScroll:true}); }
  if (wallpaperSettings) sections.find(entry => entry.selector === wallpaperSection)?.button.click();
  if (route === "settings") scheduleSettingsIndex();
}

const input = byId("query");
const search = mountSearch({form:byId("search-form"),input});
const closeDrawer = setupWidgetDrawer(byId("widget-drawer"),byId("system-shortcuts"),drawIcon);
const updateQuickStrip = setupQuickStrip(byId("quick-strip"));
mountLayout(byId("layout-options"),values=>{
  closeDrawer();
  updateQuickStrip(values);
});
const dockButtons = [...document.querySelectorAll(".dock [data-panel]")];
const sideDrawer = byId("side-drawer");
const sideTitle = byId("side-drawer-title");
const sideContent = byId("side-drawer-content");
const sidePanels = {
  favorites: ["网页收藏", root => mountFavorites(root)],
  bookmarks: ["书签", root => mountLibrary(root, "bookmarks")],
  history: ["历史记录", root => mountLibrary(root, "history")],
  settings: ["个人设置", root => {
    const layoutOptions = byId("layout-options");
    const morePreferences = byId("more-preferences");
    if (!settingsExtrasReady) { mountWallpapers(byId("wallpaper-collections")); settingsExtrasReady = true; }
    const mounting = mountSettings(root, applyPreferences);
    root.append(layoutOptions, morePreferences);
    return () => {
      mounting.then(cleanup => cleanup?.());
      byId("settings-content").after(layoutOptions);
      layoutOptions.after(morePreferences);
    };
  }],
};
let sideCleanup = null;
let sideToken = 0;
function markDock(name) {
  for (const item of dockButtons) {
    if (name && item.dataset.panel === name) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  }
}
async function openPanel(name) {
  if (name === "home") {
    if (sideDrawer.open) sideDrawer.close();
    if (location.hash && location.hash !== "#home") location.hash = "#home";
    else window.scrollTo({top:0});
    return;
  }
  const panel = sidePanels[name];
  if (!panel) return;
  const token = ++sideToken;
  sideCleanup?.();
  sideCleanup = null;
  sideContent.replaceChildren();
  sideTitle.textContent = panel[0];
  markDock(name);
  if (!sideDrawer.open) sideDrawer.showModal();
  const cleanup = await panel[1](sideContent);
  if (token !== sideToken) { cleanup?.(); return; }
  sideCleanup = cleanup || null;
}
for (const item of dockButtons) item.addEventListener("click", () => openPanel(item.dataset.panel));
sideDrawer.addEventListener("close", () => {
  sideToken++;
  const cleanup = sideCleanup;
  sideCleanup = null;
  cleanup?.();
  sideContent.replaceChildren();
  markDock("");
});
sideDrawer.querySelector(".drawer-close").addEventListener("click", () => sideDrawer.close());
sideDrawer.addEventListener("click", event => {
  if (event.target !== sideDrawer) return;
  const rect = sideDrawer.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientY < rect.top || event.clientY > rect.bottom) sideDrawer.close();
});
const drawerGrip = sideDrawer.querySelector(".drawer-grip");
const drawerWidthKey = "daybreak.ui.drawerWidth";
function clampDrawerWidth(value) {
  const max = Math.max(360, Math.round(window.innerWidth * 0.96));
  return Math.round(Math.max(360, Math.min(max, Number.isFinite(value) ? value : 720)));
}
function applyDrawerWidth(value, persist) {
  const width = clampDrawerWidth(value);
  document.documentElement.style.setProperty("--drawer-width", width + "px");
  drawerGrip.setAttribute("aria-valuenow", String(width));
  drawerGrip.setAttribute("aria-valuemax", String(Math.round(window.innerWidth * 0.96)));
  if (persist) { try { localStorage.setItem(drawerWidthKey, String(width)); } catch {} }
}
drawerGrip.setAttribute("aria-valuemin", "360");
try {
  const savedWidth = parseFloat(localStorage.getItem(drawerWidthKey));
  if (Number.isFinite(savedWidth)) applyDrawerWidth(savedWidth, false);
} catch {}
let gripPointer = null;
drawerGrip.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  gripPointer = event.pointerId;
  document.body.classList.add("drawer-dragging");
  try { drawerGrip.setPointerCapture(event.pointerId); } catch {}
  event.preventDefault();
});
drawerGrip.addEventListener("pointermove", event => {
  if (gripPointer !== event.pointerId) return;
  applyDrawerWidth(window.innerWidth - event.clientX, false);
});
function endGripDrag(event) {
  if (gripPointer !== event.pointerId) return;
  gripPointer = null;
  document.body.classList.remove("drawer-dragging");
  try { drawerGrip.releasePointerCapture(event.pointerId); } catch {}
  applyDrawerWidth(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--drawer-width")), true);
}
drawerGrip.addEventListener("pointerup", endGripDrag);
drawerGrip.addEventListener("pointercancel", endGripDrag);
drawerGrip.addEventListener("dblclick", () => applyDrawerWidth(720, true));
drawerGrip.addEventListener("keydown", event => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--drawer-width"));
  applyDrawerWidth(current + (event.key === "ArrowLeft" ? 32 : -32), true);
});
document.addEventListener("keydown", event => {
  if (event.key !== "/" || event.altKey || event.ctrlKey || event.metaKey || byId("home-view").hidden) return;
  if (document.body.dataset.showSearch==="false" || document.querySelector("dialog[open]") || event.target.closest("input,textarea,select,[contenteditable=true]")) return;
  event.preventDefault();
  input.focus();
});
document.querySelector(".skip").addEventListener("click", event => { event.preventDefault(); byId("main").focus(); });
showTime();
setInterval(showTime, 10000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) showTime(); });
mountTasks(byId("tasks-content"));
mountNotes(byId("notes-content"));
mountFavorites(byId("favorites-compact"), {compact:true});
mountSettings(byId("settings-content"), applyPreferences);
initializeWallpaperRotation();
byId("wall-next").addEventListener("click",async()=>{
  const status=document.querySelector(".wall-message"),button=byId("wall-next");
  button.disabled=true;
  try { const result=await nextWallpaper();status.textContent=result?.message||"壁纸已切换。"; }
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
  ["首页小工具", "#settings-content [name=tasks]"], ["首页布局", "#layout-options section"],
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
