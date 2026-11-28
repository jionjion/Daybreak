import { encodeImageBlob, isDataImage } from "../shared/image.js";
import { confirmDialog, promptDialog } from "../shared/modal.js";
import { getAllKeys, getValues, onStorageChange, removeKeys, setValues } from "../shared/storage.js";

const base = "daybreak.wallpaper.";
const info = base + "photo.";
const imageKey = base + "image.";
const albumKey = base + "album.";
const prefTheme = "daybreak.pref.theme";
const prefImage = "daybreak.pref.customImage";
const builtin = "builtin";
const personal = "personal";
const bingOrigin = "https://www.bing.com";
// Rolling cache: metadata list (newest first) plus one full image per date.
const bingDaysKey = base + "bingDays";
const bingImageKey = base + "bingImage.";
const bingFetchedKey = base + "bingFetched";
const bingHiddenKey = base + "bingHidden"; // dates the user deleted; skipped on refetch
const bingCacheKey = base + "bingCache"; // 1.1.x single-day cache, migrated below
const configKeys = ["album", "rotation", "order", "current", "rotated", "bing", "lastAttempt", "bingStatus", "bingDay"];
const presets = [
  { id: "lake", title: "湖光", theme: "lake" },
  { id: "pine", title: "松林", theme: "pine" },
  { id: "paper", title: "米纸", theme: "paper" },
];

async function config() {
  const data = await getValues(configKeys.map(key => base + key));
  const c = Object.fromEntries(configKeys.map(key => [key, data[base + key]]));
  return { ...c, album: c.album || builtin, rotation: c.rotation || "off", order: c.order || "next" };
}

// Bing is the default until the user explicitly turns it off or applies another background.
function bingOn(c) {
  return c.bing !== false;
}

async function catalog() {
  const keys = (await getAllKeys()).filter(key => key.startsWith(info) || key.startsWith(albumKey));
  const records = Object.entries(await getValues(keys));
  const photos = records
    .filter(([key, value]) => key.startsWith(info) && value?.id)
    .map(([, value]) => value)
    .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
  const albums = [
    { id: builtin, title: "内置背景" },
    { id: personal, title: "我的图片" },
    ...records
      .filter(([key, value]) => key.startsWith(albumKey) && value?.id)
      .map(([, value]) => value)
      .sort((a, b) => a.created - b.created),
  ];
  return { photos, albums };
}

function locked(action) {
  return globalThis.navigator?.locks ? navigator.locks.request("daybreak.wallpapers", action) : action();
}

function today() {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].join("-");
}

function photosOf(album, photos) {
  return album === builtin ? presets : photos.filter(photo => photo.album === album);
}

function assetUrl(file) {
  return globalThis.chrome?.runtime?.getURL
    ? chrome.runtime.getURL(file)
    : new URL("../" + file, import.meta.url).href;
}

async function renderImage(file, withThumb) {
  return encodeImageBlob(file, {
    maxSize: 1920,
    quality: 0.84,
    background: "#ebe5d8",
    thumbSize: withThumb ? 160 : 0,
    thumbQuality: 0.67,
  });
}

async function usePhoto(photo, album, extra = {}) {
  const values = {
    [base + "album"]: album,
    [base + "current"]: photo.id,
    [base + "rotated"]: Date.now(),
    [base + "bing"]: false,
    [prefTheme]: photo.theme || "custom",
    ...extra,
  };
  if (!photo.theme) {
    const key = imageKey + photo.id;
    const data = (await getValues([key]))[key];
    if (!isDataImage(data)) throw new Error("这张图片无法读取，请重新导入。");
    values[prefImage] = data;
  }
  await setValues(values);
  return { ok: true, message: "已切换到“" + photo.title + "”" };
}

