import { BOOT_KEYS, readBoot, writeBoot } from "../shared/boot.js";
import { el, syncScrollEdges, webAddress } from "../shared/dom.js";
import { getValue, onStorageChange, setValues } from "../shared/storage.js";

// Opens in a new tab by default unless "在新标签页打开首页书签" is turned off.
const linkKey = "daybreak.layout.linksNewTab";
const events = ["onCreated", "onRemoved", "onChanged", "onMoved", "onChildrenReordered", "onImportEnded"];
let defaultFavicon;

function rootsOf(tree) {
  const children = tree?.[0]?.children || [];
  const bar = children.find(node => node.folderType === "bookmarks-bar" || node.id === "1");
  const other = children.find(node => node.folderType === "other" || node.id === "2");
  return [bar, other].filter(Boolean);
}

function rootTitle(node) {
  if (node.folderType === "bookmarks-bar") return "书签栏";
  if (node.folderType === "other") return "其他书签";
  return (node.title || "").trim() || "书签";
}

function entriesOf(children) {
  const entries = [];
  for (const node of children || []) {
    if (typeof node.url === "string") {
      const url = webAddress(node.url);
      if (!url) continue;
      entries.push({ type: "bookmark", id: node.id, title: (node.title || "").trim() || url.hostname, url: node.url });
    } else {
      entries.push({ type: "folder", id: node.id, title: (node.title || "").trim() || "未命名文件夹", node });
    }
  }
  return entries;
}

export function buildSheets(tree) {
  const roots = rootsOf(tree);
  const sheets = [];
  for (const node of roots) {
    if (entriesOf(node.children).some(entry => entry.type === "bookmark")) {
      const title = rootTitle(node);
      sheets.push({ id: node.id, title, path: title, node });
    }
  }
  const addFolders = (node, parents) => {
    for (const child of node.children || []) {
      if (typeof child.url === "string") continue;
      const title = (child.title || "").trim() || "未命名文件夹";
      const path = [...parents, title].join(" / ");
      sheets.push({ id: child.id, title, path, node: child });
      addFolders(child, [...parents, title]);
    }
  };
  for (const node of roots) addFolders(node, [rootTitle(node)]);
  return sheets;
}

function faviconUrl(pageUrl) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", "64");
  return url.href;
}

async function faviconImage(pageUrl) {
  const image = el("img", "bookmarks-browser-icon");
  image.alt = "";
  image.src = faviconUrl(pageUrl);
  await image.decode();
  return image;
}

function pixels(image) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  canvas.getContext("2d").drawImage(image, 0, 0, 64, 64);
  return canvas.toDataURL();
}

/* Favicon cache: data URLs in storage so refreshes render icons locally
   instead of re-decoding from the _favicon service every time. */
const FAV_KEY = "daybreak.favicons";
const FAV_TTL = 7 * 24 * 3600 * 1000;
const FAV_MAX = 300;
let favCachePromise = null;
const favInflight = new Map();

function favCache() {
  favCachePromise ??= getValue(FAV_KEY)
    .then(raw => (raw && typeof raw === "object" ? raw : {}))
    .catch(() => ({}));
  return favCachePromise;
}

let favWriteTimer = 0;
function saveFav(url, entry) {
  favCache().then(cache => {
    cache[url] = entry;
    if (favWriteTimer) return;
    favWriteTimer = setTimeout(async () => {
      favWriteTimer = 0;
      const current = await favCache();
      const now = Date.now();
      for (const [key, value] of Object.entries(current)) {
        if (now - (value?.t || 0) >= FAV_TTL) delete current[key];
      }
      const keys = Object.keys(current);
      if (keys.length > FAV_MAX) {
        keys.sort((a, b) => (current[a]?.t || 0) - (current[b]?.t || 0));
        for (const staleKey of keys.slice(0, keys.length - FAV_MAX)) {
          delete current[staleKey];
        }
      }
      try {
        await setValues({ [FAV_KEY]: current });
      } catch { /* quota: keep in-memory cache */ }
    }, 800);
  });
}

function darkIcon(image) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, 16, 16);
  const data = context.getImageData(0, 0, 16, 16).data;
  let lum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a < .5) continue;
    lum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255 * a;
    n += a;
  }
  return n > 0 && lum / n < .32;
}

