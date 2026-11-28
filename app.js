import { BOOT_KEYS, readBoot, writeBoot } from "./shared/boot.js";
import { syncScrollEdges } from "./shared/dom.js";
import { mountLibrary } from "./widgets/library.js";
import { mountBookmarks } from "./widgets/bookmarks.js";
import { mountWeather, mountHomeWeather } from "./widgets/weather.js";
import { mountSettings, applyWallpaper, applyWallpaperTint, rememberWallpaper } from "./widgets/settings.js";
import { applyTheme } from "./widgets/theme.js";
import { hasCategoriesFor, mountSearch } from "./widgets/search.js";
import { mountLayout, setupQuickStrip, setupSystemShortcuts } from "./widgets/home.js";
import { initializeWallpaperRotation, mountWallpapers, nextWallpaper } from "./widgets/wallpapers.js";

const byId = id => document.getElementById(id);
const drawings = {
  rotate: '<path d="M4 10a8 8 0 1 1 1.5 7M4 4v6h6"/>',
  left: '<path d="M20 12H5m6-6-6 6 6 6"/>',
  bookmark: '<path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5v16l-6-4-6 4z"/>',
  settings: '<path d="M4 7h6m5 0h5M4 17h3m5 0h8"/><circle cx="12.5" cy="7" r="2.5"/><circle cx="9.5" cy="17" r="2.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.3" cy="9" r="1.4"/><path d="m7 20 8-9 6 6"/>',
  weather: '<path d="M13.5 16a4.3 4.3 0 1 0-5.8-5.1M12 2v2M4.8 5l1.5 1.4M19.3 5l-1.5 1.4M21 12h-2"/><path d="M6 20a3.5 3.5 0 1 1 .3-7 4.6 4.6 0 0 1 8.3 2A2.6 2.6 0 1 1 15 20z"/>',
};

function drawIcon(element, name) {
  element.setAttribute("aria-hidden", "true");
  element.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false">' + drawings[name] + "</svg>";
}
for (const icon of document.querySelectorAll("[data-icon]")) drawIcon(icon, icon.dataset.icon);

const bootUi = readBoot(BOOT_KEYS.ui);
const bootWeather = readBoot(BOOT_KEYS.weather);
let preferences = {
  name: typeof bootUi?.name === "string" ? bootUi.name : "",
  clock24: typeof bootUi?.clock24 === "boolean" ? bootUi.clock24 : true,
  engine: typeof bootUi?.engine === "string" ? bootUi.engine : "bing",
  theme: "lake",
  weather: typeof bootUi?.weather === "boolean" ? bootUi.weather : true,
};
const localDate = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" });
const lunarDate = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { month: "long", day: "numeric" });
const lunarDays = [
  "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
  "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十",
];
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

let clockAnimation = null;
function showTime(animate = false) {
  const now = new Date();
  const hour = now.getHours();
  const hours = preferences.clock24 ? hour : hour % 12 || 12;
  const clock = String(hours).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
  const node = byId("time");
  const stamp = now.toISOString();
  // Coming back to a backgrounded tab can skip past the displayed minute: roll
  // the old reading out and the new one in instead of snapping the digits.
  const swap = animate && node.textContent !== clock
    && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  clockAnimation?.cancel();
  clockAnimation = null;
  if (swap) {
    const out = node.animate(
      [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-0.12em)" }],
      { duration: 150, easing: "ease-in", fill: "both" }
    );
    clockAnimation = out;
    out.finished.then(() => {
      if (clockAnimation !== out) return;
      out.cancel(); // drop the fill so it can't pin the faded-out frame
      node.textContent = clock;
      node.dateTime = stamp;
      const enter = node.animate(
        [{ opacity: 0, transform: "translateY(0.12em)" }, { opacity: 1, transform: "translateY(0)" }],
        { duration: 200, easing: "ease-out", fill: "both" }
      );
      clockAnimation = enter;
      return enter.finished.then(() => {
        if (clockAnimation !== enter) return;
        enter.cancel();
        clockAnimation = null;
      });
    }).catch(() => { /* a newer reading replaced this swap */ });
  } else {
    node.textContent = clock;
    node.dateTime = stamp;
  }
  byId("period").textContent = preferences.clock24 ? "" : hour < 12 ? "AM" : "PM";
  const date = localDate.formatToParts(now).map(part => (part.type === "weekday" ? " · " + part.value : part.value)).join("");
  byId("hero-date").textContent = (preferences.name ? preferences.name + " · " : "") + date + " · " + lunarLabel(now);
}

