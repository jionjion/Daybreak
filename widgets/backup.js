import { addressFor, enginesFor, validTemplate } from "./search.js";

const storage = globalThis.chrome?.storage?.local;
const dataKey = key => key.startsWith("daybreak.") && key !== "daybreak.weather.forecast"
  && !/^daybreak\.(?:runtime|auth|session|credentials|secret|token)\b/i.test(key);
const fields = value => value && typeof value === "object" && !Array.isArray(value);
const imageData = value => typeof value === "string" && /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(value);
const simpleColor = value => typeof value === "string" && /^#[a-f0-9]{6}$/i.test(value);
const timestamp = (...values) => values.map(Number).find(value => Number.isFinite(value) && value > 0) || Date.now();

export async function backupRecords() {
  if (storage) return Object.fromEntries(Object.entries(await storage.get(null)).filter(([key, value]) => dataKey(key) && value != null));
  const result = {};
  for (const key of Object.keys(localStorage).filter(dataKey)) {
    const value = JSON.parse(localStorage.getItem(key));
    if (value != null) result[key] = value;
  }
  return result;
}

function noteFromHtml(content, warnings) {
  if (!/<(?:p|div|br|span|img|a|strong|b|h[1-6]|ul|ol|li|pre|blockquote|table)\b[^>]*>/i.test(content)) {
    return { text: content };
  }
  const template = document.createElement("template");
  template.innerHTML = content;
  const images = {}, bySource = new Map();
  function imageMarker(img) {
    const raw = (img.getAttribute("src") || "").trim();
    const alt = (img.getAttribute("alt") || "笔记图片").replace(/\]/g, "］").replace(/\s+/g, " ").trim();
    const embedded = /^data:image\/(png|jpe?g|webp);base64,([\sA-Za-z0-9+/]+=*)$/i.exec(raw);
    if (!embedded) {
      if (/^https?:\/\//i.test(raw) || raw.startsWith("//")) warnings.add("笔记中的网络图片需重新选择。");
      return img.getAttribute("alt") || "";
    }
    const mime = embedded[1].toLowerCase().replace(/^jpg$/, "jpeg");
    const src = "data:image/" + mime + ";base64," + embedded[2].replace(/\s/g,"");
    if (!bySource.has(src)) {
      const id = "infinity-image-" + (bySource.size + 1);
      bySource.set(src, id);
      images[id] = src;
    }
    return "![" + alt + "](image:" + bySource.get(src) + ")";
  }
  function walk(node, bold = false) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!bold) return node.data;
      return node.data.replace(/[^\n*]+/g, text => text.trim() ? "**" + text + "**" : text);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = node.localName;
    if (["script", "style", "template", "iframe", "object", "svg"].includes(tag)) return "";
    if (tag === "br") return "\n";
    if (tag === "img") return imageMarker(node);
    if (tag === "a") {
      const raw = node.getAttribute("href") || "";
      const url = /^https?:\/\//i.test(raw) && addressFor(raw);
      if (url) {
        const nested = [...node.querySelectorAll("img")].map(imageMarker).join("");
        const label = (node.textContent.trim() || node.querySelector("img")?.alt || url).replace(/\]/g, "］").replace(/\s+/g, " ");
        return nested + "[" + label + "](" + url.replaceAll("(", "%28").replaceAll(")", "%29") + ")";
      }
    }
    const weight = node.style?.fontWeight || "";
    const strong = bold || tag === "b" || tag === "strong" || weight === "bold" || Number(weight) >= 600;
    const text = [...node.childNodes].map(child => walk(child, strong)).join("");
    if (["p","div","li","blockquote","pre","tr","h1","h2","h3","h4","h5","h6"].includes(tag)) return text.endsWith("\n") ? text : text + "\n";
    return text;
  }
  const text = [...template.content.childNodes].map(node => walk(node)).join("").trimEnd();
  return Object.keys(images).length ? { text, images } : { text };
}

