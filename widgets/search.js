const catalog = [
  ["bing", "必应 Bing", "https://www.bing.com/search?q=%s"],
  ["google", "Google", "https://www.google.com/search?q=%s"],
  ["baidu", "百度", "https://www.baidu.com/s?wd=%s"],
  ["sogou", "搜狗", "https://www.sogou.com/web?query=%s"],
  ["360", "360 搜索", "https://www.so.com/s?q=%s"],
].map(([id, name, template]) => ({ id, name, template }));
const builtinIds = new Set(catalog.map(item => item.id));
const engineIcons = {
  bing: "assets/engines/bing.ico",
  google: "assets/engines/google.svg",
  baidu: "assets/engines/baidu.ico",
  sogou: "assets/engines/sogou.ico",
  "360": "assets/engines/360.png",
};
const defaultEngineIcon = "assets/engines/default.svg";
const prefKey = "daybreak.pref.";
const categories = { web:"网页", images:"图片", news:"新闻", videos:"视频", maps:"地图" };
const specialized = {
  bing: { images:"https://www.bing.com/images/search?q=%s", news:"https://www.bing.com/news/search?q=%s", videos:"https://www.bing.com/videos/search?q=%s", maps:"https://www.bing.com/maps?q=%s" },
  google: { images:"https://www.google.com/search?tbm=isch&q=%s", news:"https://www.google.com/search?tbm=nws&q=%s", videos:"https://www.google.com/search?tbm=vid&q=%s", maps:"https://www.google.com/maps/search/?api=1&query=%s" },
  baidu: { images:"https://image.baidu.com/search/index?tn=baiduimage&word=%s", news:"https://www.baidu.com/s?tn=news&word=%s", videos:"https://www.baidu.com/sf/vsearch?pd=video&wd=%s", maps:"https://map.baidu.com/search/%s" },
  sogou: { images:"https://pic.sogou.com/pics?query=%s", news:"https://news.sogou.com/news?query=%s", videos:"https://v.sogou.com/v?query=%s" },
  "360": { images:"https://image.so.com/i?q=%s", news:"https://news.so.com/ns?q=%s", videos:"https://video.360kan.com/v?q=%s" },
};
export function validTemplate(value) {
  if (typeof value !== "string" || !value.includes("%s") || /\s/.test(value)) return false;
  try {
    const first = new URL(value.replaceAll("%s", "example"));
    const second = new URL(value.replaceAll("%s", "somethingelse"));
    return ["https:", "http:"].includes(first.protocol) && !first.username && !first.password && first.origin === second.origin;
  } catch { return false; }
}

export function customList(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  return value.filter(item => {
    if (typeof item?.id !== "string" || !item.id || ids.has(item.id) || builtinIds.has(item.id)
        || typeof item.name !== "string" || !item.name.trim() || !validTemplate(item.template)) return false;
    ids.add(item.id);
    return true;
  }).map(({ id, name, template, types }) => {
    const valid = Object.fromEntries(Object.entries(types || {}).filter(([key, url]) => key !== "web" && Object.hasOwn(categories,key) && validTemplate(url)));
    return Object.keys(valid).length ? { id, name, template, types: valid } : { id, name, template };
  });
}

export function enginesFor(prefs) {
  return [...catalog, ...customList(prefs.customEngines)];
}