function resolveFavicon(pageUrl) {
  let task = favInflight.get(pageUrl);
  if (task) return task;
  task = (async () => {
    const hit = (await favCache())[pageUrl];
    if (hit && Date.now() - (hit.t || 0) < FAV_TTL) return hit;
    if (!globalThis.chrome?.runtime?.getURL) return null;
    try {
      // Chromium may return its built-in globe (HTTP 200) when the site has no icon.
      defaultFavicon ??= faviconImage("https://daybreak-missing-favicon.invalid/").then(pixels).catch(() => null);
      const [image, empty] = await Promise.all([faviconImage(pageUrl), defaultFavicon]);
      const data = pixels(image);
      if (!empty || data !== empty) {
        const tone = darkIcon(image) ? "chip" : "";
        const entry = { data, t: Date.now(), tone };
        saveFav(pageUrl, entry);
        return entry;
      }
      const missing = { data: "", t: Date.now(), tone: "" };
      saveFav(pageUrl, missing);
      return missing;
    } catch {
      return null;
    }
  })().finally(() => {
    favInflight.delete(pageUrl);
  });
  favInflight.set(pageUrl, task);
  return task;
}

async function loadFavicon(mark, pageUrl, isAlive) {
  const entry = await resolveFavicon(pageUrl);
  if (!isAlive() || !mark.isConnected || !entry?.data) return;
  const image = el("img", "bookmarks-browser-icon");
  image.alt = "";
  image.src = entry.data;
  try {
    await image.decode();
  } catch {
    return;
  }
  if (!isAlive() || !mark.isConnected) return;
  mark.replaceChildren(image);
  if (entry.tone) mark.dataset.tone = entry.tone;
}