function migrateInfinity(data) {
  const records = {}, warnings = new Set(), folders = [], seenNames = new Set();
  let skipped = 0, duplicate = 0, rootOrder = 0;
  function addSite(item, folder, order) {
    if (!fields(item)) { skipped++; return; }
    const url = typeof item.target === "string" && addressFor(item.target.trim());
    if (!url) { skipped++; return; }
    const key = "daybreak.favorite." + url;
    if (Object.hasOwn(records, key)) { duplicate++; return; }
    const record = { url, title: String(item.name || new URL(url).hostname), folder, order, created: timestamp(item.updatetime) };
    if (simpleColor(item.bgColor)) record.iconColor = item.bgColor;
    if (item.bgText) record.iconText = Array.from(String(item.bgText)).slice(0,3).join("");
    if (imageData(item.bgImage)) record.iconImage = item.bgImage;
    else if (item.bgImage) warnings.add("网络图标保留网页名称和链接，图片需重新选择。");
    records[key] = record;
  }
  for (const page of data.site?.sites || []) {
    if (!Array.isArray(page)) continue;
    for (const item of page) {
      if (!Array.isArray(item?.children)) { addSite(item, "", rootOrder++); continue; }
      const base = String(item.name || "文件夹");
      let name = base, suffix = 2;
      while (seenNames.has(name)) name = base + " (" + suffix++ + ")";
      seenNames.add(name);
      folders.push({ name, order: rootOrder++ });
      item.children.forEach((child, i) => addSite(child, name, i));
    }
  }
  if (folders.length) records["daybreak.favoriteFolders"] = folders;
  if (skipped) warnings.add("跳过 " + skipped + " 个内部应用或无效网址。");
  if (duplicate) warnings.add("合并 " + duplicate + " 个重复网址。");

  for (const [i, note] of (data.note?.list || []).entries()) {
    if (typeof note?.content !== "string") continue;
    const id = "infinity-" + encodeURIComponent(note.id ?? i);
    records["daybreak.note." + id] = { id, ...noteFromHtml(note.content, warnings), title: String(note.title || ""), pinned: Boolean(note.sticky || note.pinned || note.isTop),
      created: timestamp(note.time, note.updatetime), updated: timestamp(note.updatetime, note.time) };
  }
  for (const [i, task] of (data.todo?.todoList || []).entries()) {
    if (typeof task?.text !== "string" || !task.text.trim()) continue;
    const id = "infinity-" + encodeURIComponent(task.todoId ?? i);
    records["daybreak.tasks.item." + id] = { text: task.text, created: timestamp(task.time, task.updatetime) };
    if (task.done) records["daybreak.tasks.done." + id] = true;
    let due = Number(task.dueTimestamp);
    if (!(due > 0) && /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) && /^\d{2}:\d{2}/.test(task.dueTime)) {
      due = Date.parse(task.dueDate + "T" + task.dueTime);
    }
    if (Number.isFinite(due) && due > 0) records["daybreak.tasks.reminder." + id] = due;
  }

  const search = data.searcher?.searchEngine || {};
  const engines = [], known = enginesFor({}), byAddress = new Map();
  for (const engine of [...(search.all || []), ...(search.addList || []), ...(search.custom || []), search.current]) {
    if (!engine || typeof engine.name !== "string") continue;
    let template = engine.target || engine.types?.find(item => item.name === "web")?.url || engine.types?.[0]?.url;
    if (typeof template !== "string") continue;
    if (!template.includes("%s")) template += "%s";
    if (!validTemplate(template)) continue;
    let id = known.find(item => item.template === template)?.id || byAddress.get(template);
    if (!id) {
      id = "infinity-" + encodeURIComponent(engine.uuid || template);
      if (engines.some(item => item.id === id)) id += "-" + engines.length;
      const types = {};
      for (const type of engine.types || []) {
        if (!["images","news","videos","maps"].includes(type?.name) || typeof type.url !== "string") continue;
        const target = type.url.includes("%s") ? type.url : type.url + "%s";
        if (validTemplate(target)) types[type.name] = target;
      }
      engines.push({ id, name: engine.name, template, ...(Object.keys(types).length ? { types } : {}) });
      byAddress.set(template, id);
    }
    if (engine === search.current) records["daybreak.pref.engine"] = id;
  }
  if (engines.length) records["daybreak.pref.customEngines"] = engines;
  const settings = data.setting?.setting || {}, wall = data.wallpaper || {};
  const booleans = {
    "pref.searchNewTab": settings.link?.search, "pref.keepQuery": settings.search?.keepSearchInput,
    "pref.hideCategories": settings.search?.hideCategory, "pref.searchSuggestions": settings.search?.searchSuggest,
    "layout.linksNewTab": settings.link?.icon, "layout.bookmarksNewTab": settings.link?.bookmark,
    "layout.historyNewTab": settings.link?.history, "layout.bookmarkBar": settings.view?.topBookmark,
    "layout.frequentBar": settings.view?.topUseful,
  };
  for (const [key, value] of Object.entries(booleans)) if (typeof value === "boolean") records["daybreak." + key] = value;
  if (typeof settings.search?.hide === "boolean") records["daybreak.layout.search"] = !settings.search.hide;
  if (typeof settings.icon?.isHideIconName === "boolean") records["daybreak.layout.labels"] = !settings.icon.isHideIconName;
  if (Number.isFinite(settings.icon?.opacity)) records["daybreak.layout.iconOpacity"] = Math.max(25, Math.min(100, Math.round(settings.icon.opacity * 100)));
  if (settings.icon?.miniMode === true) records["daybreak.layout.mode"] = "minimal";
  for (const [source, target, min, max] of [["col","columns",2,8],["row","rows",1,6]]) {
    const count = settings.layout?.[source];
    if (Number.isInteger(count) && count > 0) records["daybreak.layout." + target] = Math.max(min, Math.min(max,count));
  }
  // Infinity stores the CSS corner radius as a fraction of the rendered icon width.
  const radius = settings.icon?.radius;
  const radiusFraction = Number.isFinite(radius) && radius >= 0 && radius <= 1 ? Math.min(.5, radius) : null;
  if (radiusFraction !== null) records["daybreak.layout.iconRadius"] = Math.round(54 * radiusFraction);
  if (Number.isFinite(wall.opacity)) records["daybreak.pref.wallpaperMask"] = Math.max(0, Math.min(85, Math.round(wall.opacity)));
  if (Number.isFinite(wall.blur)) records["daybreak.pref.wallpaperBlur"] = Math.max(0, Math.min(24, Math.round(wall.blur / 5)));
  if (wall.type === "color" && simpleColor(wall.color)) {
    records["daybreak.pref.theme"] = "color"; records["daybreak.pref.wallpaperColor"] = wall.color;
  } else if (imageData(wall.url)) {
    records["daybreak.pref.theme"] = "custom"; records["daybreak.pref.customImage"] = wall.url;
  } else if (wall.type || wall.url) warnings.add("云端或单独存储的壁纸需重新选择。");
  const unit = String(data.weather?.unit || "").toLowerCase();
  if (["c","celsius","f","fahrenheit"].includes(unit)) records["daybreak.weather.unit"] = unit.startsWith("f") ? "F" : "C";
  if (Array.isArray(data.weather?.list) && data.weather.list.length) warnings.add("原版使用供应商城市编号，请在天气工具中重新选择城市。");
  warnings.add("网页依原顺序重新分页。账号、浏览器权限和未映射的服务端设置不会导入。");
  return { records, warnings: [...warnings], source: "Infinity Pro v2", radiusFraction };
}

