const CITY_KEY = "daybreak.weather.city";
const CACHE_KEY = "daybreak.weather.forecast";
const UNIT_KEY = "daybreak.weather.unit";
const CITIES_KEY = "daybreak.weather.cities";
const FRESH_FOR = 30 * 60 * 1000;
const labels = {
  0: "晴", 1: "大部晴朗", 2: "局部多云", 3: "阴", 45: "雾", 48: "雾凇",
  51: "小毛毛雨", 53: "毛毛雨", 55: "强毛毛雨", 56: "冻毛毛雨", 57: "强冻毛毛雨",
  61: "小雨", 63: "中雨", 65: "大雨", 66: "小冻雨", 67: "强冻雨",
  71: "小雪", 73: "中雪", 75: "大雪", 77: "米雪",
  80: "小阵雨", 81: "阵雨", 82: "强阵雨", 85: "小阵雪", 86: "强阵雪",
  95: "雷暴", 96: "雷暴伴冰雹", 99: "强雷暴伴冰雹",
};
const wttrLabels = {
  113: "晴", 116: "局部多云", 119: "多云", 122: "阴", 143: "薄雾",
  176: "局部阵雨", 179: "局部阵雪", 182: "局部雨夹雪", 185: "局部冻毛毛雨",
  200: "可能有雷暴", 227: "吹雪", 230: "暴风雪", 248: "雾", 260: "冻雾",
  263: "局部毛毛雨", 266: "毛毛雨", 281: "冻毛毛雨", 284: "强冻毛毛雨",
  293: "局部小雨", 296: "小雨", 299: "间歇性中雨", 302: "中雨",
  305: "间歇性大雨", 308: "大雨", 311: "小冻雨", 314: "冻雨", 317: "轻微雨夹雪", 320: "雨夹雪",
  323: "局部小雪", 326: "小雪", 329: "局部中雪", 332: "中雪", 335: "局部大雪",
  338: "大雪", 350: "冰粒", 353: "小阵雨", 356: "强阵雨", 359: "暴阵雨",
  362: "阵性雨夹雪", 365: "强阵性雨夹雪", 368: "小阵雪", 371: "强阵雪",
  374: "阵性冰粒", 377: "强阵性冰粒", 386: "局部雷阵雨", 389: "强雷阵雨",
  392: "局部雷阵雪", 395: "强雷阵雪",
};

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

async function request(url, controller, timeoutMs = 12000) {
  const attempt = new AbortController();
  const abort = () => attempt.abort();
  controller.signal.throwIfAborted();
  controller.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(url, { signal: attempt.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error("Weather service unavailable");
    return await response.json();
  } finally {
    clearTimeout(timeout);
    controller.signal.removeEventListener("abort", abort);
  }
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

async function openMeteoForecast(city, controller) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: city.latitude, longitude: city.longitude, current: "temperature_2m,weather_code,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m",
    daily: "temperature_2m_max,temperature_2m_min,weather_code", timezone: "auto", forecast_days: 7,
  });
  const data = await request(url, controller, 12000);
  const current = data.current?.temperature_2m;
  const high = data.daily?.temperature_2m_max?.[0];
  const low = data.daily?.temperature_2m_min?.[0];
  if (![current, high, low].every(Number.isFinite)) throw new Error("Incomplete forecast");
  return {
    city: cityId(city), fetched: Date.now(), current, high, low,
    source: "Open-Meteo", summary: labels[data.current.weather_code], time: data.current.time,
    humidity: data.current.relative_humidity_2m, pressure: data.current.surface_pressure,
    windSpeed: data.current.wind_speed_10m,windDirection: data.current.wind_direction_10m,
    days: (data.daily.time || []).map((date, i) => ({date, high:data.daily.temperature_2m_max[i],
      low:data.daily.temperature_2m_min[i], summary:labels[data.daily.weather_code?.[i]] || ""})),
  };
}