async function rotate(c, order = c.order) {
  const photos = photosOf(c.album, (await catalog()).photos);
  if (!photos.length) return { ok: false, message: "当前相册没有图片，请先添加图片。" };
  let current = c.current;
  if (c.album === builtin) current = (await getValues([prefTheme]))[prefTheme] || "lake";
  let index = (photos.findIndex(photo => photo.id === current) + 1) % photos.length;
  if (order === "random") {
    const pool = photos.length > 1 ? photos.filter(photo => photo.id !== current) : photos;
    index = photos.indexOf(pool[Math.floor(Math.random() * pool.length)]);
  }
  return usePhoto(photos[index], c.album);
}

async function requestBing(url) {
  const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(11000) });
  if (!response.ok || new URL(response.url || url).origin !== bingOrigin) throw new Error("Bing 请求失败");
  return response;
}

function bingDateLabel(date) {
  const text = String(date || "");
  return text.length === 8 ? text.slice(0, 4) + "-" + text.slice(4, 6) + "-" + text.slice(6) : text;
}

async function bingImage(date) {
  const key = bingImageKey + date;
  const values = await getValues([key]);
  return typeof values[key] === "string" ? values[key] : "";
}

// Metadata list for the gallery strip; the legacy single-day cache is folded
// in so an upgrade keeps the current wallpaper browsable.
async function bingDays() {
  const values = await getValues([bingDaysKey, bingCacheKey, bingHiddenKey]);
  const hidden = new Set(Array.isArray(values[bingHiddenKey]) ? values[bingHiddenKey] : []);
  const days = Array.isArray(values[bingDaysKey])
    ? values[bingDaysKey].filter(day => day?.date && !hidden.has(day.date) && (day.thumb || day.data))
    : [];
  if (days.length) return days.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const legacy = values[bingCacheKey];
  const legacyDate = legacy?.date || legacy?.day || "";
  return legacy?.data && !hidden.has(legacyDate)
    ? [{ date: legacyDate, title: legacy.title || "Bing 每日壁纸", credit: legacy.credit || "", data: legacy.data }]
    : [];
}

// Ask Bing for the last seven days and download only the missing ones.
async function syncBingDays(cached, hidden) {
  const feed = await requestBing(bingOrigin + "/HPImageArchive.aspx?format=js&idx=0&n=7&mkt=zh-CN");
  const images = (await feed.json()).images;
  if (!Array.isArray(images) || !images.length) throw new Error("缺少当天壁纸");
  const known = new Map(cached.map(day => [day.date, day]));
  const listed = images.filter(item => item?.url && item.startdate);
  if (!listed.length) throw new Error("图片来源无效");
  const wanted = listed.filter(item => !hidden.has(item.startdate)).slice(0, 7);
  // Everything in the archive was deleted by the user; keep the cache empty.
  if (!wanted.length) return { meta: [], images: {}, feedDates: new Set(listed.map(item => item.startdate)) };
  const results = await Promise.all(wanted.map(async item => {
    const hit = known.get(item.startdate);
    if (hit?.thumb) return { meta: hit };
    const url = new URL(item.url, bingOrigin);
    if (url.origin !== bingOrigin) return null;
    try {
      const response = await requestBing(url.href);
      const { data, thumb } = await renderImage(await response.blob(), true);
      return {
        meta: { date: item.startdate, title: item.title || "Bing 每日壁纸", credit: item.copyright || "", thumb },
        image: { [bingImageKey + item.startdate]: data },
      };
    } catch {
      return null;
    }
  }));
  const days = results.filter(Boolean);
  if (!days.length) throw new Error("缺少当天壁纸");
  return {
    meta: days.map(day => day.meta).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 7),
    images: Object.assign({}, ...days.filter(day => day.image).map(day => day.image)),
    feedDates: new Set(listed.map(item => item.startdate)),
  };
}

async function pruneBingImages(meta) {
  const keep = new Set(meta.map(day => bingImageKey + day.date));
  const stale = (await getAllKeys()).filter(key => key.startsWith(bingImageKey) && !keep.has(key));
  if (stale.length) await removeKeys(stale);
}