export function addressFor(query) {
  const hasScheme = /^https?:\/\//i.test(query);
  if (!hasScheme && !/^(?:localhost|\[[a-f0-9:]+\]|(?:[^\s./:@]+\.)+[^\s./:@]+)(?::\d+)?(?:[/?#][^\s]*)?$/iu.test(query)) return null;
  try {
    const url = new URL(hasScheme ? query : "https://" + query);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function setEngineOptions(select, engines, current) {
  const options = engines.map(item => new Option(item.name, item.id));
  select.replaceChildren(...options);
  select.value = engines.some(item => item.id === current) ? current : "bing";
}

export async function savePrefs(values) {
  const entries = Object.fromEntries(Object.entries(values).map(([key, value]) => [prefKey + key, value]));
  if (globalThis.chrome?.storage?.local) await chrome.storage.local.set(entries);
  else {
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent("daybreak:preferences"));
  }
}

async function localSuggestions(query) {
  const storage = globalThis.chrome?.storage?.local;
  const matches = text => String(text || "").toLocaleLowerCase().includes(query.toLocaleLowerCase());
  async function favorites() {
    let pairs;
    if (storage) {
      const keys = storage.getKeys ? (await storage.getKeys()).filter(key => key.startsWith("daybreak.favorite.")) : null;
      pairs = Object.entries(await storage.get(keys));
    } else {
      pairs = Object.keys(localStorage).filter(key => key.startsWith("daybreak.favorite.")).map(key => {
        try { return [key, JSON.parse(localStorage.getItem(key))]; } catch { return [key,null]; }
      });
    }
    return pairs.filter(([key,item]) => key.startsWith("daybreak.favorite.") && item && (matches(item.title) || matches(item.url)))
      .map(([,item]) => ({...item, source:"收藏"}));
  }
  const history = globalThis.chrome?.history;
  const [sites, visits] = await Promise.all([
    favorites().catch(() => []),
    history ? history.search({text:query, startTime:0, maxResults:8}).catch(() => []) : [],
  ]);
  const unique = new Map();
  for (const item of [...sites,...visits.map(item => ({...item,source:"历史"}))]) {
    const url = typeof item.url === "string" && addressFor(item.url);
    if (url && !unique.has(url)) unique.set(url, {url, title:item.title || new URL(url).hostname, source:item.source});
    if (unique.size >= 7) break;
  }
  return [...unique.values()];
}

function suggestionsFor(form, input, enabled, options) {
  const box = document.createElement("div");
  box.className = "search-suggestions";
  box.id = "daybreak-search-suggestions";
  box.setAttribute("role","listbox");
  box.setAttribute("aria-label","本机搜索建议");
  box.hidden = true;
  document.body.append(box);
  input.setAttribute("role","combobox");
  input.setAttribute("aria-autocomplete","list");
  input.setAttribute("aria-controls",box.id);
  input.setAttribute("aria-expanded","false");
  let results = [], selected = -1, timer, revision = 0, composing = false;
  function close() {
    clearTimeout(timer);
    revision++;
    results = [];
    selected = -1;
    box.hidden = true;
    box.replaceChildren();
    input.setAttribute("aria-expanded","false");
    input.removeAttribute("aria-activedescendant");
  }
  function position() {
    if (box.hidden) return;
    const edge = form.getBoundingClientRect(), below = window.innerHeight - edge.bottom;
    box.style.left = Math.max(4,edge.left) + "px";
    box.style.width = Math.min(edge.width,window.innerWidth-8) + "px";
    if (below < 180 && edge.top > below) {
      box.style.bottom = window.innerHeight - edge.top + 4 + "px"; box.style.top = "auto";
      box.style.maxHeight = Math.max(70,Math.min(315,edge.top - 8)) + "px";
    } else {
      box.style.top = edge.bottom + 4 + "px"; box.style.bottom = "auto";
      box.style.maxHeight = Math.max(70,Math.min(315,below - 8)) + "px";
    }
  }
  function choose(index) {
    const item = results[index];
    if (!item) return;
    input.value = item.url;
    close();
    form.requestSubmit();
  }
  function schedule() {
    close();
    const term = input.value.trim(), request = revision;
    if (composing || !enabled() || !term || document.activeElement !== input) return;
    timer = setTimeout(async () => {
      const items = await localSuggestions(term);
      if (request !== revision || !items.length || input.value.trim() !== term || !enabled()) return;
      results = items;
      items.forEach((item,index) => {
        const option = document.createElement("div");
        option.setAttribute("role","option"); option.setAttribute("aria-selected","false"); option.id = box.id + "-" + index;
        const title = document.createElement("strong"), detail = document.createElement("span");
        title.textContent = item.title; detail.textContent = item.source + " · " + new URL(item.url).hostname;
        option.append(title,detail);
        option.addEventListener("mousedown",event => event.preventDefault());
        option.onclick = () => choose(index);
        box.append(option);
      });
      box.hidden = false; position(); input.setAttribute("aria-expanded","true");
    },130);
  }
  input.addEventListener("keydown",event => {
    if (event.isComposing || event.keyCode === 229 || composing || box.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key === "Enter" && selected >= 0) { event.preventDefault(); choose(selected); return; }
    if (!["ArrowUp","ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const offset = event.key === "ArrowDown" ? 1 : -1;
    selected = selected < 0 ? (offset === 1 ? 0 : results.length - 1) : (selected + offset + results.length) % results.length;
    for (const [i,option] of [...box.children].entries()) option.setAttribute("aria-selected",String(i === selected));
    input.setAttribute("aria-activedescendant",box.children[selected].id);
    box.children[selected].scrollIntoView({block:"nearest"});
  },options);
  input.addEventListener("input",schedule,options);
  input.addEventListener("focus",schedule,options);
  input.addEventListener("blur",close,options);
  input.addEventListener("compositionstart",()=>{ composing=true; close(); },options);
  input.addEventListener("compositionend",()=>{ composing=false; schedule(); },options);
  window.addEventListener("resize",position,options);
  window.addEventListener("scroll",position,{...options,capture:true});
  return { close, composing:()=>composing, destroy(){close();box.remove();} };
}

export function mountSearch({ form, input }) {
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  let prefs = { engine: "bing", customEngines: [], searchNewTab: false, keepQuery: false };
  let category = "web";
  const suggestions = suggestionsFor(form, input, () => prefs.searchSuggestions && category === "web", options);
  const container = form.closest(".search-block") || form.parentElement;
  const existing = container.querySelector("#search-categories");
  const bar = existing || document.createElement("div");
  bar.id = "search-categories";
  bar.classList.add("search-categories");
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "搜索类别");
  if (!existing) form.after(bar);
  const categoryButtons = new Map();
  for (const [key, label] of Object.entries(categories)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.category = key;
    button.addEventListener("click", () => { category = key; showMode(true); }, options);
    bar.append(button);
    categoryButtons.set(key, button);
  }
  const engineButton = form.querySelector("#engine-button");
  const engineMenu = document.createElement("div");
  engineMenu.className = "engine-menu";
  engineMenu.id = "engine-menu";
  engineMenu.hidden = true;
  engineMenu.setAttribute("role", "menu");
  engineMenu.setAttribute("aria-label", "搜索引擎");
  form.append(engineMenu);
  engineButton?.setAttribute("aria-controls", engineMenu.id);
  function engineIcon(engine) {
    const icon = document.createElement("span");
    icon.className = "engine-icon";
    const img = new Image();
    img.alt = "";
    let host = "";
    if (engine.template) {
      try { host = new URL(engine.template.replaceAll("%s", "example")).hostname; } catch {}
    }
    const bundled = engineIcons[engine.id];
    let done = false;
    const fallback = () => {
      if (done || img.src.endsWith(defaultEngineIcon)) return;
      done = true;
      img.src = defaultEngineIcon;
    };
    img.addEventListener("load", () => { done = true; }, { once: true });
    img.addEventListener("error", fallback, { once: true });
    if (!bundled) setTimeout(fallback, 2500);
    img.src = bundled || (host ? "https://" + host + "/favicon.ico" : defaultEngineIcon);
    icon.append(img);
    return icon;
  }
  function setMenu(open) {
    engineMenu.hidden = !open;
    engineButton?.setAttribute("aria-expanded", String(open));
  }
  function renderEngine() {
    const engine = currentEngine();
    if (engineButton) {
      const label = "切换搜索引擎（当前：" + engine.name + "）";
      engineButton.replaceChildren(engineIcon(engine));
      engineButton.title = label;
      engineButton.setAttribute("aria-label", label);
    }
    engineMenu.replaceChildren(...enginesFor(prefs).map(item => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "engine-option";
      option.setAttribute("role", "menuitemradio");
      option.setAttribute("aria-checked", String(item.id === engine.id));
      option.setAttribute("aria-label", item.name);
      option.title = item.name;
      option.append(engineIcon(item));
      option.addEventListener("click", () => chooseEngine(item.id), options);
      return option;
    }));
  }
  async function chooseEngine(id) {
    setMenu(false);
    if (id === prefs.engine) { input.focus(); return; }
    const old = prefs.engine;
    prefs = { ...prefs, engine: id };
    renderEngine();
    showMode(false);
    try { await savePrefs({ engine: id }); }
    catch { prefs = { ...prefs, engine: old }; renderEngine(); showMode(false); }
    input.focus();
  }
  engineButton?.addEventListener("click", () => { suggestions.close(); setMenu(engineMenu.hidden); }, options);
  document.addEventListener("pointerdown", event => {
    if (engineMenu.hidden || engineMenu.contains(event.target) || engineButton?.contains(event.target)) return;
    setMenu(false);
  }, options);
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || engineMenu.hidden) return;
    setMenu(false);
    input.focus();
  }, options);
  function currentEngine() {
    return enginesFor(prefs).find(item => item.id === prefs.engine) || catalog[0];
  }
  function showMode(focus) {
    suggestions.close();
    const engine = currentEngine();
    const types = specialized[engine.id] || engine.types || {};
    if (!types[category] || prefs.hideCategories) category = "web";
    bar.hidden = prefs.hideCategories || !Object.keys(types).length;
    for (const [key, button] of categoryButtons) {
      button.hidden = key !== "web" && !types[key];
      button.setAttribute("aria-pressed", String(category === key));
    }
    input.placeholder = category === "web" ? "搜索或输入网址" : "搜索" + categories[category];
    input.setAttribute("aria-label", input.placeholder);
    if (focus) input.focus();
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (suggestions.composing()) return;
    suggestions.close();
    setMenu(false);
    const query = input.value.trim();
    if (!query) { input.focus(); return; }
    const engine = currentEngine();
    const direct = category === "web" ? addressFor(query) : null;
    const template = (specialized[engine.id] || engine.types)?.[category] || engine.template;
    const url = direct || template.replaceAll("%s", () => encodeURIComponent(query));
    if (prefs.searchNewTab) window.open(url, "_blank", "noopener,noreferrer");
    else location.assign(url);
    if (!prefs.keepQuery) input.value = "";
  }, options);
  function update(next) {
    prefs = { ...prefs, ...next };
    renderEngine();
    showMode(false);
  }
  update(prefs);
  return { update, destroy() { listeners.abort(); suggestions.destroy(); engineMenu.remove(); if (!existing) bar.remove(); else bar.replaceChildren(); } };
}