let clockTimer = 0;
function scheduleClock() {
  clearTimeout(clockTimer);
  const delay = 60000 - (Date.now() % 60000) + 50;
  clockTimer = setTimeout(() => {
    showTime();
    scheduleClock();
  }, delay);
}

let weatherCleanup;
let homeWeather;
let settingsOpened = false;

function syncSettingsWeather() {
  const weatherHost = document.querySelector("#settings-content .weather-settings-host");
  if (settingsOpened && preferences.weather && !weatherCleanup && weatherHost) {
    weatherCleanup = mountWeather(weatherHost);
  }
  if (!preferences.weather && weatherCleanup) {
    weatherCleanup();
    weatherCleanup = null;
  }
}

function applyPreferences(updated) {
  preferences = updated;
  applyTheme(updated.accent);
  document.body.dataset.wallTheme = updated.theme;
  applyWallpaperTint(updated);
  byId("hero").dataset.theme = updated.theme || "lake";
  applyWallpaper(byId("wall-layer"), updated);
  rememberWallpaper(updated);
  search.update(updated);
  for (const shortcut of byId("system-shortcuts").querySelectorAll("[data-module]")) {
    if (shortcut.dataset.module === "weather") shortcut.hidden = !updated.weather;
  }
  syncSettingsWeather();
  if (updated.weather && !homeWeather) homeWeather = mountHomeWeather(byId("home-weather"));
  if (!updated.weather && homeWeather) {
    homeWeather.destroy();
    homeWeather = null;
  }
  if (!updated.weather) {
    writeBoot(BOOT_KEYS.weather, { visible: false, text: "", title: "" });
    delete document.body.dataset.bootWeather;
  }
  const showCategories = hasCategoriesFor(updated);
  document.body.dataset.bootCategories = String(showCategories);
  const accentContrast = document.documentElement.style.getPropertyValue("--accent-contrast") || "#ffffff";
  const weatherSnap = updated.weather ? readBoot(BOOT_KEYS.weather) : null;
  writeBoot(BOOT_KEYS.ui, {
    accent: updated.accent,
    accentContrast,
    name: updated.name,
    clock24: updated.clock24,
    engine: updated.engine,
    customEngines: updated.customEngines,
    hideCategories: updated.hideCategories,
    showCategories,
    weather: updated.weather,
    weatherVisible: Boolean(updated.weather && weatherSnap?.visible),
  });
  showTime();
}

const titles = { bookmarks: "浏览器书签" };
const settingsScroll = byId("settings-scroll");
let settingsOpener = null;
let cleanupDetail;

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
  if (open && !settingsOpened) {
    settingsOpened = true;
    mountWallpapers(byId("wallpaper-collections"));
  }
  if (open) syncSettingsWeather();

  cleanupDetail?.();
  cleanupDetail = null;
  if (detail) {
    byId("detail-title").textContent = titles[name];
    cleanupDetail = mountLibrary(byId("detail-content"));
  }
  document.title = route === "home" ? "晨屿" : (titles[route] || "个人设置") + " · 晨屿";
  if (shouldFocus) {
    if (open) {
      byId("settings-view").focus({ preventScroll: true });
    } else {
      window.scrollTo(0, 0);
      // Return focus to whatever opened the drawer, not the page root.
      const back = wasOpen && settingsOpener?.isConnected ? settingsOpener : byId("main");
      back.focus({ preventScroll: true });
      if (wasOpen) settingsOpener = null;
    }
  }
  if (wallpaperSettings) sections.find(entry => entry.selector === wallpaperSection)?.button.click();
  if (weatherSettings) sections.find(entry => entry.selector === "#settings-content .settings-weather")?.button.click();
  if (open) scheduleSettingsIndex();
}

const input = byId("query");
const search = mountSearch({
  form: byId("search-form"),
  input,
  initialPrefs: bootUi ? {
    engine: bootUi.engine,
    customEngines: bootUi.customEngines,
    hideCategories: bootUi.hideCategories,
  } : undefined,
});
setupSystemShortcuts(byId("system-shortcuts"), drawIcon);
for (const shortcut of byId("system-shortcuts").querySelectorAll("[data-module]")) {
  if (shortcut.dataset.module === "weather") shortcut.hidden = !preferences.weather;
}
const homeWeatherLink = byId("home-weather");
if (preferences.weather && bootWeather?.visible && bootWeather.text) {
  homeWeatherLink.textContent = bootWeather.text;
  homeWeatherLink.title = bootWeather.title || "";
  homeWeatherLink.hidden = false;
} else {
  homeWeatherLink.hidden = true;
  delete document.body.dataset.bootWeather;
}
const updateQuickStrip = setupQuickStrip(byId("quick-strip"));
mountLayout(byId("layout-options"), values => {
  updateQuickStrip(values);
});
document.querySelector(".skip").addEventListener("click", event => {
  event.preventDefault();
  byId("main").focus();
});