async function showBing(force) {
  const day = today();
  const cached = await bingDays();
  const values = await getValues([bingFetchedKey, bingHiddenKey]);
  const fetched = values[bingFetchedKey];
  const hidden = new Set(Array.isArray(values[bingHiddenKey]) ? values[bingHiddenKey] : []);
  let days = cached;
  let status;
  if (force || !cached.length || fetched !== day) {
    try {
      // A forced refresh re-downloads the newest day, not all seven.
      const { meta, images, feedDates } = await syncBingDays(force && cached.length ? cached.slice(1) : cached, hidden);
      if (Object.keys(images).length) await setValues(images);
      days = meta;
      await setValues({ [bingFetchedKey]: day, [bingDaysKey]: days });
      await pruneBingImages(days);
      await removeKeys([bingCacheKey]);
      // Forget deletions whose image already dropped out of Bing's archive.
      const stillHidden = [...hidden].filter(date => feedDates.has(date));
      if (stillHidden.length !== hidden.size) await setValues({ [bingHiddenKey]: stillHidden });
      status = "已更新 Bing 每日壁纸";
    } catch {
      days = cached;
      status = cached.length ? "Bing 暂时无法连接，当前使用上次缓存的壁纸。" : "Bing 暂时无法连接，当前背景已保留。";
      if (!cached.length) {
        await setValues({ [base + "bing"]: true, [base + "bingStatus"]: status, [base + "lastAttempt"]: Date.now() });
        return { ok: false, message: status };
      }
    }
  } else {
    status = "正在使用 Bing 每日壁纸";
  }

  let latest = null;
  for (const record of days) {
    const data = record.data || await bingImage(record.date);
    if (data) {
      latest = { record, data };
      break;
    }
  }
  if (!latest) {
    await setValues({ [base + "bing"]: true, [base + "bingStatus"]: "Bing 壁纸缓存不可用。", [base + "lastAttempt"]: Date.now() });
    return { ok: false, message: "Bing 壁纸缓存不可用。" };
  }
  await setValues({
    [base + "bing"]: true,
    [base + "bingStatus"]: status,
    [base + "lastAttempt"]: Date.now(),
    [base + "bingDay"]: latest.record.date,
    [base + "current"]: "bing",
    [prefTheme]: "custom",
    [prefImage]: latest.data,
  });
  return { ok: true, message: status };
}

async function useBingDay(record) {
  const data = record.data || await bingImage(record.date);
  if (!data) throw new Error("这张 Bing 壁纸的缓存已失效。");
  await setValues({
    [base + "bing"]: true,
    [base + "bingDay"]: record.date,
    [base + "bingStatus"]: "正在使用 Bing 壁纸",
    [base + "lastAttempt"]: Date.now(),
    [base + "current"]: "bing",
    [prefTheme]: "custom",
    [prefImage]: data,
  });
  return { ok: true, message: "已切换到 " + bingDateLabel(record.date) + " 的 Bing 壁纸" };
}

async function deleteBingDay(record) {
  const c = await config();
  const values = await getValues([bingDaysKey, bingHiddenKey]);
  const list = Array.isArray(values[bingDaysKey]) ? values[bingDaysKey].filter(day => day.date !== record.date) : [];
  const hidden = new Set(Array.isArray(values[bingHiddenKey]) ? values[bingHiddenKey] : []);
  if (record.date) hidden.add(record.date);
  await setValues({ [bingDaysKey]: list, [bingHiddenKey]: [...hidden] });
  // Deleted days stay deleted: Bing keeps listing them for a week.
  await removeKeys([bingImageKey + record.date, bingCacheKey]);

  if (c.current === "bing" && c.bingDay === record.date) {
    let fallback = null;
    for (const candidate of list) {
      const data = candidate.data || await bingImage(candidate.date);
      if (data) {
        fallback = { candidate, data };
        break;
      }
    }
    if (fallback) {
      await setValues({
        [base + "bingDay"]: fallback.candidate.date,
        [base + "bingStatus"]: "正在使用 Bing 壁纸",
        [prefTheme]: "custom",
        [prefImage]: fallback.data,
      });
    } else {
      await setValues({
        [base + "bingDay"]: "",
        [base + "current"]: "lake",
        [prefTheme]: "lake",
        [prefImage]: "",
      });
    }
  }
  return { ok: true, message: "已删除 " + (bingDateLabel(record.date) || "这张") + " 的 Bing 壁纸缓存" };
}

