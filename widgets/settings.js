import { customList, enginesFor, setEngineOptions, savePrefs, validTemplate } from "./search.js";
import { disableBing } from "./wallpapers.js";
import { ACCENT_PRESETS, DEFAULT_ACCENT, applyTheme, isAccent } from "./theme.js";

const prefix = "daybreak.pref.";
const defaults = {
  name: "", engine: "bing", clock24: true, theme: "lake", customImage: "",
  customEngines: [], searchNewTab: false, keepQuery: false, hideCategories: false, searchSuggestions: false,
  wallpaperMask: 24, wallpaperBlur: 0, wallpaperFit: "cover", wallpaperColor: "#244c39", accent: DEFAULT_ACCENT,
  tasks: true, notes: true, weather: true,
};
const themes = { lake: "湖光", pine: "松林", paper: "米纸", color: "纯色", custom: "自选图片" };
const storage = globalThis.chrome?.storage?.local;
const keys = Object.keys(defaults).map(key => prefix + key);

async function readPreferences() {
  const prefs = { ...defaults };
  const entries = storage ? await storage.get(keys) : {};
  for (const key of Object.keys(defaults)) {
    const item = prefix + key;
    let value = entries[item];
    if (!storage) {
      try { value = JSON.parse(localStorage.getItem(item)); }
      catch { continue; }
    }
    if (typeof value === typeof defaults[key]) prefs[key] = value;
  }
  prefs.customEngines = customList(prefs.customEngines);
  if (!enginesFor(prefs).some(item => item.id === prefs.engine)) prefs.engine = defaults.engine;
  prefs.wallpaperMask = normalizeRange(prefs.wallpaperMask, 85, defaults.wallpaperMask);
  prefs.wallpaperBlur = normalizeRange(prefs.wallpaperBlur, 24, defaults.wallpaperBlur);
  if (!["cover", "contain", "auto"].includes(prefs.wallpaperFit)) prefs.wallpaperFit = "cover";
  if (!/^#[0-9a-f]{6}$/i.test(prefs.wallpaperColor)) prefs.wallpaperColor = defaults.wallpaperColor;
  if (isAccent(prefs.accent)) prefs.accent = prefs.accent.toLowerCase();
  else prefs.accent = defaults.accent;
  if (!Object.hasOwn(themes, prefs.theme)) prefs.theme = defaults.theme;
  if (!/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(prefs.customImage)) prefs.customImage = "";
  if (prefs.theme === "custom" && !prefs.customImage) prefs.theme = defaults.theme;
  return prefs;
}

function normalizeRange(value, max, fallback) {
  return Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : fallback;
}

export function applyWallpaper(target, prefs) {
  target.dataset.theme = prefs.theme || defaults.theme;
  target.style.setProperty("--wallpaper-mask", String(normalizeRange(prefs.wallpaperMask, 85, 24) / 100));
  target.style.setProperty("--wallpaper-blur", normalizeRange(prefs.wallpaperBlur, 24, 0) + "px");
  target.style.setProperty("--wallpaper-fit", ["cover", "contain", "auto"].includes(prefs.wallpaperFit) ? prefs.wallpaperFit : "cover");
  target.style.setProperty("--wallpaper-color", /^#[0-9a-f]{6}$/i.test(prefs.wallpaperColor) ? prefs.wallpaperColor : defaults.wallpaperColor);
  if (prefs.theme === "custom" && /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(prefs.customImage)) {
    target.style.setProperty("--custom-wallpaper", 'url("' + prefs.customImage + '")');
  } else target.style.removeProperty("--custom-wallpaper");
}

async function encodeWallpaper(file) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    const ratio = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#f4eee3";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.82);
  } finally { URL.revokeObjectURL(url); }
}