showTime();
scheduleClock();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    showTime(true);
    scheduleClock();
  }
});
window.addEventListener("pageshow", event => {
  if (event.persisted) {
    showTime(true);
    scheduleClock();
  }
});

mountBookmarks(byId("bookmarks-compact"));
mountSettings(byId("settings-content"), applyPreferences);
initializeWallpaperRotation();

byId("wall-next").addEventListener("click", async () => {
  const status = document.querySelector(".wall-message");
  const button = byId("wall-next");
  button.disabled = true;
  status.textContent = "";
  // nextWallpaper resolves with {ok, message}; it never throws.
  const result = await nextWallpaper();
  if (!result?.ok) status.textContent = result?.message || "未能切换壁纸。";
  button.disabled = false;
});

const settingsIndex = byId("settings-index");
const wallpaperSection = "#settings-content .settings-themes";
let chosenSettingsSection;
const sections = [
  ["个人偏好", "#settings-content [name=name]"],
  ["界面配色", "#settings-content .settings-palette"],
  ["搜索", "#settings-content [name=engine]"],
  ["天气服务", "#settings-content .settings-weather"],
  ["首页壁纸", wallpaperSection],
  ["内置工具", "#settings-content .settings-tools"],
  ["首页布局", "#layout-options section"],
  ["链接打开方式", "#layout-options [name=linksNewTab]"],
  ["壁纸库", "#wallpaper-collections"],
].map(([name, selector]) => {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = name;
  const section = () => document.querySelector(selector)?.closest(".settings-card");
  button.addEventListener("click", () => {
    const target = section();
    if (!target) return;
    target.tabIndex = -1;
    target.scrollIntoView({ block: "start" });
    // Move context without painting a focus box for pointer-driven jumps.
    target.focus({ preventScroll: true, focusVisible: false });
    chosenSettingsSection = { button, y: settingsScroll.scrollTop };
    markSettingsSection(button);
  });
  settingsIndex.append(button);
  return { button, section, selector };
});

let markedSettingsSection;
function markSettingsSection(current) {
  for (const { button } of sections) {
    if (button === current) button.setAttribute("aria-current", "location");
    else button.removeAttribute("aria-current");
  }
  if (current === markedSettingsSection) return;
  markedSettingsSection = current;
  // Keep the active pill visible in the horizontally scrolling index.
  const nav = settingsIndex.getBoundingClientRect();
  const rect = current.getBoundingClientRect();
  if (rect.left >= nav.left && rect.right <= nav.right - 8) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  settingsIndex.scrollTo({
    left: settingsIndex.scrollLeft + rect.left - nav.left - 12,
    behavior: reduce ? "auto" : "smooth",
  });
}

settingsIndex.addEventListener("scroll", () => syncScrollEdges(settingsIndex), { passive: true });

let settingsFrame = 0;
function scheduleSettingsIndex() {
  if (settingsFrame || document.body.dataset.settingsOpen !== "true") return;
  settingsFrame = requestAnimationFrame(() => {
    settingsFrame = 0;
    if (document.body.dataset.settingsOpen !== "true") return;
    syncScrollEdges(settingsIndex);
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
      const keep = Math.abs(chosenSettingsSection.y - settingsScroll.scrollTop) < 2
        || (atEnd && chosenRect && chosenRect.top < view.bottom && chosenRect.bottom > view.top);
      if (keep) {
        markSettingsSection(chosenSettingsSection.button);
        return;
      }
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
}, { passive: true });
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

byId("settings-scrim").addEventListener("click", closeSettings);
document.addEventListener("keydown", event => {
  // Esc during IME composition or inside an open dialog must not close the drawer.
  if (
    event.key === "Escape"
    && !event.isComposing
    && !event.defaultPrevented
    && !document.querySelector("dialog[open]")
    && document.body.dataset.settingsOpen === "true"
  ) {
    closeSettings();
  }
});

// Modal drawer: keep Tab cycling inside while it is open.
const drawer = byId("settings-view");
drawer.addEventListener("keydown", event => {
  if (event.key !== "Tab" || document.body.dataset.settingsOpen !== "true") return;
  const items = [...drawer.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])')]
    .filter(node => node.getClientRects().length);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === drawer)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

window.addEventListener("hashchange", () => navigate());
navigate(false);