export function parseBackup(text) {
  const file = JSON.parse(text.replace(/^\uFEFF/, ""));
  if (!fields(file)) throw Error("请选择晨屿 .json 或 Infinity .infinity 备份文件。");
  if (file.version === "v2" && fields(file.data) && ["site","note","todo","searcher","setting","wallpaper","weather"].some(key => key in file.data)) {
    const result = migrateInfinity(file.data);
    if (!Object.keys(result.records).length) throw Error("这份 Infinity 备份没有可迁移的数据。");
    return result;
  }
  const packaged = file.format === "daybreak-backup" && file.version === 1;
  const data = packaged ? file.records : file;
  if (!fields(data) || !Object.keys(data).every(key => key.startsWith("daybreak.")) || (!packaged && !Object.keys(data).some(dataKey))) {
    throw Error("无法识别此备份。请选择晨屿 JSON 备份或 Infinity Pro v2 本地备份。");
  }
  return { records: Object.fromEntries(Object.entries(data).filter(([key,v]) => dataKey(key) && v != null)), warnings: [], source: packaged ? "晨屿" : "晨屿旧版数据" };
}

function mergeRecords(old, incoming) {
  const result = { ...incoming, ...old };
  for (const [key, property] of [["daybreak.favoriteFolders","name"], ["daybreak.pref.customEngines","id"]]) {
    if (!Array.isArray(old[key]) || !Array.isArray(incoming[key])) continue;
    const known = new Set(old[key].map(item => item?.[property]));
    result[key] = [...old[key], ...incoming[key].filter(item => item && !known.has(item[property]))];
  }
  // A completion, edit, or reminder belongs to its task. Preserve a local task as a unit.
  for (const key of Object.keys(incoming)) {
    const match = /^daybreak\.tasks\.(?:done|edit|reminder)\.(.+)$/.exec(key);
    if (match && Object.hasOwn(old, "daybreak.tasks.item." + match[1]) && !Object.hasOwn(old, key)) delete result[key];
  }
  return result;
}

