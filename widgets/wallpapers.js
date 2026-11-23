const base = "daybreak.wallpaper.";
const info = base + "photo.";
const imageKey = base + "image.";
const albumKey = base + "album.";
const prefTheme = "daybreak.pref.theme";
const prefImage = "daybreak.pref.customImage";
const builtin = "builtin", personal = "personal";
const bingOrigin = "https://www.bing.com";
const configKeys = ["album", "rotation", "order", "current", "rotated", "bing", "lastAttempt", "bingStatus"];
const presets = [
  {id:"lake", title:"湖光", theme:"lake"}, {id:"pine", title:"松林", theme:"pine"}, {id:"paper", title:"米纸", theme:"paper"}
];
const storage = globalThis.chrome?.storage?.local;
async function get(keys) {
  if (storage) return storage.get(keys);
  const result = {};
  for (const key of keys) {
    const item = localStorage.getItem(key);
    if (item !== null) { try { result[key] = JSON.parse(item); } catch { /* Ignore malformed records. */ } }
  }
  return result;
}
async function set(values) {
  if (storage) await storage.set(values);
  else for (const [key,value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value));
}
async function remove(keys) {
  if (storage) await storage.remove(keys);
  else for (const key of keys) localStorage.removeItem(key);
}
async function allKeys() {
  if (storage) return storage.getKeys ? storage.getKeys() : Object.keys(await storage.get(null));
  return Object.keys(localStorage);
}
async function config() {
  const data = await get(configKeys.map(key => base + key));
  const c = Object.fromEntries(configKeys.map(key => [key, data[base + key]]));
  return {...c, album:c.album || builtin, rotation:c.rotation || "off", order:c.order || "next"};
}
// Bing is the default until the user explicitly turns it off or applies another background.
function bingOn(c) { return c.bing !== false; }
async function catalog() {
  const keys = (await allKeys()).filter(key => key.startsWith(info) || key.startsWith(albumKey));
  const records = Object.entries(await get(keys));
  const photos = records.filter(([key,value]) => key.startsWith(info) && value?.id).map(([,value]) => value)
    .sort((a,b) => a.created-b.created || a.id.localeCompare(b.id));
  const albums = [{id:builtin, title:"内置背景"}, {id:personal, title:"我的图片"},
    ...records.filter(([key,value]) => key.startsWith(albumKey) && value?.id).map(([,value]) => value).sort((a,b) => a.created-b.created)];
  return {photos, albums};
}
function locked(action) {
  return globalThis.navigator?.locks ? navigator.locks.request("daybreak.wallpapers", action) : action();
}
function today() {
  const d = new Date();
  return [d.getFullYear(),d.getMonth()+1,d.getDate()].join("-");
}
function photosOf(album, photos) { return album === builtin ? presets : photos.filter(photo => photo.album === album); }
function assetUrl(file) { return globalThis.chrome?.runtime?.getURL ? chrome.runtime.getURL(file) : new URL("../" + file, import.meta.url).href; }