async function deletePhoto(photo, fallbackAlbum) {
  const [c, prefs] = await Promise.all([config(), getValues([prefTheme])]);
  await removeKeys([info + photo.id, imageKey + photo.id]);
  if (c.current === photo.id && prefs[prefTheme] === "custom") {
    const remaining = photosOf(c.album, (await catalog()).photos).filter(item => item.id !== photo.id);
    if (remaining.length) {
      try {
        await usePhoto(remaining[0], c.album);
        return;
      } catch { /* Fall through to built-in lake background. */ }
    }
    const targetAlbum = fallbackAlbum === builtin ? builtin : c.album;
    await setValues({
      [base + "album"]: targetAlbum || builtin,
      [base + "current"]: "lake",
      [prefTheme]: "lake",
      [prefImage]: "",
    });
  }
}

export async function nextWallpaper(order) {
  try {
    return await locked(async () => {
      const c = await config();
      if (order === undefined && bingOn(c)) {
        const days = await bingDays();
        if (days.length > 1) {
          const currentIndex = days.findIndex(day => day.date === c.bingDay);
          const nextDay = days[(currentIndex + 1) % days.length];
          return useBingDay(nextDay);
        }
        return showBing(true);
      }
      return rotate(c, order);
    });
  } catch (e) {
    return { ok: false, message: e.message || "壁纸切换失败，请重试。" };
  }
}

// Picking a built-in or personal background opts out of the Bing daily default.
export async function disableBing() {
  await setValues({ [base + "bing"]: false });
}

