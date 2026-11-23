const catalog = [
  ["bing", "必应 Bing", "https://www.bing.com/search?q=%s"],
  ["google", "Google", "https://www.google.com/search?q=%s"],
  ["baidu", "百度", "https://www.baidu.com/s?wd=%s"],
  ["duckduckgo", "DuckDuckGo", "https://duckduckgo.com/?q=%s"],
  ["yahoo", "Yahoo", "https://search.yahoo.com/search?p=%s"],
  ["sogou", "搜狗", "https://www.sogou.com/web?query=%s"],
  ["360", "360 搜索", "https://www.so.com/s?q=%s"],
].map(([id, name, template]) => ({ id, name, template }));
const builtinIds = new Set([...catalog.map(item => item.id), "browser"]);
const prefKey = "daybreak.pref.";
const categories = { web:"网页", images:"图片", news:"新闻", videos:"视频", maps:"地图" };
const specialized = {
  bing: { images:"https://www.bing.com/images/search?q=%s", news:"https://www.bing.com/news/search?q=%s", videos:"https://www.bing.com/videos/search?q=%s", maps:"https://www.bing.com/maps?q=%s" },
  google: { images:"https://www.google.com/search?tbm=isch&q=%s", news:"https://www.google.com/search?tbm=nws&q=%s", videos:"https://www.google.com/search?tbm=vid&q=%s", maps:"https://www.google.com/maps/search/?api=1&query=%s" },
  baidu: { images:"https://image.baidu.com/search/index?tn=baiduimage&word=%s", news:"https://www.baidu.com/s?tn=news&word=%s", videos:"https://www.baidu.com/sf/vsearch?pd=video&wd=%s", maps:"https://map.baidu.com/search/%s" },
  duckduckgo: { images:"https://duckduckgo.com/?iax=images&ia=images&q=%s", news:"https://duckduckgo.com/?iar=news&ia=news&q=%s", videos:"https://duckduckgo.com/?iax=videos&ia=videos&q=%s", maps:"https://duckduckgo.com/?iaxm=maps&ia=maps&q=%s" },
  yahoo: { images:"https://images.search.yahoo.com/search/images?p=%s", news:"https://news.search.yahoo.com/search?p=%s", videos:"https://video.search.yahoo.com/search/video?p=%s" },
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
  const browser = globalThis.chrome?.search?.query ? [{ id: "browser", name: "浏览器默认", template: "" }] : [];
  return [...browser, ...catalog, ...customList(prefs.customEngines)];
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

export function mountSearch({ form, input, engineSelect }) {
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
  engineSelect?.addEventListener("change", async () => {
    const old = prefs.engine;
    const engine = engineSelect.value;
    prefs = { ...prefs, engine };
    showMode(false);
    try { await savePrefs({ engine }); }
    catch { prefs = { ...prefs, engine: old }; engineSelect.value = old; showMode(false); }
    input.focus();
  }, options);
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (suggestions.composing()) return;
    suggestions.close();
    const query = input.value.trim();
    if (!query) { input.focus(); return; }
    const engine = currentEngine();
    const direct = category === "web" ? addressFor(query) : null;
    if (!direct && engine.id === "browser") {
      chrome.search.query({ text: query, disposition: prefs.searchNewTab ? "NEW_TAB" : "CURRENT_TAB" });
    } else {
      const template = (specialized[engine.id] || engine.types)?.[category] || engine.template;
      const url = direct || template.replaceAll("%s", () => encodeURIComponent(query));
      if (prefs.searchNewTab) window.open(url, "_blank", "noopener,noreferrer");
      else location.assign(url);
    }
    if (!prefs.keepQuery) input.value = "";
  }, options);
  function update(next) {
    prefs = { ...prefs, ...next };
    if (engineSelect) setEngineOptions(engineSelect, enginesFor(prefs), prefs.engine);
    showMode(false);
  }
  update(prefs);
  return { update, destroy() { listeners.abort(); suggestions.destroy(); if (!existing) bar.remove(); else bar.replaceChildren(); } };
}