async function renderImage(file, withThumb) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = objectUrl; await image.decode();
    function scaled(limit, quality) {
      const ratio = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth*ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight*ratio));
      const ctx = canvas.getContext("2d", {alpha:false});
      ctx.fillStyle = "#ebe5d8"; ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(image,0,0,canvas.width,canvas.height);
      return canvas.toDataURL("image/webp", quality);
    }
    return {data:scaled(1920,0.84), thumb:withThumb ? scaled(160,0.67) : undefined};
  } finally { URL.revokeObjectURL(objectUrl); }
}
async function usePhoto(photo, album, extra = {}) {
  const values = {[base+"album"]:album,[base+"current"]:photo.id,[base+"rotated"]:Date.now(),[base+"bing"]:false,
    [prefTheme]:photo.theme || "custom", ...extra};
  if (!photo.theme) {
    const key = imageKey + photo.id;
    const data = (await get([key]))[key];
    if (typeof data !== "string" || !data.startsWith("data:image/")) throw new Error("这张图片无法读取，请重新导入。");
    values[prefImage] = data;
  }
  await set(values);
  return {ok:true, message:"已切换到“" + photo.title + "”"};
}
async function rotate(c, order = c.order) {
  const photos = photosOf(c.album, (await catalog()).photos);
  if (!photos.length) return {ok:false, message:"当前相册没有图片，请先添加图片。"};
  let current = c.current;
  if (c.album === builtin) current = (await get([prefTheme]))[prefTheme] || "lake";
  let index = (photos.findIndex(photo => photo.id === current) + 1) % photos.length;
  if (order === "random") {
    const pool = photos.length > 1 ? photos.filter(photo => photo.id !== current) : photos;
    index = photos.indexOf(pool[Math.floor(Math.random()*pool.length)]);
  }
  return usePhoto(photos[index], c.album);
}
function bingPermission() {
  return globalThis.chrome?.permissions ? chrome.permissions.request({origins:[bingOrigin + "/*"]}) : Promise.resolve(true);
}
async function requestBing(url) {
  const response = await fetch(url, {credentials:"omit", referrerPolicy:"no-referrer", signal:AbortSignal.timeout(11000)});
  if (!response.ok || new URL(response.url || url).origin !== bingOrigin) throw new Error("Bing 请求失败");
  return response;
}
async function showBing(force) {
  const cacheKey = base+"bingCache";
  let cache = (await get([cacheKey]))[cacheKey];
  const day = today();
  let status;
  if (force || !cache?.data || cache.day !== day) {
    try {
      const feed = await requestBing(bingOrigin+"/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN");
      const item = (await feed.json()).images?.[0];
      if (!item?.url) throw new Error("缺少当天壁纸");
      const url = new URL(item.url, bingOrigin);
      if (url.origin !== bingOrigin) throw new Error("图片来源无效");
      const response = await requestBing(url.href);
      const {data} = await renderImage(await response.blob(), false);
      cache = {day, date:item.startdate, title:item.title || "Bing 每日壁纸", credit:item.copyright || "", data};
      status = "已更新 Bing 每日壁纸";
    } catch {
      status = cache?.data ? "Bing 暂时无法连接，当前使用上次缓存的壁纸。" : "Bing 暂时无法连接，当前背景已保留。";
      if (!cache?.data) {
        await set({[base+"bing"]:true,[base+"bingStatus"]:status,[base+"lastAttempt"]:Date.now()});
        return {ok:false, message:status};
      }
    }
  } else status = "正在使用 Bing 每日壁纸";
  const values = {[base+"bing"]:true,[base+"bingStatus"]:status,[base+"lastAttempt"]:Date.now(),
    [base+"current"]:"bing",[prefTheme]:"custom",[prefImage]:cache.data};
  if (!status.includes("暂时无法连接")) values[cacheKey] = cache;
  await set(values);
  return {ok:true, message:status};
}

export async function nextWallpaper(order) {
  try { return await locked(async () => rotate(await config(), order)); }
  catch (e) { return {ok:false, message:e.message || "壁纸切换失败，请重试。"}; }
}

// Picking a built-in or personal background opts out of the Bing daily default.
export async function disableBing() {
  await set({[base+"bing"]: false});
}

export function initializeWallpaperRotation() {
  async function tick(isNew) {
    try {
      await locked(async () => {
        const c = await config();
        if (bingOn(c)) {
          const last = new Date(c.lastAttempt || 0);
          const newDate = last.toDateString() !== new Date().toDateString();
          const retry = c.bingStatus?.includes("暂时无法连接") && Date.now()-last.getTime()>15*60000;
          if (newDate || retry) await showBing(false);
          return;
        }
        const elapsed = Date.now()-(c.rotated || 0);
        if ((isNew && c.rotation === "tab") || (c.rotation === "hour" && elapsed >= 3600000) ||
          (c.rotation === "day" && new Date(c.rotated || 0).toDateString() !== new Date().toDateString())) await rotate(c);
      });
    } catch { /* A later visible tab retries the rotation. */ }
  }
  tick(true);
  const onVisible = () => { if (!document.hidden) tick(false); };
  document.addEventListener("visibilitychange", onVisible);
  const timer = setInterval(onVisible, 60000);
  return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
}

async function downloadCurrent() {
  const vals = await get([prefImage,prefTheme]);
  const theme = vals[prefTheme] || "lake";
  if (theme !== "lake" && theme !== "custom") throw new Error("当前是纯色背景，没有图片可下载。");
  const src = theme === "lake" ? assetUrl("assets/lake.webp") : vals[prefImage];
  if (!src) throw new Error("当前图片无法读取。");
  const a = document.createElement("a");
  const type = src.match(/^data:image\/(jpeg|png|webp);/i)?.[1] || "webp";
  a.href = src; a.download = "晨屿壁纸-" + today() + "." + (type === "jpeg" ? "jpg" : type);
  document.body.append(a); a.click(); a.remove();
}