export async function restoreRecords(incoming, mode, radiusFraction = null) {
  const work = async () => {
    const old = await backupRecords();
    const next = mode === "replace" ? {...incoming} : mergeRecords(old, incoming);
    if (Number.isFinite(radiusFraction) && (mode === "replace" || !Object.hasOwn(old, "daybreak.layout.iconRadius"))) {
      const size = Number(next["daybreak.layout.iconSize"]);
      next["daybreak.layout.iconRadius"] = Math.round(radiusFraction * (size >= 34 && size <= 104 ? size : 54));
    }
    const removed = Object.keys(old).filter(key => !Object.hasOwn(next, key));
    const changed = Object.entries(next).filter(([key, value]) => JSON.stringify(old[key]) !== JSON.stringify(value));
    if (storage) {
      const update = Object.fromEntries([...changed, ...removed.map(key => [key, null])]);
      if (Object.keys(update).length) await storage.set(update);
      if (removed.length) {
        const latest = await storage.get(removed);
        const empty = removed.filter(key => latest[key] === null);
        if (empty.length) await storage.remove(empty);
      }
    } else {
      try {
        removed.forEach(key => localStorage.removeItem(key));
        changed.forEach(([key, value]) => localStorage.setItem(key, JSON.stringify(value)));
      } catch (error) {
        for (const [key] of changed) if (!Object.hasOwn(old, key)) localStorage.removeItem(key);
        for (const [key, value] of Object.entries(old)) localStorage.setItem(key, JSON.stringify(value));
        throw error;
      }
    }
  };
  return navigator.locks ? navigator.locks.request("daybreak.backup.restore", work) : work();
}

export function mountBackup(root, refresh) {
  root.innerHTML = '<h2>本地备份与迁移</h2><p class="settings-help">备份首页设置、壁纸、网页收藏、笔记、待办和天气。浏览器书签与历史记录由浏览器单独管理。</p>'
    + '<div class="settings-actions"><button type="button" class="settings-action backup-export">导出 JSON</button><button type="button" class="settings-action backup-open">选择备份文件</button></div>'
    + '<input type="file" class="backup-file" accept=".infinity,.json,application/json" hidden><div class="backup-preview" hidden>'
    + '<p class="backup-summary"></p><p class="backup-warnings"></p><label class="settings-row"><span>恢复方式</span><select class="settings-field backup-mode"><option value="merge">补充记录，保留已有项目</option><option value="replace">替换当前晨屿数据</option></select></label>'
    + '<p class="settings-help backup-effect"></p><div class="settings-actions"><button class="settings-action backup-apply" type="button">确认导入</button><button class="settings-action backup-cancel" type="button">取消</button></div></div><p class="settings-status backup-status" role="status"></p>';
  const get = name => root.querySelector(".backup-" + name);
  const input = get("file"), preview = get("preview"), status = get("status"), mode = get("mode");
  let pending, request = 0;
  get("export").onclick = async () => {
    try {
      const records = await backupRecords();
      const exportedAt = new Date().toISOString();
      const blob = new Blob([JSON.stringify({ format:"daybreak-backup", version:1, exportedAt, records }, null, 2)], {type:"application/json"});
      const url = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = url; anchor.download = "Daybreak-" + exportedAt.slice(0,10) + ".json";
      root.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      status.textContent = "备份文件已生成。";
    } catch { status.textContent = "导出备份失败，请重试。"; }
  };
  get("open").onclick = () => input.click();
  mode.onchange = () => {
    get("effect").textContent = mode.value === "replace" ? "这会移除当前资料中备份未包含的项目。建议先导出当前备份。" : "相同项目保留本机版本，已有偏好设置优先。";
  };
  get("cancel").onclick = () => { request++; pending = null; preview.hidden = true; status.textContent = ""; };
  input.onchange = async () => {
    const file = input.files[0]; input.value = "";
    if (!file) return;
    const id = ++request;
    pending = null; preview.hidden = true; status.textContent = "";
    try {
      const parsed = parseBackup(await file.text());
      if (id !== request) return;
      pending = parsed;
      const keys = Object.keys(parsed.records);
      const count = prefix => keys.filter(key => key.startsWith(prefix)).length;
      get("summary").textContent = parsed.source + " · " + file.name + " · " + count("daybreak.favorite.") + " 个网页，" + count("daybreak.note.") + " 篇笔记，" + count("daybreak.tasks.item.") + " 项待办，合计 " + keys.length + " 条记录。";
      get("warnings").textContent = parsed.warnings.join(" ");
      mode.value = "merge"; mode.onchange(); preview.hidden = false;
    } catch (error) {
      if (id === request) status.textContent = error instanceof SyntaxError ? "文件不是有效的 JSON 备份。" : error.message;
    }
  };
  get("apply").onclick = async () => {
    if (!pending) return;
    const controls = [...root.querySelectorAll("button,select")];
    controls.forEach(node => { node.disabled = true; });
    try {
      await restoreRecords(pending.records, mode.value, pending.radiusFraction);
      pending = null; preview.hidden = true;
      await refresh?.();
      status.textContent = "导入完成。"; 
      // Preview pages use localStorage, whose change events are sent only to other tabs.
      if (!storage) location.reload();
    } catch { status.textContent = "恢复失败，请检查可用存储空间后重试。"; }
    finally { controls.forEach(node => { node.disabled = false; }); }
  };
}
