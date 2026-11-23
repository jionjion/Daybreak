const CITY_KEY = "daybreak.weather.city";
const CACHE_KEY = "daybreak.weather.forecast";
const UNIT_KEY = "daybreak.weather.unit";
const CITIES_KEY = "daybreak.weather.cities";
const HOST_KEY = "daybreak.weather.apiHost";
const API_KEY = "daybreak.weather.apiKey";
const FRESH_FOR = 30 * 60 * 1000;
const SOURCE = "和风天气";
const CONFIG_HINT = "请先在「个人设置 → 天气服务」填写和风天气 API Host 和 API Key。";

async function read(key) {
  const storage = globalThis.chrome?.storage?.local;
  if (storage) return (await storage.get(key))[key];
  return JSON.parse(localStorage.getItem(key));
}

async function write(key, value) {
  const storage = globalThis.chrome?.storage?.local;
  if (storage) await storage.set({ [key]: value });
  else localStorage.setItem(key, JSON.stringify(value));
}

async function request(url, controller, { headers = {}, timeoutMs = 12000 } = {}) {
  const attempt = new AbortController();
  const abort = () => attempt.abort();
  controller.signal.throwIfAborted();
  controller.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(url, { signal: attempt.signal, headers, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) {
      const error = new Error("天气服务请求失败（HTTP " + response.status + "）");
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
    controller.signal.removeEventListener("abort", abort);
  }
}

function normalizeHost(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
  if (url.protocol !== "https:") throw new Error("API Host 需要使用 HTTPS 地址。");
  return url.origin;
}

// New accounts use a per-project host for every API; legacy accounts keep separate geo/weather hosts.
function endpoints(host) {
  const url = new URL(host);
  const legacy = /(^|\.)qweather\.com$/i.test(url.hostname);
  return legacy
    ? { geo: "https://geoapi.qweather.com", weather: "https://devapi.qweather.com", legacy }
    : { geo: url.origin, weather: url.origin, legacy };
}

function authHeaders(legacy, key) {
  return legacy ? {} : { "X-QW-Api-Key": key };
}

function authorize(url, legacy, key) {
  if (legacy) url.searchParams.set("key", key);
  return url;
}

async function weatherConfig() {
  const [host, key] = await Promise.all([read(HOST_KEY).catch(() => ""), read(API_KEY).catch(() => "")]);
  let normalized = "";
  try { normalized = normalizeHost(host); } catch { normalized = ""; }
  return { host: normalized, key: typeof key === "string" ? key.trim() : "" };
}

function apiError(data) {
  const code = String(data?.code || "");
  if (code === "200") return null;
  if (code === "401") return new Error("和风天气认证失败，请检查 API Key 和 API Host。");
  if (code === "403") return new Error("和风天气套餐不含该接口，或请求次数已用尽。");
  if (code === "404") return new Error("和风天气找不到该城市或接口地址。");
  if (code === "429") return new Error("和风天气请求次数已用尽，请稍后再试。");
  return new Error("和风天气返回错误代码 " + (code || "未知") + "。");
}

function errorText(error, fallback) {
  if (error?.message === "CONFIG") return CONFIG_HINT;
  if (error?.status === 401) return "和风天气认证失败，请检查 API Key 和 API Host。";
  if (error?.status === 403) return "和风天气套餐不含该接口，或请求次数已用尽。";
  if (error?.status === 429) return "和风天气请求次数已用尽，请稍后再试。";
  if (typeof error?.message === "string" && error.message.startsWith("和风天气")) return error.message;
  return fallback;
}

function num(value) {
  return value === "" || value == null ? NaN : Number(value);
}

function validCity(city) {
  return typeof city?.name === "string" && Number.isFinite(city.latitude) && Number.isFinite(city.longitude);
}

function cityId(city) {
  return city.latitude + "," + city.longitude;
}

function details(city) {
  return [city.admin1, city.country].filter((value, index, values) =>
    value && value !== city.name && values.indexOf(value) === index).join(" · ");
}

async function searchQWeather(name, config, controller) {
  if (!config.host || !config.key) throw new Error("CONFIG");
  const { geo, legacy } = endpoints(config.host);
  const url = new URL(geo + (legacy ? "/v2/city/lookup" : "/geo/v2/city/lookup"));
  url.search = new URLSearchParams({ location: name, number: "6", lang: "zh" });
  authorize(url, legacy, config.key);
  const data = await request(url, controller, { headers: authHeaders(legacy, config.key) });
  const failure = apiError(data);
  if (failure) throw failure;
  return (Array.isArray(data.location) ? data.location : []).map(item => ({
    name: String(item.name || ""),
    latitude: num(item.lat),
    longitude: num(item.lon),
    admin1: item.adm1 || "",
    country: item.country || "",
    timezone: item.tz || "",
    qid: item.id || "",
  })).filter(validCity);
}

async function qweatherForecast(city, config, controller) {
  if (!config.host || !config.key) throw new Error("CONFIG");
  const { weather, legacy } = endpoints(config.host);
  const location = city.qid || (city.longitude + "," + city.latitude);
  const nowUrl = new URL(weather + "/v7/weather/now");
  nowUrl.search = new URLSearchParams({ location, lang: "zh", unit: "m" });
  const daysUrl = new URL(weather + "/v7/weather/7d");
  daysUrl.search = new URLSearchParams({ location, lang: "zh", unit: "m" });
  authorize(nowUrl, legacy, config.key);
  authorize(daysUrl, legacy, config.key);
  const headers = authHeaders(legacy, config.key);
  const [nowData, daysData] = await Promise.all([
    request(nowUrl, controller, { headers }),
    request(daysUrl, controller, { headers }),
  ]);
  const failure = apiError(nowData) || apiError(daysData);
  if (failure) throw failure;
  const now = nowData.now || {};
  const daily = Array.isArray(daysData.daily) ? daysData.daily : [];
  const today = daily[0] || {};
  const current = num(now.temp), high = num(today.tempMax), low = num(today.tempMin);
  if (![current, high, low].every(Number.isFinite)) throw new Error("和风天气返回的预报不完整。");
  return {
    city: cityId(city), fetched: Date.now(), current, high, low,
    source: SOURCE, summary: now.text || "",
    time: now.obsTime || nowData.updateTime || "",
    humidity: num(now.humidity), pressure: num(now.pressure),
    windSpeed: num(now.windSpeed), windDirection: num(now.wind360),
    days: daily.map(day => ({ date: day.fxDate, high: num(day.tempMax), low: num(day.tempMin),
      summary: day.textDay || day.textNight || "" })),
  };
}

function matchesCache(cache, city) {
  return cache?.city === cityId(city) && [cache.fetched, cache.current, cache.high, cache.low].every(Number.isFinite);
}

export function mountWeather(root) {
  root.classList.add("weather-widget");
  root.innerHTML = `
    <div class="weather-overview" hidden>
      <div class="weather-location"><strong></strong><button type="button" class="weather-change">切换城市</button></div>
      <div class="weather-reading" hidden>
        <strong class="weather-temperature"></strong>
        <div><span class="weather-condition"></span><span class="weather-range"></span></div>
      </div>
      <div class="weather-meta"><span class="weather-stamp"></span><button type="button" class="weather-refresh">刷新</button></div>
      <details class="weather-details" hidden><summary>天气预报</summary>
        <label class="weather-unit-label">温度单位 <select class="weather-unit" aria-label="温度单位"><option value="C">摄氏度 °C</option><option value="F">华氏度 °F</option></select></label>
        <p class="weather-atmosphere"></p><ul class="weather-days"></ul>
      </details>
    </div>
    <div class="weather-picker" hidden>
      <form class="weather-form" novalidate><input type="search" autocomplete="off" aria-label="城市名称" placeholder="输入城市名或拼音" required><button type="submit">搜索</button></form>
      <p class="weather-prompt">选择城市，查看当地天气。</p>
      <div class="weather-saved" hidden></div>
      <p class="weather-help" role="status" hidden></p>
      <ul class="weather-results" aria-label="匹配的城市" hidden></ul>
      <button type="button" class="weather-cancel" hidden>取消</button>
    </div>
    <p class="weather-status" role="status" hidden></p>
    <div class="weather-credit" hidden><a class="weather-source" href="https://www.qweather.com/" target="_blank" rel="noopener noreferrer">和风天气</a></div>`;

  const get = (selector) => root.querySelector(selector);
  const overview = get(".weather-overview"), picker = get(".weather-picker"), reading = get(".weather-reading");
  const form = get(".weather-form"), input = get(".weather-form input"), list = get(".weather-results");
  const status = get(".weather-status"), help = get(".weather-help"), refreshButton = get(".weather-refresh");
  const cancel = get(".weather-cancel"), credit = get(".weather-credit");
  let city, cached, forecastRequest, searchRequest;
  let unit = "C", cities = [];
  let active = true;
  const temp = value => Math.round(unit === "F" ? value * 9 / 5 + 32 : value);
  function showSaved() {
    const box = get(".weather-saved");
    box.replaceChildren();
    for (const record of cities) {
      const button = document.createElement("button"), remove = document.createElement("button");
      const pair = document.createElement("span");
      button.type = remove.type = "button";
      button.textContent = record.name;
      button.title = [record.name, details(record)].filter(Boolean).join(" · ");
      button.onclick = () => chooseCity(record);
      remove.textContent = "×";
      remove.setAttribute("aria-label", "从已存城市移除" + record.name);
      remove.onclick = async () => {
        const next = cities.filter(c => cityId(c) !== cityId(record));
        try { await write(CITIES_KEY, next); cities = next; showSaved(); }
        catch { message(help, "城市列表未能保存。"); }
      };
      pair.append(button);
      if (record !== cities[0]) {
        const pin = document.createElement("button");
        pin.type = "button"; pin.textContent = "↑"; pin.setAttribute("aria-label", "置顶城市" + record.name);
        pin.onclick = async () => {
          const next = [record, ...cities.filter(other => cityId(other) !== cityId(record))];
          try { await write(CITIES_KEY, next); cities = next; showSaved(); }
          catch { message(help, "城市顺序未能保存。"); }
        };
        pair.append(pin);
      }
      pair.append(remove); box.append(pair);
    }
    box.hidden = !cities.length;
  }

  function message(target, text) {
    target.textContent = text;
    target.hidden = !text;
  }

  function showPicker(open) {
    searchRequest?.abort();
    searchRequest = null;
    overview.hidden = !city || open;
    picker.hidden = !open;
    cancel.hidden = !city;
    list.replaceChildren();
    list.hidden = true;
    message(help, "");
    credit.hidden = true;
    status.hidden = open || !status.textContent;
    if (open) {
      showSaved();
      input.value = "";
      get(".weather-prompt").textContent = city ? "选择新的天气城市。" : "选择城市，查看当地天气。";
    }
  }

  function display() {
    get(".weather-location strong").textContent = city.name;
    get(".weather-location strong").title = [city.name, details(city)].filter(Boolean).join(" · ");
    reading.hidden = !cached;
    get(".weather-details").hidden = !cached;
    const stamp = get(".weather-stamp");
    stamp.textContent = "";
    if (!cached) return;
    get(".weather-temperature").textContent = temp(cached.current) + "°" + unit;
    get(".weather-condition").textContent = cached.summary || "天气状况未知";
    get(".weather-range").textContent = `最高 ${temp(cached.high)}° · 最低 ${temp(cached.low)}°`;
    get(".weather-unit").value = unit;
    const atmosphere = [];
    if (Number.isFinite(cached.humidity)) atmosphere.push("相对湿度 " + cached.humidity + "%");
    if (Number.isFinite(cached.pressure)) atmosphere.push("气压 " + Math.round(cached.pressure) + " hPa");
    if (Number.isFinite(cached.windSpeed)) {
      const points=["北","东北","东","东南","南","西南","西","西北"];
      const direction=Number.isFinite(cached.windDirection)?points[(Math.round(cached.windDirection/45)%8+8)%8]:"";
      atmosphere.push((direction?direction+"风 ":"风速 ")+Math.round(cached.windSpeed)+" km/h");
    }
    get(".weather-atmosphere").textContent = atmosphere.join(" · ");
    get(".weather-days").replaceChildren(...(cached.days || []).filter(day => Number.isFinite(day.high) && Number.isFinite(day.low)).map(day => {
      const row = document.createElement("li");
      const date = document.createElement("span"), condition = document.createElement("span"), range = document.createElement("span");
      date.textContent = String(day.date).slice(5).replace("-", "/"); condition.textContent = day.summary || "";
      range.textContent = temp(day.low) + "° – " + temp(day.high) + "°";
      row.append(date, condition, range); return row;
    }));
    const time = new Date(cached.fetched).toLocaleString("zh-CN", {month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false});
    stamp.textContent = time + " 更新";
    stamp.title = cached.time ? "预报当地时间 " + cached.time.replace("T", " ") : "";
    if (picker.hidden) credit.hidden = false;
  }

  async function loadForecast() {
    forecastRequest?.abort();
    const controller = new AbortController();
    forecastRequest = controller;
    refreshButton.disabled = true;
    const config = await weatherConfig();
    if (!active || forecastRequest !== controller) return;
    if (!config.host || !config.key) {
      refreshButton.disabled = false;
      message(status, CONFIG_HINT);
      status.hidden = false;
      return;
    }
    message(status, "正在更新天气…");
    status.hidden = !picker.hidden;
    try {
      const forecast = await qweatherForecast(city, config, controller);
      if (!active || forecastRequest !== controller) return;
      cached = forecast;
      display();
      message(status, "");
      try {
        await write(CACHE_KEY, cached);
      } catch {
        if (active && forecastRequest === controller) message(status, "本次天气未能缓存。");
      }
    } catch (error) {
      if (!active || forecastRequest !== controller) return;
      message(status, errorText(error, cached ? "更新失败，显示上次保存的天气。" : "暂时无法获取天气，请稍后刷新。"));
    } finally {
      if (active && forecastRequest === controller) {
        refreshButton.disabled = false;
        status.hidden = !picker.hidden || !status.textContent;
      }
    }
  }

  async function chooseCity(nextCity) {
    forecastRequest?.abort();
    forecastRequest = null;
    if (!cached || !matchesCache(cached, nextCity)) cached = null;
    city = nextCity;
    showPicker(false);
    display();
    get(".weather-change").focus();
    const loading = loadForecast();
    try {
      await write(CITY_KEY, nextCity);
      const saved = await read(CITIES_KEY);
      const previous = Array.isArray(saved) ? saved.filter(validCity) : cities;
      const next = previous.some(item => cityId(item) === cityId(nextCity))
        ? previous.map(item => cityId(item) === cityId(nextCity) ? nextCity : item) : [...previous, nextCity];
      await write(CITIES_KEY, next); cities = next;
    } catch {
      await loading;
      if (active && city === nextCity) message(status, [status.textContent, "城市设置未能保存。"].filter(Boolean).join(" "));
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    searchRequest?.abort();
    searchRequest = null;
    list.hidden = true;
    list.replaceChildren();
    credit.hidden = true;
    const name = input.value.trim();
    if (name.length < 2) {
      message(help, "请输入至少两个字符的城市名或拼音。");
      input.focus();
      return;
    }
    const config = await weatherConfig();
    if (!active) return;
    if (!config.host || !config.key) {
      message(help, CONFIG_HINT);
      return;
    }
    const controller = new AbortController();
    searchRequest = controller;
    message(help, "正在搜索城市…");
    try {
      const results = await searchQWeather(name, config, controller);
      if (!active || searchRequest !== controller) return;
      message(help, results.length ? "请选择城市" : "没有找到匹配的城市，可以试试拼音或英文名。");
      for (const record of results) {
        const option = document.createElement("button");
        const title = document.createElement("strong"), detail = document.createElement("span");
        title.textContent = record.name;
        detail.textContent = details(record);
        option.type = "button";
        option.append(title, detail);
        option.addEventListener("click", () => chooseCity(record));
        const li = document.createElement("li");
        li.append(option);
        list.append(li);
      }
      list.hidden = !results.length;
      credit.hidden = !results.length;
    } catch (error) {
      if (active && searchRequest === controller) message(help, errorText(error, "城市搜索失败，请检查网络后重试。"));
    }
  });
  input.addEventListener("input", () => {
    searchRequest?.abort();
    searchRequest = null;
    list.hidden = credit.hidden = true;
    list.replaceChildren();
    message(help, "");
  });
  get(".weather-change").addEventListener("click", () => { showPicker(true); input.focus(); });
  cancel.addEventListener("click", () => { showPicker(false); get(".weather-change").focus(); });
  refreshButton.addEventListener("click", loadForecast);
  get(".weather-unit").addEventListener("change", async event => {
    const previous = unit;
    unit = event.target.value === "F" ? "F" : "C"; display();
    try { await write(UNIT_KEY, unit); }
    catch { unit = previous; display(); message(status, "温度单位未能保存。"); }
  });

  async function configChanged() {
    if (!active) return;
    const config = await weatherConfig();
    if (!active) return;
    if (!config.host || !config.key) {
      if (city) { message(status, CONFIG_HINT); status.hidden = false; }
      else message(help, CONFIG_HINT);
      return;
    }
    if (!city) { message(help, ""); return; }
    message(status, "");
    loadForecast();
  }
  const onStorage = (changes, area) => {
    if (area === "local" && (HOST_KEY in changes || API_KEY in changes)) configChanged().catch(() => {});
  };
  if (globalThis.chrome?.storage?.onChanged) chrome.storage.onChanged.addListener(onStorage);
  window.addEventListener("daybreak:weather-config", configChanged);

  async function init() {
    const [saved, last, preferred, savedCities] = await Promise.all([CITY_KEY, CACHE_KEY, UNIT_KEY, CITIES_KEY].map(key => read(key).catch(() => null)));
    if (!active) return;
    unit = preferred === "F" ? "F" : "C";
    cities = Array.isArray(savedCities) ? savedCities.filter(validCity) : validCity(saved) ? [saved] : [];
    if (!validCity(saved)) {
      showPicker(true);
      const config = await weatherConfig();
      if (active && (!config.host || !config.key)) message(help, CONFIG_HINT);
      return;
    }
    city = saved;
    cached = matchesCache(last, city) ? last : null;
    showPicker(false);
    display();
    if (!navigator.onLine && cached) message(status, "当前离线，显示上次保存的天气。");
    else if (!cached || Date.now() - cached.fetched >= FRESH_FOR) loadForecast();
  }
  init();
  return () => {
    active = false;
    forecastRequest?.abort();
    searchRequest?.abort();
    if (globalThis.chrome?.storage?.onChanged) chrome.storage.onChanged.removeListener(onStorage);
    window.removeEventListener("daybreak:weather-config", configChanged);
    root.replaceChildren();
    root.classList.remove("weather-widget");
  };
}