export function mountWallpapers(root) {
  root.innerHTML = `<section class="wallpaper-panel" aria-label="壁纸图库">
    <h2>壁纸图库</h2><div class="wallpaper-toolbar">
      <label>相册 <select class="wallpaper-albums"></select></label>
      <button type="button" data-action="album">新建相册</button><button type="button" data-action="remove-album" hidden>移除相册</button>
      <button type="button" data-action="upload">添加图片</button><input type="file" accept="image/*" class="wallpaper-upload" multiple hidden>
    </div><div class="wallpaper-grid"></div>
    <div class="wallpaper-controls"><label>自动轮换 <select class="wallpaper-rotation"><option value="off">关闭</option>
      <option value="tab">每个新标签页</option><option value="hour">每小时</option><option value="day">每天</option></select></label>
      <label>轮换顺序 <select class="wallpaper-order"><option value="next">顺序</option><option value="random">随机</option></select></label>
    </div><div class="wallpaper-toolbar"><button type="button" data-action="next">下一张</button><button type="button" data-action="random">随机一张</button><button type="button" data-action="download">下载当前壁纸</button></div>
    <div class="wallpaper-bing"><label><input type="checkbox" class="wallpaper-bing-switch"> Bing 每日壁纸</label><button type="button" data-action="bing" hidden>刷新今日壁纸</button>
      <p class="wallpaper-credit" hidden></p></div><p class="wallpaper-status" role="status"></p>
  </section>`;
  const child = s => root.querySelector(s);
  const button = action => child('[data-action="' + action + '"]');
  const selector = child(".wallpaper-albums"), grid = child(".wallpaper-grid");
  const status = child(".wallpaper-status"), upload = child(".wallpaper-upload"), bing = child(".wallpaper-bing-switch");
  let generation = 0, active = true, pending = false;
  function message(msg) { if (active) status.textContent = msg; }
  async function action(fn) {
    try { const result = await fn(); if (result?.message) message(result.message); }
    catch (e) { message(e.message || "操作失败，请重试。"); }
  }
  async function redraw() {
    const serial = ++generation;
    try {
      const [c, {photos,albums}, prefs] = await Promise.all([config(), catalog(), get([prefTheme])]);
      const cache = bingOn(c) ? (await get([base+"bingCache"]))[base+"bingCache"] : null;
      if (!active || serial !== generation) return;
      selector.replaceChildren(...albums.map(album => new Option(album.title, album.id)));
      selector.value = albums.some(a=>a.id===c.album) ? c.album : personal;
      button("remove-album").hidden = [builtin,personal].includes(selector.value);
      child(".wallpaper-rotation").value = c.rotation;
      child(".wallpaper-order").value = c.order;
      bing.checked = bingOn(c); button("bing").hidden = !bingOn(c);
      const credit = child(".wallpaper-credit");
      credit.textContent = bingOn(c) ? [c.bingStatus,cache?.title,cache?.credit].filter(Boolean).join(" · ") : "";
      credit.hidden = !credit.textContent;
      const gallery = photosOf(selector.value, photos);
      grid.replaceChildren();
      for (const photo of gallery) {
        const card = document.createElement("div"); card.className = "wallpaper-card";
        const apply = document.createElement("button"); apply.type = "button"; apply.className = "wallpaper-photo";
        const theme = prefs[prefTheme] || "lake";
        apply.setAttribute("aria-pressed", String(!bingOn(c) && (photo.theme ? theme === photo.theme : theme === "custom" && c.current === photo.id)));
        const plate = document.createElement("span"); plate.className = "wallpaper-thumbnail";
        if (photo.theme) plate.dataset.theme = photo.theme;
        else {
          const img = document.createElement("img"); img.loading = "lazy"; img.src = photo.thumb; img.alt = ""; plate.append(img);
        }
        const title = document.createElement("span"); title.textContent = photo.title; title.title = photo.title;
        apply.append(plate,title); apply.onclick = () => localAction(() => locked(() => usePhoto(photo,selector.value)));
        card.append(apply);
        if (!photo.theme) {
          const del = document.createElement("button"); del.type="button"; del.className="wallpaper-remove"; del.textContent="×";
          del.setAttribute("aria-label","移除图片 " + photo.title);
          del.onclick = () => { if (window.confirm("从相册移除“" + photo.title + "”？")) localAction(() => remove([info+photo.id,imageKey+photo.id])); };
          card.append(del);
        }
        grid.append(card);
      }
      if (!gallery.length) grid.textContent = "相册中还没有图片。";
    } catch { if (active && serial === generation) message("图库读取失败，请重试。"); }
  }
  function changed(changes, area) {
    if (area !== "local" || !Object.keys(changes).some(k=>k.startsWith(base) || k === prefTheme)) return;
    scheduleRedraw();
  }
  function scheduleRedraw() {
    if (pending) return;
    pending = true;
    queueMicrotask(() => { pending = false; if (active) redraw(); });
  }
  const previewChanged = event => { if (!event.key || event.key.startsWith(base) || event.key === prefTheme) scheduleRedraw(); };
  if (storage) chrome.storage.onChanged.addListener(changed);
  else window.addEventListener("storage",previewChanged);
  function localAction(fn) { return action(async () => { const result = await fn(); if (!storage) scheduleRedraw(); return result; }); }
  selector.onchange = () => localAction(() => set({[base+"album"]:selector.value}));
  child(".wallpaper-rotation").onchange = event => localAction(() => set({[base+"rotation"]:event.target.value,[base+"rotated"]:Date.now(),[base+"bing"]:false}));
  child(".wallpaper-order").onchange = event => localAction(() => set({[base+"order"]:event.target.value}));
  button("album").onclick = () => {
    const title = window.prompt("新相册名称")?.trim(); if (!title) return;
    const id = crypto.randomUUID(); localAction(() => set({[albumKey+id]:{id,title,created:Date.now()},[base+"album"]:id}));
  };
  button("remove-album").onclick = () => {
    const id = selector.value;
    if ([personal,builtin].includes(id) || !window.confirm("移除相册，并将其中的图片保留在“我的图片”？")) return;
    localAction(() => locked(async () => {
      const {photos} = await catalog();
      const records = Object.fromEntries(photos.filter(p=>p.album===id).map(p=>[info+p.id,{...p,album:personal}]));
      await set({...records,[base+"album"]:personal});
      await remove([albumKey+id]);
    }));
  };
  button("upload").onclick = () => upload.click();
  upload.onchange = () => {
    const files = [...upload.files], album = selector.value === builtin ? personal : selector.value;
    upload.value = ""; if (!files.length) return;
    localAction(async () => {
      button("upload").disabled = true;
      let saved = 0;
      try {
        for (const file of files) {
          try {
            const {data,thumb} = await renderImage(file,true); const id = crypto.randomUUID();
            await locked(async () => {
              const exists = album===personal || !!(await get([albumKey+album]))[albumKey+album];
              const target = exists ? album : personal;
              await set({[info+id]:{id,title:file.name,album:target,thumb,created:Date.now()},[imageKey+id]:data,[base+"album"]:target});
            });
            saved++;
          } catch { /* Keep other successfully imported images. */ }
        }
        message("已添加 " + saved + " 张图片" + (saved<files.length ? "，" + (files.length-saved) + " 张未能导入。" : "。"));
      } finally { button("upload").disabled = false; }
    });
  };
  button("next").onclick = () => localAction(() => nextWallpaper("next"));
  button("random").onclick = () => localAction(() => nextWallpaper("random"));
  button("download").onclick = () => action(downloadCurrent);
  bing.onchange = () => {
    if (!bing.checked) { localAction(() => set({[base+"bing"]:false})); return; }
    const permission = bingPermission();
    localAction(async () => {
      if (!await permission) { bing.checked = false; message("启用 Bing 壁纸需要允许访问 www.bing.com。"); return; }
      message("正在获取 Bing 今日壁纸…");
      return locked(() => showBing(false));
    });
  };
  button("bing").onclick = () => localAction(() => locked(() => showBing(true)));
  redraw();
  return () => {
    active = false;
    if (storage) chrome.storage.onChanged.removeListener(changed);
    else window.removeEventListener("storage",previewChanged);
  };
}
