import { customList, enginesFor, setEngineOptions, savePrefs, validTemplate } from "./search.js";
import { disableBing } from "./wallpapers.js";
import { ACCENT_PRESETS, DEFAULT_ACCENT, applyTheme, isAccent } from "./theme.js";

const prefix = "daybreak.pref.";
const defaults = {
  name: "", engine: "bing", clock24: true, theme: "lake", customImage: "",
  customEngines: [], searchNewTab: false, keepQuery: false, hideCategories: false, searchSuggestions: false,
  wallpaperMask: 24, wallpaperBlur: 0, wallpaperFit: "cover", wallpaperColor: "#244c39", accent: DEFAULT_ACCENT,
  weather: true,
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

/* Wallpaper-adaptive tint: sample the dominant hue so glass, scrim and floating
   controls sit in the same color world as the art instead of neutral gray. */
const wallHues = { lake: [160, 22], pine: [150, 30], paper: [45, 30] };
let wallSampleToken = 0;
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return [0, 0];
  const d = max - min, l = (max + min) / 2;
  const s = l > .5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s];
}
function setWallHue(h, s) {
  const style = document.documentElement.style;
  style.setProperty("--wall-hue", String(Math.round(h)));
  style.setProperty("--wall-sat", Math.round(s) + "%");
  try {
    const boot = JSON.parse(localStorage.getItem("daybreak.boot") || "{}");
    boot.hue = Math.round(h);
    boot.sat = Math.round(s);
    localStorage.setItem("daybreak.boot", JSON.stringify(boot));
  } catch {}
}
/* Synchronous mirror for boot.js so the first paint already shows the saved
   wallpaper instead of flashing the default lake/green. */
export function rememberWallpaper(prefs) {
  try {
    const boot = {
      theme: prefs.theme,
      customImage: prefs.customImage || "",
      wallpaperColor: prefs.wallpaperColor,
      mask: normalizeRange(prefs.wallpaperMask, 85, 24) / 100,
      blur: normalizeRange(prefs.wallpaperBlur, 24, 0),
      fit: prefs.wallpaperFit,
    };
    const hue = document.documentElement.style.getPropertyValue("--wall-hue");
    if (hue) {
      boot.hue = Number(hue);
      boot.sat = parseInt(document.documentElement.style.getPropertyValue("--wall-sat"), 10) || 22;
    }
    localStorage.setItem("daybreak.boot", JSON.stringify(boot));
  } catch {}
}
export function applyWallpaperTint(prefs) {
  if (prefs.theme === "color") {
    const hex = prefs.wallpaperColor.slice(1);
    const [h, s] = rgbToHsl(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16));
    setWallHue(h, Math.max(16, s * 100));
    return;
  }
  if (prefs.theme !== "custom") {
    const [h, s] = wallHues[prefs.theme] || wallHues.lake;
    setWallHue(h, s);
    return;
  }
  const token = ++wallSampleToken;
  const image = new Image();
  image.onload = () => {
    if (token !== wallSampleToken) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 24;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, 24, 24);
      const data = context.getImageData(0, 0, 24, 24).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3] / 255;
        r += data[i] * a; g += data[i + 1] * a; b += data[i + 2] * a; n += a;
      }
      if (!n) return;
      const [h, s] = rgbToHsl(r / n, g / n, b / n);
      // Averages wash out toward white; boost saturation so the tint stays visible.
      setWallHue(h, Math.min(60, Math.max(16, s * 160)));
    } catch { /* keep previous hue */ }
  };
  image.src = prefs.customImage;
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
        <div class="settings-palette" role="group" aria-label="主题色"></div>
        <label class="settings-row"><span>自定义主题色</span><input name="accent" type="color" aria-label="自定义主题色"></label>
      </section>
      <section class="settings-card">
        <h2>搜索</h2>
        <label class="settings-row"><span>默认搜索引擎</span><select class="settings-field" name="engine"></select></label>
        <label class="settings-row"><span>在新标签页打开搜索结果</span><input class="settings-switch" name="searchNewTab" type="checkbox" role="switch"></label>
        <label class="settings-row"><span>搜索后保留输入内容</span><input class="settings-switch" name="keepQuery" type="checkbox" role="switch"></label>
        <label class="settings-row"><span>隐藏搜索类别</span><input class="settings-switch" name="hideCategories" type="checkbox" role="switch"></label>
        <label class="settings-row"><span>显示书签搜索建议</span><input class="settings-switch" name="searchSuggestions" type="checkbox" role="switch"></label>
        <div class="settings-custom-list"></div>
        <button type="button" class="settings-action settings-new-engine">添加自定义搜索引擎</button>
        <form class="settings-engine-form" hidden novalidate>
          <label>引擎名称<input class="settings-field" name="engineName" type="text" required maxlength="80" autocomplete="off"></label>
          <label>搜索网址<input class="settings-field" name="engineTemplate" type="text" required placeholder="https://example.com/search?q=%s" autocomplete="off"></label>
          <small>用 %s 代表搜索词。</small>
          <p class="settings-engine-error" role="alert" hidden></p>
          <div class="settings-actions"><button class="settings-action settings-action-primary" type="submit">保存引擎</button><button class="settings-action settings-engine-cancel" type="button">取消</button></div>
        </form>
      </section>
      <section class="settings-card settings-weather">
        <h2>天气服务</h2>
        <label class="settings-row"><span>高德 API Key</span><input class="settings-field" name="weatherApiKey" type="password" autocomplete="off" spellcheck="false" placeholder="粘贴 Web 服务 Key"></label>
        <p class="settings-help"><a href="https://console.amap.com/dev/key/app" target="_blank" rel="noopener noreferrer">获取高德「Web 服务」Key</a></p>
        <div class="settings-actions"><button class="settings-action settings-action-primary weather-service-save" type="button">保存天气服务</button></div>
        <p class="settings-weather-status" role="status"></p>
        <div class="weather-settings-host"></div>
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
      <section class="settings-card settings-tools">
        <h2>内置工具</h2>
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
  const switches = ["clock24", "weather", "searchNewTab", "keepQuery", "hideCategories", "searchSuggestions"];
  const engineForm = find(".settings-engine-form");
  const weatherKey = find('[name="weatherApiKey"]');
  const weatherServiceStatus = find(".settings-weather-status");
  const weatherConfigKeys = ["daybreak.weather.apiKey"];
  async function loadWeatherService() {
    try {
      let values;
      if (storage) values = await storage.get(weatherConfigKeys);
      else values = Object.fromEntries(weatherConfigKeys.map(key => {
        try { return [key, JSON.parse(localStorage.getItem(key))]; } catch { return [key, null]; }
      }));
      weatherKey.value = typeof values[weatherConfigKeys[0]] === "string" ? values[weatherConfigKeys[0]] : "";
    } catch { /* Leave the field empty when storage is unavailable. */ }
  }
  find(".weather-service-save").addEventListener("click", async () => {
    const key = weatherKey.value.trim();
    try {
      if (!key) throw new Error("请填写高德 API Key。");
      const values = { [weatherConfigKeys[0]]: key };
      if (storage) await storage.set(values);
      else {
        for (const [name, value] of Object.entries(values)) localStorage.setItem(name, JSON.stringify(value));
        window.dispatchEvent(new CustomEvent("daybreak:weather-config"));
      }
      weatherServiceStatus.textContent = "高德天气服务已保存。";
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