export async function mountSettings(root, onChange) {
  const nameId = "settings-name-" + Math.random().toString(36).slice(2, 8);
  root.innerHTML = `
    <div class="settings-panel">
      <section class="settings-card">
        <h2>个人偏好</h2>
        <form class="settings-row settings-name-form">
          <label for="${nameId}">问候称呼</label>
          <input id="${nameId}" name="name" class="settings-field" type="text" maxlength="40" placeholder="你的名字" autocomplete="off">
        </form>
        <label class="settings-row"><span>24 小时制</span><input class="settings-switch" name="clock24" type="checkbox" role="switch"></label>
      </section>
      <section class="settings-card">
        <h2>界面配色</h2>
        <p class="settings-help">主题色用于按钮、链接、选中状态和焦点样式，其余界面保持中性的白色与浅灰色。</p>
        <div class="settings-palette" role="group" aria-label="主题色"></div>
        <label class="settings-row"><span>自定义主题色</span><input name="accent" type="color" aria-label="自定义主题色"></label>
      </section>
      <section class="settings-card">
        <h2>搜索</h2>
        <label class="settings-row"><span>默认搜索引擎</span><select class="settings-field" name="engine"></select></label>
        <label class="settings-row"><span>在新标签页打开搜索结果</span><input class="settings-switch" name="searchNewTab" type="checkbox" role="switch"></label>
        <label class="settings-row"><span>搜索后保留输入内容</span><input class="settings-switch" name="keepQuery" type="checkbox" role="switch"></label>
        <label class="settings-row"><span>隐藏搜索类别</span><input class="settings-switch" name="hideCategories" type="checkbox" role="switch"></label>
        <label class="settings-row"><span>显示收藏与浏览历史建议</span><input class="settings-switch" name="searchSuggestions" type="checkbox" role="switch"></label>
        <div class="settings-custom-list"></div>
        <button type="button" class="settings-action settings-new-engine">添加自定义搜索引擎</button>
        <form class="settings-engine-form" hidden novalidate>
          <label>引擎名称<input class="settings-field" name="engineName" type="text" required maxlength="80" autocomplete="off"></label>
          <label>搜索网址<input class="settings-field" name="engineTemplate" type="text" required placeholder="https://example.com/search?q=%s" autocomplete="off"></label>
          <small>用 %s 代表搜索词。</small>
          <p class="settings-engine-error" role="alert" hidden></p>
          <div class="settings-actions"><button class="settings-action" type="submit">保存引擎</button><button class="settings-action settings-engine-cancel" type="button">取消</button></div>
        </form>
      </section>
      <section class="settings-card settings-weather">
        <h2>天气服务</h2>
        <p class="settings-help">天气和城市搜索使用和风天气。请在 <a href="https://console.qweather.com/" target="_blank" rel="noopener noreferrer">控制台</a> 创建项目，取得 API Host 和 API Key。</p>
        <label class="settings-row"><span>API Host</span><input class="settings-field" name="weatherApiHost" type="url" autocomplete="off" spellcheck="false" placeholder="https://xxxxxx.re.qweatherapi.com"></label>
        <label class="settings-row"><span>API Key</span><input class="settings-field" name="weatherApiKey" type="password" autocomplete="off" spellcheck="false"></label>
        <div class="settings-actions"><button class="settings-action weather-service-save" type="button">保存天气服务</button></div>
        <p class="settings-weather-status" role="status"></p>
      </section>
      <section class="settings-card">
        <h2>首页壁纸</h2>
        <div class="settings-themes" role="group" aria-label="选择首页壁纸"></div>
        <input class="settings-upload" type="file" accept="image/*" aria-label="上传本地壁纸" hidden>
        <button class="settings-replace" type="button" hidden>更换自选图片</button>
        <label class="settings-row"><span>背景颜色</span><input name="wallpaperColor" type="color" aria-label="背景颜色"></label>
        <label class="settings-row"><span>图片显示方式</span><select class="settings-field" name="wallpaperFit"><option value="cover">填满屏幕</option><option value="contain">完整显示</option><option value="auto">原始大小</option></select></label>
        <label class="settings-row"><span>遮罩浓度</span><span class="settings-slider"><input name="wallpaperMask" type="range" min="0" max="85"><output aria-hidden="true"></output></span></label>
        <label class="settings-row"><span>壁纸模糊</span><span class="settings-slider"><input name="wallpaperBlur" type="range" min="0" max="24"><output aria-hidden="true"></output></span></label>
      </section>
      <section class="settings-card">
        <h2>首页小工具</h2>
        <label class="settings-row"><span>待办事项</span><input class="settings-switch" name="tasks" type="checkbox" role="switch"></label>
        <label class="settings-row"><span>笔记</span><input class="settings-switch" name="notes" type="checkbox" role="switch"></label>
        <label class="settings-row"><span>天气</span><input class="settings-switch" name="weather" type="checkbox" role="switch"></label>
      </section>
      <p class="settings-status" role="status"></p>
    </div>`;
  const field = key => root.querySelector('[name="' + key + '"]');
  const find = selector => root.querySelector(selector);
  const status = find(".settings-status");
  const tray = find(".settings-themes");
  const palette = find(".settings-palette");
  const upload = find(".settings-upload");
  const replace = find(".settings-replace");
  let current;
  let readId = 0;
  let uploadId = 0;
  let active = true;
  let writes = Promise.resolve();
  let editingEngine = null;
  const switches = ["clock24", "tasks", "notes", "weather", "searchNewTab", "keepQuery", "hideCategories", "searchSuggestions"];
  const engineForm = find(".settings-engine-form");
  const weatherHost = find('[name="weatherApiHost"]');
  const weatherKey = find('[name="weatherApiKey"]');
  const weatherServiceStatus = find(".settings-weather-status");
  const weatherConfigKeys = ["daybreak.weather.apiHost", "daybreak.weather.apiKey"];
  async function loadWeatherService() {
    try {
      let values;
      if (storage) values = await storage.get(weatherConfigKeys);
      else values = Object.fromEntries(weatherConfigKeys.map(key => {
        try { return [key, JSON.parse(localStorage.getItem(key))]; } catch { return [key, null]; }
      }));
      weatherHost.value = typeof values[weatherConfigKeys[0]] === "string" ? values[weatherConfigKeys[0]] : "";
      weatherKey.value = typeof values[weatherConfigKeys[1]] === "string" ? values[weatherConfigKeys[1]] : "";
    } catch { /* Leave the fields empty when storage is unavailable. */ }
  }
  find(".weather-service-save").addEventListener("click", async () => {
    const host = weatherHost.value.trim(), key = weatherKey.value.trim();
    try {
      if (!host || !key) throw new Error("请填写 API Host 和 API Key。");
      const url = new URL(/^https?:\/\//i.test(host) ? host : "https://" + host);
      if (url.protocol !== "https:") throw new Error("API Host 需要使用 HTTPS 地址。");
      const values = { [weatherConfigKeys[0]]: url.origin, [weatherConfigKeys[1]]: key };
      if (storage) await storage.set(values);
      else {
        for (const [name, value] of Object.entries(values)) localStorage.setItem(name, JSON.stringify(value));
        window.dispatchEvent(new CustomEvent("daybreak:weather-config"));
      }
      weatherHost.value = url.origin;
      weatherServiceStatus.textContent = "天气服务已保存。";
    } catch (error) {
      weatherServiceStatus.textContent = error.message || "天气服务未能保存。";
    }
  });
  loadWeatherService();
  const closeEngineForm = () => {
    editingEngine = null;
    engineForm.hidden = true;
    find(".settings-engine-error").hidden = true;
    find(".settings-new-engine").hidden = false;
  };
  function editEngine(item) {
    editingEngine = item?.id ?? null;
    field("engineName").value = item?.name || "";
    field("engineTemplate").value = item?.template || "";
    engineForm.hidden = false;
    find(".settings-new-engine").hidden = true;
    find(".settings-engine-error").hidden = true;
    field("engineName").focus();
  }
  function changeEngines(mutator) {
    const write = async () => {
      const prefs = await readPreferences();
      await savePrefs(mutator(prefs));
      await refresh();
    };
    return navigator.locks ? navigator.locks.request("daybreak.search.engines", write) : write();
  }
  function renderEngines(items) {
    const list = find(".settings-custom-list");
    list.replaceChildren();
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "settings-engine-item";
      const name = document.createElement("span");
      name.textContent = item.name;
      const edit = document.createElement("button"), remove = document.createElement("button");
      for (const button of [edit, remove]) { button.type = "button"; button.className = "settings-action"; }
      edit.textContent = "编辑"; remove.textContent = "删除";
      edit.setAttribute("aria-label", "编辑 " + item.name); remove.setAttribute("aria-label", "删除 " + item.name);
      edit.addEventListener("click", () => editEngine(item));
      remove.addEventListener("click", async () => {
        try {
          await changeEngines(prefs => ({
            customEngines: prefs.customEngines.filter(engine => engine.id !== item.id),
            ...(prefs.engine === item.id ? { engine: "bing" } : {}),
          }));
          if (editingEngine === item.id) closeEngineForm();
          status.textContent = "搜索引擎已删除";
        } catch { status.textContent = "无法删除搜索引擎，请重试。"; }
      });
      row.append(name, edit, remove);
      list.append(row);
    }
  }
  find(".settings-new-engine").addEventListener("click", () => editEngine(null));
  find(".settings-engine-cancel").addEventListener("click", () => { closeEngineForm(); find(".settings-new-engine").focus(); });
  engineForm.addEventListener("submit", async event => {
    event.preventDefault();
    const name = field("engineName").value.trim(), template = field("engineTemplate").value.trim();
    const error = find(".settings-engine-error");
    if (!name || !validTemplate(template)) {
      error.textContent = "请填写名称，以及包含 %s 的 HTTP 或 HTTPS 搜索网址。"; error.hidden = false; return;
    }
    const oldId = editingEngine;
    const item = { id: oldId || crypto.randomUUID(), name, template };
    try {
      await changeEngines(prefs => {
        if (oldId && !prefs.customEngines.some(engine => engine.id === oldId)) throw Error();
        const customEngines = oldId ? prefs.customEngines.map(engine => engine.id === oldId ? { ...engine, ...item } : engine) : [...prefs.customEngines, item];
        return { customEngines };
      });
      closeEngineForm();
      find(".settings-new-engine").focus();
      status.textContent = "搜索引擎已保存";
    } catch { error.textContent = "无法保存修改，请重新打开编辑。"; error.hidden = false; }
  });

  for (const [label, hex] of ACCENT_PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "settings-palette-chip";
    button.dataset.accent = hex;
    button.style.setProperty("--swatch", hex);
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", "false");
    const dot = document.createElement("span");
    dot.className = "settings-palette-dot";
    dot.setAttribute("aria-hidden", "true");
    const caption = document.createElement("span");
    caption.textContent = label;
    button.append(dot, caption);
    button.addEventListener("click", () => {
      applyTheme(hex);
      save({ accent: hex });
    });
    palette.append(button);
  }
  for (const [key, label] of Object.entries(themes)) {
    const button = document.createElement("button");
    button.className = "settings-theme";
    button.type = "button";
    button.dataset.theme = key;
    const swatch = document.createElement("span");
    swatch.className = "settings-swatch";
    swatch.setAttribute("aria-hidden", "true");
    const caption = document.createElement("span");
    caption.textContent = label;
    button.append(swatch, caption);
    button.addEventListener("click", () => {
      uploadId++;
      if (key === "custom" && !current?.customImage) upload.click();
      else { disableBing(); save({ theme: key }); }
    });
    tray.append(button);
  }
  const custom = find('[data-theme="custom"] .settings-swatch');
  function apply(prefs) {
    const old = current;
    if (!old || old.name !== prefs.name || document.activeElement !== field("name")) field("name").value = prefs.name;
    if (!old || old.engine !== prefs.engine || JSON.stringify(old.customEngines) !== JSON.stringify(prefs.customEngines)) {
      setEngineOptions(field("engine"), enginesFor(prefs), prefs.engine);
      renderEngines(prefs.customEngines);
    }
    for (const key of switches) field(key).checked = prefs[key];
    for (const key of ["wallpaperColor","wallpaperFit","wallpaperMask","wallpaperBlur"]) field(key).value = prefs[key];
    field("accent").value = prefs.accent;
    for (const button of palette.children) button.setAttribute("aria-pressed", String(button.dataset.accent === prefs.accent));
    for (const key of ["wallpaperMask","wallpaperBlur"]) field(key).nextElementSibling.value = prefs[key] + (key === "wallpaperBlur" ? " px" : "%");
    find('[data-theme="color"] .settings-swatch').style.backgroundColor = prefs.wallpaperColor;
    for (const button of tray.children) button.setAttribute("aria-pressed", String(prefs.theme === button.dataset.theme));
    if (old?.customImage !== prefs.customImage) {
      custom.replaceChildren();
      if (prefs.customImage) {
        const preview = document.createElement("img");
        preview.alt = "";
        preview.src = prefs.customImage;
        custom.append(preview);
      }
    }
    replace.hidden = !prefs.customImage;
    current = prefs;
    if (!old || Object.keys(defaults).some(key => key === "customEngines" ? JSON.stringify(old[key]) !== JSON.stringify(prefs[key]) : old[key] !== prefs[key])) onChange?.({ ...prefs });
  }
  async function refresh() {
    const request = ++readId;
    try {
      const prefs = await readPreferences();
      if (active && request === readId) apply(prefs);
    } catch {
      if (!active || request !== readId) return;
      if (!current) apply({ ...defaults });
      status.textContent = "读取设置失败，请重新打开启动页。";
    }
  }
  function save(values) {
    writes = writes.then(async () => {
      try {
        await savePrefs(values);
        await refresh();
        if (active) status.textContent = "设置已保存到本机";
      } catch {
        await refresh();
        if (active) status.textContent = "设置未能保存，请重试。";
      }
    });
  }
  field("name").addEventListener("change", () => save({ name: field("name").value.trim() }));
  find(".settings-name-form").addEventListener("submit", event => {
    event.preventDefault();
    field("name").blur();
  });
  field("engine").addEventListener("change", () => save({ engine: field("engine").value }));
  for (const key of switches) {
    field(key).addEventListener("change", () => save({ [key]: field(key).checked }));
  }
  field("wallpaperColor").addEventListener("change", () => { disableBing(); save({ wallpaperColor: field("wallpaperColor").value, theme: "color" }); });
  field("accent").addEventListener("input", () => applyTheme(field("accent").value));
  field("accent").addEventListener("change", () => save({ accent: field("accent").value }));
  field("wallpaperFit").addEventListener("change", () => save({ wallpaperFit: field("wallpaperFit").value }));
  for (const key of ["wallpaperMask","wallpaperBlur"]) {
    field(key).addEventListener("input", () => {
      const value = Number(field(key).value);
      field(key).nextElementSibling.value = value + (key === "wallpaperBlur" ? " px" : "%");
      if (current) onChange?.({ ...current, [key]: value });
    });
    field(key).addEventListener("change", () => save({ [key]: Number(field(key).value) }));
  }
  replace.addEventListener("click", () => upload.click());
  upload.addEventListener("change", async () => {
    const file = upload.files[0];
    upload.value = "";
    if (!file) return;
    const request = ++uploadId;
    status.textContent = "正在处理图片…";
    try {
      const customImage = await encodeWallpaper(file);
      if (active && request === uploadId) { disableBing(); save({ customImage, theme: "custom" }); }
    } catch {
      if (active && request === uploadId) status.textContent = "无法读取图片，请换一张图片重试。";
    }
  });
  const onStorage = (changes, area) => { if (area === "local" && keys.some(key => key in changes)) refresh(); };
  const onPreviewStorage = event => { if (event.storageArea === localStorage && (!event.key || keys.includes(event.key))) refresh(); };
  if (storage) chrome.storage.onChanged.addListener(onStorage);
  else {
    window.addEventListener("storage", onPreviewStorage);
    window.addEventListener("daybreak:preferences", refresh);
  }
  await refresh();
  return () => {
    active = false;
    if (storage) chrome.storage.onChanged.removeListener(onStorage);
    else {
      window.removeEventListener("storage", onPreviewStorage);
      window.removeEventListener("daybreak:preferences", refresh);
    }
  };
}