export function mountBookmarks(root) {
  const api = globalThis.chrome?.bookmarks;
  const panelId = "bookmarks-sheet-" + Math.random().toString(36).slice(2, 8);
  const box = el("div", "bookmarks-compact");
  const tabs = el("div", "bookmarks-sheets");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "书签文件夹");
  const list = el("div", "bookmarks-list");
  list.id = panelId;
  list.setAttribute("role", "tabpanel");
  const status = el("p", "bookmarks-empty");
  status.setAttribute("role", "status");
  status.hidden = true;
  // The hint lives inside the list so an empty sheet keeps the band height.
  box.append(tabs, list);
  root.replaceChildren(box);

  let tree = null;
  let activeId = null;
  let linkNewTab = true;
  let failure = false;
  let alive = true;
  let generation = 0;
  let timer;
  const bookmarksEvents = [];

  function directBookmarks(node) {
    return entriesOf(node.children).filter(entry => entry.type === "bookmark");
  }

  function hasFolders(node) {
    return entriesOf(node.children).some(entry => entry.type === "folder");
  }

  function bookmarkMark(bookmark) {
    const mark = el("span", "bookmarks-monogram");
    mark.setAttribute("aria-hidden", "true");
    const host = webAddress(bookmark.url)?.hostname || "";
    mark.dataset.color = String([...host].reduce((sum, character) => (sum * 31 + character.codePointAt(0)) % 6, 0));
    mark.textContent = Array.from(bookmark.title.trim() || host || "?")[0].toLocaleUpperCase();
    loadFavicon(mark, bookmark.url, () => alive);
    return mark;
  }

  function bookmarkTile(entry) {
    const tile = el("div", "bookmarks-tile");
    const anchor = el("a", "bookmarks-link");
    anchor.href = entry.url;
    anchor.target = linkNewTab ? "_blank" : "_self";
    anchor.rel = "noopener noreferrer";
    const host = webAddress(entry.url)?.hostname || "";
    anchor.title = entry.title + (host ? " · " + host : "");
    const copy = el("span", "bookmarks-copy");
    copy.append(el("span", "bookmarks-name", entry.title));
    anchor.append(bookmarkMark(entry), copy);
    tile.append(anchor);
    return tile;
  }

  function applyLinkTarget() {
    const target = linkNewTab ? "_blank" : "_self";
    for (const anchor of list.querySelectorAll(".bookmarks-link")) {
      anchor.target = target;
    }
  }

  function selectSheet(id) {
    if (id === activeId) return;
    activeId = id;
    render();
    requestAnimationFrame(() => {
      const escaped = globalThis.CSS?.escape ? CSS.escape(id) : id;
      const tab = tabs.querySelector('[data-sheet-id="' + escaped + '"]');
      tab?.focus();
      tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }

  function renderSkeleton(count) {
    const total = Math.max(4, Math.min(15, Number.isFinite(count) ? count : 8));
    const grid = el("div", "bookmarks-grid bookmarks-skeleton");
    grid.setAttribute("aria-hidden", "true");
    for (let i = 0; i < total; i++) {
      const tile = el("div", "bookmarks-skeleton-tile");
      tile.append(el("span", "bookmarks-skeleton-icon"), el("span", "bookmarks-skeleton-label"));
      grid.append(tile);
    }
    list.replaceChildren(grid);
  }

  function render() {
    delete list.dataset.loading;
    delete document.body.dataset.bootBookmarksTabs;
    const sheets = tree ? buildSheets(tree) : [];
    if (!sheets.some(sheet => sheet.id === activeId)) activeId = sheets[0]?.id || null;

    tabs.replaceChildren(...sheets.map(sheet => {
      const tab = el("button", "bookmarks-sheet", sheet.title);
      tab.type = "button";
      tab.id = "bookmarks-tab-" + sheet.id;
      tab.dataset.sheetId = sheet.id;
      tab.title = sheet.path;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", panelId);
      tab.setAttribute("aria-selected", String(sheet.id === activeId));
      tab.tabIndex = sheet.id === activeId ? 0 : -1;
      tab.addEventListener("click", () => selectSheet(sheet.id));
      return tab;
    }));
    // A single folder needs no switcher; the grid takes the full width instead.
    tabs.hidden = sheets.length < 2;
    syncScrollEdges(tabs);
    list.setAttribute("aria-labelledby", activeId ? "bookmarks-tab-" + activeId : "");

    const sheet = sheets.find(item => item.id === activeId);
    const bookmarks = sheet ? directBookmarks(sheet.node) : [];

    const grid = el("div", "bookmarks-grid");
    grid.append(...bookmarks.map(bookmarkTile));
    list.replaceChildren(grid, status);

    if (failure) status.textContent = "读取浏览器书签失败，请检查扩展权限后重试。";
    else if (!api) status.textContent = "请通过已加载的晨屿扩展打开此页，并允许读取书签。";
    else if (!sheets.length) status.textContent = "还没有书签。在网页上按 Ctrl+D 收藏，会自动显示在这里。";
    else if (!bookmarks.length) {
      status.textContent = sheet && hasFolders(sheet.node)
        ? "这个文件夹没有直接书签，子文件夹已列在分组中。"
        : "这个文件夹里还没有书签。";
    } else status.textContent = "";
    status.hidden = !status.textContent;

    if (tree) {
      requestAnimationFrame(() => {
        if (!alive || list.hidden) return;
        const measured = Math.round(list.getBoundingClientRect().height);
        if (measured > 0) {
          const listHeight = Math.max(86, Math.min(224, measured));
          document.documentElement.style.setProperty("--boot-bookmarks-height", listHeight + "px");
          writeBoot(BOOT_KEYS.metrics, {
            listHeight,
            hasTabs: sheets.length >= 2,
            count: Math.min(15, bookmarks.length),
          });
        }
      });
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 120);
  }

  async function fetchTree() {
    const request = ++generation;
    if (!api?.getTree) return;
    try {
      const next = await api.getTree();
      if (!alive || request !== generation) return;
      tree = next;
      failure = false;
    } catch {
      if (!alive || request !== generation) return;
      tree = null;
      failure = true;
    }
  }

  async function refresh() {
    await fetchTree();
    if (alive) render();
  }

  async function loadLinkPreference() {
    try {
      const value = await getValue(linkKey);
      if (!alive) return;
      linkNewTab = value !== false;
    } catch { /* Keep the default. */ }
  }

  const unsubscribeStorage = onStorageChange([linkKey], changes => {
    if (!(linkKey in changes)) return;
    const next = changes[linkKey].newValue !== false;
    if (next === linkNewTab) return;
    linkNewTab = next;
    applyLinkTarget();
  });

  const onTabsScroll = () => syncScrollEdges(tabs);
  tabs.addEventListener("scroll", onTabsScroll, { passive: true });
  const tabSizes = new ResizeObserver(onTabsScroll);
  tabSizes.observe(tabs);

  function onTabsKeydown(event) {
    // Both arrow pairs move through the row, so either muscle memory works.
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const buttons = [...tabs.querySelectorAll('[role="tab"]')];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    let next = index;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % buttons.length;
    else if (event.key === "Home") next = 0;
    else next = buttons.length - 1;
    buttons[next].focus();
    selectSheet(buttons[next].dataset.sheetId);
  }

  tabs.addEventListener("keydown", onTabsKeydown);

  if (api) {
    for (const name of events) {
      const event = api[name];
      if (typeof event?.addListener !== "function") continue;
      event.addListener(schedule);
      bookmarksEvents.push(event);
    }
  }

  const bootMetrics = readBoot(BOOT_KEYS.metrics);
  tabs.hidden = bootMetrics ? !bootMetrics.hasTabs : true;
  list.dataset.loading = "true";
  renderSkeleton(bootMetrics?.count);

  Promise.all([loadLinkPreference(), fetchTree()]).then(() => {
    if (alive) render();
  });

  return () => {
    alive = false;
    generation++;
    clearTimeout(timer);
    for (const event of bookmarksEvents) event.removeListener(schedule);
    unsubscribeStorage();
    tabs.removeEventListener("keydown", onTabsKeydown);
    tabs.removeEventListener("scroll", onTabsScroll);
    tabSizes.disconnect();
    box.remove();
  };
}