async function wttrForecast(city, controller) {
  const url = new URL("https://wttr.in/" + cityId(city));
  url.search = new URLSearchParams({ format: "j1" });
  const data = await request(url, controller, 16000);
  const observation = data.current_condition?.[0];
  const localDate = city.timezone && new Intl.DateTimeFormat("sv-SE", {
    timeZone: city.timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const day = localDate ? data.weather?.find((entry) => entry.date === localDate) : data.weather?.[0];
  const values = [observation?.temp_C, day?.maxtempC, day?.mintempC];
  if (values.some((value) => value == null || String(value).trim() === "" || !Number.isFinite(Number(value)))) {
    throw new Error("Incomplete forecast");
  }
  const [current, high, low] = values.map(Number);
  return {
    city: cityId(city), fetched: Date.now(), current, high, low,
    source: "wttr.in", summary: wttrLabels[observation.weatherCode],
    humidity: Number(observation.humidity), pressure: Number(observation.pressure),
    windSpeed: parseFloat(observation.windspeedKmph),windDirection: parseFloat(observation.winddirDegree),
    days: (data.weather || []).map(entry => ({date:entry.date, high:Number(entry.maxtempC), low:Number(entry.mintempC),
      summary:wttrLabels[entry.hourly?.[4]?.weatherCode || entry.hourly?.[0]?.weatherCode] || ""})),
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
      <form class="weather-form"><input type="search" autocomplete="off" aria-label="城市名称" placeholder="输入城市名或拼音" required><button type="submit">搜索</button></form>
      <p class="weather-prompt">选择城市，查看当地天气。</p>
      <div class="weather-saved" hidden></div>
      <p class="weather-help" role="status" hidden></p>
      <ul class="weather-results" aria-label="匹配的城市" hidden></ul>
      <button type="button" class="weather-cancel" hidden>取消</button>
    </div>
    <p class="weather-status" role="status" hidden></p>
    <div class="weather-credit" hidden><a class="weather-source" href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a><span hidden> · <a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">GeoNames</a></span></div>`;

  const get = (selector) => root.querySelector(selector);
  const overview = get(".weather-overview"), picker = get(".weather-picker"), reading = get(".weather-reading");
  const form = get(".weather-form"), input = get(".weather-form input"), list = get(".weather-results");
  const status = get(".weather-status"), help = get(".weather-help"), refreshButton = get(".weather-refresh");
  const cancel = get(".weather-cancel"), credit = get(".weather-credit"), geoCredit = get(".weather-credit span");
  const sourceLink = get(".weather-source");
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

  function showSource(source) {
    const isWttr = source === "wttr.in";
    sourceLink.textContent = isWttr ? "wttr.in" : "Open-Meteo";
    sourceLink.href = isWttr ? "https://wttr.in/" : "https://open-meteo.com/";
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
    geoCredit.hidden = true;
    showSource(open ? "Open-Meteo" : cached?.source);
    credit.hidden = !cached || open;
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
    get(".weather-condition").textContent = cached.summary || labels[cached.code] || "天气状况未知";
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
    if (picker.hidden) {
      showSource(cached.source);
      credit.hidden = false;
    }
  }

  async function loadForecast() {
    forecastRequest?.abort();
    const controller = new AbortController();
    forecastRequest = controller;
    refreshButton.disabled = true;
    message(status, "正在更新天气…");
    status.hidden = !picker.hidden;
    const [first, backup] = cached?.source === "wttr.in"
      ? [wttrForecast, openMeteoForecast] : [openMeteoForecast, wttrForecast];
    try {
      let forecast;
      try {
        forecast = await first(city, controller);
      } catch {
        controller.signal.throwIfAborted();
        message(status, "正在尝试备用天气源…");
        status.hidden = !picker.hidden;
        forecast = await backup(city, controller);
      }
      if (!active || forecastRequest !== controller) return;
      cached = forecast;
      display();
      message(status, "");
      try {
        await write(CACHE_KEY, cached);
      } catch {
        if (active && forecastRequest === controller) message(status, "本次天气未能缓存。");
      }
    } catch {
      if (!active || forecastRequest !== controller) return;
      message(status, cached ? "更新失败，显示上次保存的天气。" : "暂时无法获取天气，请稍后刷新。");
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
    geoCredit.hidden = true;
    credit.hidden = true;
    const name = input.value.trim();
    if (name.length < 2) {
      message(help, "请输入至少两个字符的城市名或拼音。");
      input.focus();
      return;
    }
    const controller = new AbortController();
    searchRequest = controller;
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.search = new URLSearchParams({ name, count: 6, language: "zh", format: "json" });
    message(help, "正在搜索城市…");
    try {
      const data = await request(url, controller);
      if (!active || searchRequest !== controller) return;
      const cities = (data.results || []).filter(validCity);
      message(help, cities.length ? "请选择城市" : "没有找到匹配的城市，可以试试拼音或英文名。");
      for (const result of cities) {
        const option = document.createElement("button");
        const title = document.createElement("strong"), detail = document.createElement("span");
        const record = { name: result.name, latitude: result.latitude, longitude: result.longitude, admin1: result.admin1 || "", country: result.country || "", timezone: result.timezone || "" };
        title.textContent = record.name;
        detail.textContent = details(record);
        option.type = "button";
        option.append(title, detail);
        option.addEventListener("click", () => chooseCity(record));
        const li = document.createElement("li");
        li.append(option);
        list.append(li);
      }
      list.hidden = !cities.length;
      geoCredit.hidden = credit.hidden = !cities.length;
    } catch {
      if (active && searchRequest === controller) message(help, "城市搜索失败，请检查网络后重试。");
    }
  });
  input.addEventListener("input", () => {
    searchRequest?.abort();
    searchRequest = null;
    list.hidden = credit.hidden = geoCredit.hidden = true;
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

  async function init() {
    const [saved, last, preferred, savedCities] = await Promise.all([CITY_KEY, CACHE_KEY, UNIT_KEY, CITIES_KEY].map(key => read(key).catch(() => null)));
    if (!active) return;
    unit = preferred === "F" ? "F" : "C";
    cities = Array.isArray(savedCities) ? savedCities.filter(validCity) : validCity(saved) ? [saved] : [];
    if (!validCity(saved)) { showPicker(true); return; }
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
    root.replaceChildren();
    root.classList.remove("weather-widget");
  };
}
