const prefix = "daybreak.favorite.";
const foldersKey = "daybreak.favoriteFolders";
const linkKey = "daybreak.layout.linksNewTab";
const storage = globalThis.chrome?.storage?.local;

export function favoriteAddress(value) {
  const raw = String(value || "").trim();
  if (!raw || /\s/.test(raw)) throw new Error("请输入完整的网页地址。");
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(raw);
  const hasPort = /^[\w.-]+:\d+(?:[/?#]|$)/.test(raw);
  let url;
  try { url = new URL(hasScheme && !hasPort ? raw : "https://" + raw); }
  catch { throw new Error("请输入有效的网页地址。"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("请输入普通的 HTTP 或 HTTPS 网页地址。");
  return url;
}

export function validIconImage(value) {
  return typeof value === "string" && /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/i.test(value);
}
export function webKey(address) { return "url:" + address; }
export function groupKey(name) { return "folder:" + name; }
export function position(item) { return Number.isFinite(item.order) ? item.order : -(Number(item.created) || 0); }

async function read(keys = null) {
  if (storage) return storage.get(keys);
  const result = {};
  for (const key of keys || Object.keys(localStorage)) {
    if (!key.startsWith(prefix) && key !== foldersKey && key !== linkKey) continue;
    try { result[key] = JSON.parse(localStorage.getItem(key)); }
    catch { /* Ignore unreadable preview data. */ }
  }
  return result;
}
async function write(updates) {
  if (storage) {
    await storage.set(updates);
    const removed = Object.keys(updates).filter(key => updates[key] === null);
    if (removed.length) await storage.remove(removed).catch(() => {});
  } else {
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    }
    window.dispatchEvent(new Event("daybreak-favorites-change"));
  }
}
function locked(action) {
  return globalThis.navigator?.locks ? navigator.locks.request("daybreak.favorite.write", action) : action();
}
export function watchDesk(callback) {
  const relevant = key => key === foldersKey || key === linkKey || key.startsWith(prefix);
  if (storage) {
    const listener = (changes, area) => { if (area === "local" && Object.keys(changes).some(relevant)) callback(); };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
  const listener = event => { if (!event.key || relevant(event.key)) callback(); };
  window.addEventListener("storage", listener);
  window.addEventListener("daybreak-favorites-change", callback);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("daybreak-favorites-change", callback);
  };
}
export async function readDesk() {
  const values = await read();
  const sites = [];
  for (const [key, item] of Object.entries(values)) {
    if (!key.startsWith(prefix) || !item || typeof item.title !== "string") continue;
    try {
      if (key === prefix + favoriteAddress(item.url).href) sites.push({ ...item, folder: typeof item.folder === "string" ? item.folder : "" });
    } catch { /* A damaged record must not prevent loading the remaining shortcuts. */ }
  }
  const folders = new Map();
  if (Array.isArray(values[foldersKey])) {
    for (const folder of values[foldersKey]) {
      if (typeof folder?.name === "string" && folder.name.trim()) folders.set(folder.name, { ...folder });
    }
  }
  for (const item of sites) {
    if (item.folder && !folders.has(item.folder)) folders.set(item.folder, { name: item.folder, order: position(item) });
  }
  return {sites, folders, newTab: values[linkKey] !== false};
}

export function deskNodes(desk, folder = "") {
  const sites = desk.sites.filter(item => item.folder === folder).map(site => ({key: webKey(site.url), title: site.title, order: position(site), site}));
  if (!folder) {
    for (const entry of desk.folders.values()) sites.push({key: groupKey(entry.name), title: entry.name, order: position(entry), folder: entry});
  }
  return sites.sort((a,b) => a.order - b.order || a.key.localeCompare(b.key));
}
export async function findFavorite(address) {
  const key = prefix + favoriteAddress(address).href;
  return (await read([key]))[key] || null;
}
export async function saveFavorite(values, originalUrl = null) {
  const url = favoriteAddress(values.url);
  const key = prefix + url.href;
  const oldKey = originalUrl ? prefix + favoriteAddress(originalUrl).href : null;
  return locked(async () => {
    const existing = await read(oldKey && oldKey !== key ? [key, oldKey] : [key]);
    if (existing[key] && key !== oldKey) throw new Error("这个网页已经在收藏里了。");
    if (oldKey && !existing[oldKey]) throw new Error("此收藏已被删除，请重新添加。");
    const original = (oldKey && existing[oldKey]) || {};
    const record = {
      ...original, url: url.href, title: values.title.trim() || url.hostname,
      folder: values.folder.trim(), created: original.created || Date.now()
    };
    // The toolbar edits just the title and folder. Preserve icon and layout fields on that path.
    if ("iconText" in values) record.iconText = Array.from(values.iconText.trim()).slice(0,3).join("");
    if ("iconColor" in values) record.iconColor = /^#[0-9a-f]{6}$/i.test(values.iconColor) ? values.iconColor : "";
    if ("iconImage" in values) record.iconImage = validIconImage(values.iconImage) ? values.iconImage : "";
    if ("iconMode" in values) record.iconMode = values.iconMode === "browser" ? "browser" : "custom";
    const updates = { [key]: record };
    if (oldKey && oldKey !== key) updates[oldKey] = null;
    await write(updates);
    return record;
  });
}
export async function removeFavorite(address) { return locked(() => write({[prefix + favoriteAddress(address).href]: null})); }
export async function changeGroup(name, nextName, action) {
  return locked(async () => {
    const desk = await readDesk();
    const next = nextName.trim();
    if (action !== "create" && !desk.folders.has(name)) throw new Error("这个文件夹已被修改。");
    if (action === "create" || action === "rename") {
      if (!next || next.length > 80) throw new Error("请输入 1 至 80 字的文件夹名称。");
      if ((action === "create" || name !== next) && desk.folders.has(next)) throw new Error("已有同名文件夹。");
    }
    const updates = {};
    if (action === "create") desk.folders.set(next, {name:next, order:-Date.now()});
    else {
      const old = desk.folders.get(name);
      desk.folders.delete(name);
      if (action === "rename") desk.folders.set(next, {...old, name:next});
      for (const site of desk.sites.filter(item => item.folder === name)) {
        updates[prefix + site.url] = action === "delete" ? null : {...site, folder:action === "rename" ? next : ""};
      }
    }
    updates[foldersKey] = [...desk.folders.values()];
    await write(updates);
  });
}
export async function fileSite(url, folder) {
  return locked(async () => {
    const desk = await readDesk();
    const site = desk.sites.find(item => item.url === url);
    if (!site) throw new Error("这个网页已被移除。");
    if (folder && !desk.folders.has(folder)) throw new Error("目标文件夹已被移除。");
    await write({[prefix + site.url]:{...site, folder, order:-Date.now()}, [foldersKey]:[...desk.folders.values()]});
  });
}
export async function groupPair(firstUrl, secondUrl, groupName) {
  return locked(async () => {
    const desk = await readDesk();
    const name = groupName.trim();
    if (!name || name.length > 80) throw new Error("请输入 1 至 80 字的文件夹名称。");
    if (desk.folders.has(name)) throw new Error("已有同名文件夹。");
    const first = desk.sites.find(site => site.url === firstUrl && !site.folder);
    const second = desk.sites.find(site => site.url === secondUrl && !site.folder);
    if (!first || !second || firstUrl === secondUrl) throw new Error("网页的位置已更改，请重新拖放。");
    desk.folders.set(name, {name, order:position(first)});
    await write({
      [foldersKey]:[...desk.folders.values()],
      [prefix + firstUrl]:{...first, folder:name, order:0},
      [prefix + secondUrl]:{...second, folder:name, order:1}
    });
  });
}
// Store one coherent order, including folder positions, under the same cross-tab lock as edits.
export async function moveNode(source, target, scope, after) {
  return locked(async () => {
    const desk = await readDesk();
    const nodes = deskNodes(desk, scope);
    const from = nodes.findIndex(item => item.key === source);
    if (from === -1 || target === source) return;
    const [item] = nodes.splice(from,1);
    const to = nodes.findIndex(item => item.key === target);
    if (to === -1) return;
    nodes.splice(to + Number(after), 0, item);
    const updates = {};
    nodes.forEach((node,index) => {
      if (node.site) {
        if (node.site.order !== index) updates[prefix + node.site.url] = {...node.site, order:index};
      } else desk.folders.set(node.title, {...node.folder, order:index});
    });
    updates[foldersKey] = [...desk.folders.values()];
    await write(updates);
  });
}