export function initializeWallpaperRotation() {
  async function tick(isNew) {
    try {
      await locked(async () => {
        const c = await config();
        if (bingOn(c)) {
          const last = new Date(c.lastAttempt || 0);
          const newDate = last.toDateString() !== new Date().toDateString();
          const retry = c.bingStatus?.includes("暂时无法连接") && Date.now() - last.getTime() > 15 * 60000;
          if (newDate || retry) await showBing(false);
          return;
        }
        const elapsed = Date.now() - (c.rotated || 0);
        if (
          (isNew && c.rotation === "tab") ||
          (c.rotation === "hour" && elapsed >= 3600000) ||
          (c.rotation === "day" && new Date(c.rotated || 0).toDateString() !== new Date().toDateString())
        ) {
          await rotate(c);
        }
      });
    } catch { /* A later visible tab retries the rotation. */ }
  }
  tick(true);
  const onVisible = () => {
    if (!document.hidden) tick(false);
  };
  document.addEventListener("visibilitychange", onVisible);
  const timer = setInterval(onVisible, 60000);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

async function downloadCurrent() {
  const vals = await getValues([prefImage, prefTheme]);
  const theme = vals[prefTheme] || "lake";
  if (theme !== "lake" && theme !== "custom") throw new Error("当前是纯色背景，没有图片可下载。");
  const src = theme === "lake" ? assetUrl("assets/lake.webp") : vals[prefImage];
  if (!src) throw new Error("当前图片无法读取。");
  const a = document.createElement("a");
  const type = src.match(/^data:image\/(jpeg|png|webp);/i)?.[1] || "webp";
  a.href = src;
  a.download = "晨屿壁纸-" + today() + "." + (type === "jpeg" ? "jpg" : type);
  document.body.append(a);
  a.click();
  a.remove();
}

export function mountWallpapers(root) {
  root.innerHTML = `<section class="wallpaper-panel" aria-label="壁纸图库">
    <h2>壁纸图库</h2><div class="wallpaper-toolbar">
      <label>相册 <select class="wallpaper-albums"></select></label>
      <button type="button" data-action="album">新建相册</button><button type="button" data-action="remove-album" class="settings-action-danger" hidden>移除相册</button>
      <button type="button" data-action="upload">添加图片</button><input type="file" accept="image/*" class="wallpaper-upload" multiple hidden>
    </div><div class="wallpaper-grid"></div>
    <div class="wallpaper-controls"><label>自动轮换 <select class="wallpaper-rotation"><option value="off">关闭</option>
      <option value="tab">每个新标签页</option><option value="hour">每小时</option><option value="day">每天</option></select></label>
      <label>轮换顺序 <select class="wallpaper-order"><option value="next">顺序</option><option value="random">随机</option></select></label>
    </div><div class="wallpaper-toolbar"><button type="button" data-action="next">下一张</button><button type="button" data-action="random">随机一张</button><button type="button" data-action="download">下载当前壁纸</button></div>
    <div class="wallpaper-bing"><label><input type="checkbox" class="wallpaper-bing-switch"> Bing 每日壁纸</label><button type="button" data-action="bing" hidden>刷新今日壁纸</button>
      <p class="wallpaper-credit" hidden></p>
      <div class="wallpaper-bing-days" role="group" aria-label="最近 7 天 Bing 壁纸" hidden></div>
    </div><p class="wallpaper-status" role="status"></p>
  </section>`;

  const child = s => root.querySelector(s);
  const button = action => child('[data-action="' + action + '"]');
  const selector = child(".wallpaper-albums");
  const grid = child(".wallpaper-grid");
  const status = child(".wallpaper-status");
  const upload = child(".wallpaper-upload");
  const bing = child(".wallpaper-bing-switch");
  let generation = 0;
  let active = true;
  let pending = false;
  // The user's toggle intent while its storage write is in flight; redraws
  // must not snap the checkbox back to the previous stored value.
  let bingPending = null;
  // Hover triangle -> one-item menu shared by every card in the wallpaper library.
  let openMenu = null;

  function closeCardMenu() {
    if (!openMenu) return;
    openMenu.menu.hidden = true;
    openMenu.trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", openMenu.onDown, true);
    document.removeEventListener("keydown", openMenu.onKey, true);
    openMenu = null;
  }

  function toggleCardMenu(menuRoot, trigger, menu) {
    if (openMenu?.menu === menu) {
      closeCardMenu();
      return;
    }
    closeCardMenu();
    menu.classList.toggle("wallpaper-menu-up", trigger.getBoundingClientRect().bottom + 70 > innerHeight);
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    const onDown = event => {
      if (!menuRoot.contains(event.target)) closeCardMenu();
    };
    const onKey = event => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closeCardMenu();
      trigger.focus();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    openMenu = { menu, trigger, onDown, onKey };
    menu.querySelector('[role="menuitem"]')?.focus();
  }

  function cardMenu(label, onDelete) {
    const menuRoot = document.createElement("div");
    menuRoot.className = "wallpaper-menu-wrap";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "wallpaper-menu-trigger";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", "更多操作：" + label);
    const menu = document.createElement("div");
    menu.className = "wallpaper-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "wallpaper-menu-delete";
    remove.setAttribute("role", "menuitem");
    remove.textContent = "删除";
    remove.onclick = () => {
      closeCardMenu();
      onDelete();
    };
    trigger.onclick = () => toggleCardMenu(menuRoot, trigger, menu);
    menu.append(remove);
    menuRoot.append(trigger, menu);
    return menuRoot;
  }

  function message(msg) {
    if (active) status.textContent = msg;
  }

  async function action(fn) {
    try {
      const result = await fn();
      if (result?.message) message(result.message);
    } catch (e) {
      message(e.message || "操作失败，请重试。");
    }
  }

  async function redraw() {
    closeCardMenu();
    const serial = ++generation;
    try {
      const [c, { photos, albums }, prefs, bingMeta] = await Promise.all([
        config(),
        catalog(),
        getValues([prefTheme]),
        bingDays(),
      ]);
      if (!active || serial !== generation) return;
      selector.replaceChildren(...albums.map(album => new Option(album.title, album.id)));
      selector.value = albums.some(a => a.id === c.album) ? c.album : personal;
      button("remove-album").hidden = [builtin, personal].includes(selector.value);
      child(".wallpaper-rotation").value = c.rotation;
      child(".wallpaper-order").value = c.order;
      bing.checked = bingPending ?? bingOn(c);
      button("bing").hidden = !bingOn(c);

      const activeDay = bingMeta.find(day => day.date === c.bingDay);
      const credit = child(".wallpaper-credit");
      credit.textContent = bingMeta.length && (bingOn(c) || c.current === "bing")
        ? [c.bingStatus, activeDay?.title, activeDay?.credit].filter(Boolean).join(" · ")
        : "";
      credit.hidden = !credit.textContent;

      const bingStrip = child(".wallpaper-bing-days");
      bingStrip.hidden = !bingMeta.length;
      bingStrip.replaceChildren(...bingMeta.map(day => {
        const dateLabel = bingDateLabel(day.date);
        const card = document.createElement("div");
        card.className = "wallpaper-bing-card";
        const pick = document.createElement("button");
        pick.type = "button";
        pick.className = "wallpaper-bing-day";
        pick.title = (day.title || "Bing 壁纸") + (dateLabel ? " · " + dateLabel : "");
        pick.setAttribute("aria-label", dateLabel ? "使用 " + dateLabel + " 的 Bing 壁纸" : "使用这张 Bing 壁纸");
        pick.setAttribute("aria-pressed", String(c.current === "bing" && c.bingDay === day.date));
        const thumb = document.createElement("img");
        thumb.loading = "lazy";
        thumb.alt = "";
        thumb.src = day.thumb || day.data;
        pick.append(thumb);
        pick.onclick = () => action(() => locked(() => useBingDay(day)));
        card.append(pick, cardMenu(day.title || dateLabel || "Bing 壁纸", async () => {
          const ok = await confirmDialog(document.body, {
            title: "删除 Bing 壁纸",
            heading: dateLabel ? dateLabel + " 的 Bing 壁纸" : day.title || "Bing 壁纸",
            message: "将删除这张 Bing 壁纸的本地缓存。",
            confirmLabel: "删除",
          });
          if (ok) action(() => locked(() => deleteBingDay(day)));
        }));
        return card;
      }));

      const gallery = photosOf(selector.value, photos);
      grid.replaceChildren();
      for (const photo of gallery) {
        const card = document.createElement("div");
        card.className = "wallpaper-card";
        const apply = document.createElement("button");
        apply.type = "button";
        apply.className = "wallpaper-photo";
        const theme = prefs[prefTheme] || "lake";
        apply.setAttribute("aria-pressed", String(!bingOn(c) && (photo.theme ? theme === photo.theme : theme === "custom" && c.current === photo.id)));
        const plate = document.createElement("span");
        plate.className = "wallpaper-thumbnail";
        if (photo.theme) {
          plate.dataset.theme = photo.theme;
        } else {
          const img = document.createElement("img");
          img.loading = "lazy";
          img.src = photo.thumb;
          img.alt = "";
          plate.append(img);
        }
        const title = document.createElement("span");
        title.textContent = photo.title;
        title.title = photo.title;
        apply.append(plate, title);
        apply.onclick = () => action(() => locked(() => usePhoto(photo, selector.value)));
        card.append(apply);
        if (!photo.theme) {
          card.append(cardMenu(photo.title, async () => {
            const ok = await confirmDialog(document.body, {
              title: "删除壁纸",
              heading: photo.title,
              message: "将从相册中移除这张图片。",
              confirmLabel: "删除",
            });
            if (ok) action(() => locked(() => deletePhoto(photo, selector.value)));
          }));
        }
        grid.append(card);
      }
      if (!gallery.length) grid.textContent = "相册中还没有图片。";
    } catch {
      if (active && serial === generation) message("图库读取失败，请重试。");
    }
  }

  function scheduleRedraw() {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      if (active) redraw();
    });
  }

  const unsubscribeStorage = onStorageChange(
    key => key.startsWith(base) || key === prefTheme,
    () => scheduleRedraw()
  );

  selector.onchange = () => action(() => setValues({ [base + "album"]: selector.value }));
  child(".wallpaper-rotation").onchange = event =>
    action(() => setValues({ [base + "rotation"]: event.target.value, [base + "rotated"]: Date.now(), [base + "bing"]: false }));
  child(".wallpaper-order").onchange = event => action(() => setValues({ [base + "order"]: event.target.value }));

  button("album").onclick = async () => {
    const title = await promptDialog(document.body, {
      title: "新建相册",
      label: "相册名称",
      placeholder: "输入新相册名称",
      submitLabel: "创建",
      validate: value => (value ? "" : "请输入相册名称。"),
    });
    if (!title) return;
    const id = crypto.randomUUID();
    action(() => setValues({ [albumKey + id]: { id, title, created: Date.now() }, [base + "album"]: id }));
  };

  button("remove-album").onclick = async () => {
    const id = selector.value;
    if ([personal, builtin].includes(id)) return;
    const albumName = selector.selectedOptions[0]?.textContent || "此相册";
    const ok = await confirmDialog(document.body, {
      title: "移除相册",
      heading: albumName,
      message: "移除相册后，其中的图片会保留在“我的图片”中。",
      confirmLabel: "移除",
    });
    if (!ok) return;
    action(() => locked(async () => {
      const { photos } = await catalog();
      const records = Object.fromEntries(photos.filter(p => p.album === id).map(p => [info + p.id, { ...p, album: personal }]));
      await setValues({ ...records, [base + "album"]: personal });
      await removeKeys([albumKey + id]);
    }));
  };

  button("upload").onclick = () => upload.click();
  upload.onchange = () => {
    const files = [...upload.files];
    const album = selector.value === builtin ? personal : selector.value;
    upload.value = "";
    if (!files.length) return;
    action(async () => {
      button("upload").disabled = true;
      let saved = 0;
      try {
        for (const file of files) {
          try {
            const { data, thumb } = await renderImage(file, true);
            const id = crypto.randomUUID();
            await locked(async () => {
              const exists = album === personal || !!(await getValues([albumKey + album]))[albumKey + album];
              const target = exists ? album : personal;
              await setValues({
                [info + id]: { id, title: file.name, album: target, thumb, created: Date.now() },
                [imageKey + id]: data,
                [base + "album"]: target,
              });
            });
            saved++;
          } catch { /* Keep other successfully imported images. */ }
        }
        message("已添加 " + saved + " 张图片" + (saved < files.length ? "，" + (files.length - saved) + " 张未能导入。" : "。"));
      } finally {
        button("upload").disabled = false;
      }
    });
  };

  button("next").onclick = () => action(() => nextWallpaper("next"));
  button("random").onclick = () => action(() => nextWallpaper("random"));
  button("download").onclick = () => action(downloadCurrent);

  bing.onchange = () => {
    bingPending = bing.checked;
    if (!bing.checked) {
      action(async () => {
        try {
          await setValues({ [base + "bing"]: false });
        } finally {
          bingPending = null;
          scheduleRedraw();
        }
      });
      return;
    }
    message("正在获取 Bing 壁纸…");
    action(() => locked(async () => {
      // Save the choice up front: redraws triggered while the images download
      // would otherwise read the old "off" value and uncheck the box again.
      try {
        await setValues({ [base + "bing"]: true });
        return await showBing(false);
      } finally {
        bingPending = null;
        scheduleRedraw();
      }
    }));
  };

  button("bing").onclick = () => action(() => locked(() => showBing(true)));
  redraw();

  return () => {
    active = false;
    closeCardMenu();
    unsubscribeStorage();
  };
}
