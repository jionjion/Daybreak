// The bookmarks list opens in the current tab unless "在新标签页打开书签列表" is on.
const linkKey = "daybreak.layout.bookmarksNewTab";
const events = ["onCreated", "onRemoved", "onChanged", "onMoved", "onChildrenReordered", "onImportEnded"];
let defaultFavicon;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function webAddress(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

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
      entries.push({type: "bookmark", id: node.id, title: (node.title || "").trim() || url.hostname, url: node.url});
    } else {
      entries.push({type: "folder", id: node.id, title: (node.title || "").trim() || "未命名文件夹", node});
    }
  }
  return entries;
}

function buildSheets(tree) {
  const roots = rootsOf(tree);
  const sheets = [];
  for (const node of roots) {
    if (entriesOf(node.children).some(entry => entry.type === "bookmark")) {
      const title = rootTitle(node);
      sheets.push({id: node.id, title, path: title, node});
    }
  }
  const addFolders = (node, parents) => {
    for (const child of node.children || []) {
      if (typeof child.url === "string") continue;
      const title = (child.title || "").trim() || "未命名文件夹";
      const path = [...parents, title].join(" / ");
      sheets.push({id: child.id, title, path, node: child});
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
  const image = element("img", "bookmarks-browser-icon");
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
let favCachePromise = null;
function favCache() {
  favCachePromise ??= (async () => {
    try {
      const storage = globalThis.chrome?.storage?.local;
      const raw = storage ? (await storage.get(FAV_KEY))[FAV_KEY] : JSON.parse(localStorage.getItem(FAV_KEY));
      return raw && typeof raw === "object" ? raw : {};
    } catch { return {}; }
  })();
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
      for (const [key, value] of Object.entries(current)) {
        if (Date.now() - (value.t || 0) >= FAV_TTL) delete current[key];
      }
      try {
        const storage = globalThis.chrome?.storage?.local;
        if (storage) await storage.set({ [FAV_KEY]: current });
        else localStorage.setItem(FAV_KEY, JSON.stringify(current));
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
  let lum = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a < .5) continue;
    lum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255 * a;
    n += a;
  }
  return n > 0 && lum / n < .32;
}

async function loadFavicon(mark, pageUrl) {
  const hit = (await favCache())[pageUrl];
  if (hit && Date.now() - (hit.t || 0) < FAV_TTL) {
    if (!hit.data) return; // known-missing icon; keep the drawn initial
    const image = element("img", "bookmarks-browser-icon");
    image.alt = "";
    image.src = hit.data;
    try { await image.decode(); } catch { return; }
    mark.replaceChildren(image);
    if (hit.tone) mark.dataset.tone = hit.tone;
    return;
  }
  if (!globalThis.chrome?.runtime?.getURL) return;
  try {
    // Chromium may return its built-in globe (HTTP 200) when the site has no icon.
    defaultFavicon ??= faviconImage("https://daybreak-missing-favicon.invalid/").then(pixels).catch(() => null);
    const [image, empty] = await Promise.all([faviconImage(pageUrl), defaultFavicon]);
    if (!empty || pixels(image) !== empty) {
      mark.replaceChildren(image);
      const tone = darkIcon(image) ? "chip" : "";
      if (tone) mark.dataset.tone = tone;
      saveFav(pageUrl, { data: pixels(image), t: Date.now(), tone });
    } else {
      saveFav(pageUrl, { data: "", t: Date.now(), tone: "" });
    }
  } catch { /* Keep the locally drawn initial. */ }
}

function bookmarkMark(bookmark) {
  const mark = element("span", "bookmarks-monogram");
  mark.setAttribute("aria-hidden", "true");
  const host = webAddress(bookmark.url)?.hostname || "";
  mark.dataset.color = String([...host].reduce((sum, character) => (sum * 31 + character.codePointAt(0)) % 6, 0));
  mark.textContent = Array.from(bookmark.title.trim() || host || "?")[0].toLocaleUpperCase();
  loadFavicon(mark, bookmark.url);
  return mark;
}

export function mountBookmarks(root) {
  const api = globalThis.chrome?.bookmarks;
  const storage = globalThis.chrome?.storage?.local;
  const panelId = "bookmarks-sheet-" + Math.random().toString(36).slice(2, 8);
  const box = element("div", "bookmarks-compact");
  const tabs = element("div", "bookmarks-sheets");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "书签文件夹");
  const list = element("div", "bookmarks-list");
  list.id = panelId;
  list.setAttribute("role", "tabpanel");
  const status = element("p", "bookmarks-empty");
  status.setAttribute("role", "status");
  status.hidden = true;
  // The hint lives inside the list so an empty sheet keeps the band height.
  box.append(tabs, list);
  root.replaceChildren(box);

  let tree = null;
  let activeId = null;
  let linkNewTab = false;
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

  function bookmarkTile(entry) {
    const tile = element("div", "bookmarks-tile");
    const anchor = element("a", "bookmarks-link");
    anchor.href = entry.url;
    anchor.target = linkNewTab ? "_blank" : "_self";
    anchor.rel = "noopener noreferrer";
    const host = webAddress(entry.url)?.hostname || "";
    anchor.title = entry.title + (host ? " · " + host : "");
    const copy = element("span", "bookmarks-copy");
    copy.append(element("span", "bookmarks-name", entry.title));
    anchor.append(bookmarkMark(entry), copy);
    tile.append(anchor);
    return tile;
  }

  function selectSheet(id) {
    if (id === activeId) return;
    activeId = id;
    render();
    requestAnimationFrame(() => {
      const escaped = globalThis.CSS?.escape ? CSS.escape(id) : id;
      const tab = tabs.querySelector('[data-sheet-id="' + escaped + '"]');
      tab?.focus();
      tab?.scrollIntoView({block: "nearest", inline: "nearest"});
    });
  }

  function render() {
    const sheets = tree ? buildSheets(tree) : [];
    if (!sheets.some(sheet => sheet.id === activeId)) activeId = sheets[0]?.id || null;

    tabs.replaceChildren(...sheets.map(sheet => {
      const tab = element("button", "bookmarks-sheet", sheet.title);
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
    tabs.hidden = !sheets.length;
    list.setAttribute("aria-labelledby", activeId ? "bookmarks-tab-" + activeId : "");

    const sheet = sheets.find(item => item.id === activeId);
    const bookmarks = sheet ? directBookmarks(sheet.node) : [];

    const grid = element("div", "bookmarks-grid");
    grid.append(...bookmarks.map(bookmarkTile));
    list.replaceChildren(grid, status);

    if (failure) status.textContent = "读取浏览器书签失败，请检查扩展权限后重试。";
    else if (!api) status.textContent = "请通过已加载的晨屿扩展打开此页，并允许读取书签。";
    else if (!sheets.length) status.textContent = "还没有书签。在网页上按 Ctrl+D 收藏，会自动显示在这里。";
    else if (!bookmarks.length) status.textContent = sheet && hasFolders(sheet.node)
      ? "这个文件夹没有直接书签，子文件夹已显示在标签栏。"
      : "这个文件夹里还没有书签。";
    else status.textContent = "";
    status.hidden = !status.textContent;
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 120);
  }

  async function refresh() {
    const request = ++generation;
    if (!api?.getTree) { render(); return; }
    try {
      const next = await api.getTree();
      if (!alive || request !== generation) return;
      tree = next;
      failure = false;
      render();
    } catch {
      if (!alive || request !== generation) return;
      tree = null;
      failure = true;
      render();
    }
  }

  async function loadLinkPreference() {
    if (!storage?.get) return;
    try {
      const values = await storage.get(linkKey);
      if (!alive) return;
      linkNewTab = values?.[linkKey] === true;
      render();
    } catch { /* Keep the default. */ }
  }

  function onStorageChanged(changes, area) {
    if (area !== "local" || !(linkKey in changes)) return;
    linkNewTab = changes[linkKey].newValue === true;
    render();
  }

  function onTabsKeydown(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...tabs.querySelectorAll('[role="tab"]')];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    let next = index;
    if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
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
  storage?.onChanged?.addListener(onStorageChanged);

  render();
  loadLinkPreference();
  refresh();

  return () => {
    alive = false;
    generation++;
    clearTimeout(timer);
    for (const event of bookmarksEvents) event.removeListener(schedule);
    storage?.onChanged?.removeListener(onStorageChanged);
    tabs.removeEventListener("keydown", onTabsKeydown);
    box.remove();
  };
}