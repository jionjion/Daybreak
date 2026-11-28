import { BOOT_KEYS, writeBoot } from "../shared/boot.js";
import { el, webAddress } from "../shared/dom.js";
import { getValues, onStorageChange, setValues } from "../shared/storage.js";

const prefix = "daybreak.layout.";
const defaults = {
  mode: "dashboard",
  clock: true,
  search: true,
  labels: true,
  iconSize: 54,
  iconRadius: 15,
  iconOpacity: 100,
  iconShadow: false,
  textShadow: true,
  fontSize: 13,
  fontFace: "system",
  labelColor: "auto",
  searchWidth: 640,
  searchRadius: 10,
  searchOpacity: 100,
  searchShadow: true,
  homeScale: 100,
  bookmarkBar: false,
  frequentBar: false,
  linksNewTab: true,
  bookmarksNewTab: false,
};
const ranges = {
  iconSize: [34, 104],
  iconRadius: [0, 52],
  iconOpacity: [25, 100],
  fontSize: [10, 22],
  searchWidth: [285, 900],
  searchRadius: [0, 32],
  searchOpacity: [35, 100],
  homeScale: [75, 130],
};
const modes = { dashboard: "工作台", classic: "经典图标", minimal: "极简" };
const selections = {
  mode: modes,
  fontFace: { system: "系统字体", serif: "衬线", mono: "等宽" },
  labelColor: { auto: "跟随主题", light: "米白", dark: "深色", gold: "琥珀" },
};
const rangeUnits = {
  iconOpacity: "%",
  iconSize: " px",
  iconRadius: " px",
  fontSize: " px",
  searchWidth: " px",
  searchRadius: " px",
  searchOpacity: "%",
  homeScale: "%",
};
const keys = Object.keys(defaults).map(key => prefix + key);

export function layoutValues(raw) {
  const result = { ...defaults };
  if (!raw || typeof raw !== "object") return result;
  for (const [key, initial] of Object.entries(defaults)) {
    const value = raw[prefix + key];
    if (typeof value !== typeof initial) continue;
    if (selections[key] && !Object.hasOwn(selections[key], value)) continue;
    if (ranges[key] && (!Number.isFinite(value) || value < ranges[key][0] || value > ranges[key][1])) continue;
    result[key] = value;
  }
  return result;
}

async function loadLayout() {
  return layoutValues(await getValues(keys));
}

export function mountLayout(root, apply) {
  const fields = new Map();
  const status = el("p", "settings-status", "");
  status.setAttribute("role", "status");

  function section(title) {
    const item = el("section", "settings-card");
    item.append(el("h2", "", title));
    root.append(item);
    return item;
  }

  const layout = section("首页布局");
  const appearance = el("section", "layout-appearance");
  appearance.append(el("h3", "", "更多外观设置"));
  const opening = section("链接打开方式");
  let state = { ...defaults };

  function show(values) {
    state = values;
    for (const [key, node] of fields) {
      if (node.type === "checkbox") node.checked = values[key];
      else node.value = values[key];
      if (node.type === "range") {
        node.nextElementSibling.textContent = values[key] + (rangeUnits[key] || "");
      }
    }
    const style = document.documentElement.style;
    style.setProperty("--daybreak-icon-size", values.iconSize + "px");
    style.setProperty("--daybreak-icon-radius", values.iconRadius + "px");
    style.setProperty("--daybreak-icon-opacity", String(values.iconOpacity / 100));
    style.setProperty("--daybreak-icon-label-display", values.labels ? "block" : "none");
    for (const [variable, value] of Object.entries({
      "--icon-shadow": values.iconShadow ? "0 3px 10px rgb(28 24 16 / .34)" : "none",
      "--label-shadow": values.textShadow ? "0 1px 4px rgb(24 20 14 / .6)" : "none",
      "--label-size": values.fontSize + "px",
      "--label-font": { system: "inherit", serif: "Georgia, SimSun, serif", mono: "Consolas, monospace" }[values.fontFace],
      "--search-width": values.searchWidth + "px",
      "--search-radius": values.searchRadius + "px",
      "--search-alpha": values.searchOpacity / 100,
      "--search-shadow": values.searchShadow ? "0 2px 10px rgb(30 26 18 / .21)" : "none",
      "--home-zoom": values.homeScale / 100,
    })) {
      style.setProperty(variable, String(value));
    }
    if (values.labelColor === "auto") style.removeProperty("--label-color");
    else style.setProperty("--label-color", { dark: "var(--accent-text)", light: "#fffdf1", gold: "#e7bf6c" }[values.labelColor]);

    document.body.dataset.homeLayout = values.mode;
    document.body.dataset.showClock = String(values.clock);
    document.body.dataset.showSearch = String(values.search);
    writeBoot(BOOT_KEYS.layout, values);
    apply(values);
  }

  function field(card, key, label) {
    const row = el("label", "settings-row");
    const input = el(selections[key] ? "select" : "input");
    input.name = key;
    input.setAttribute("aria-label", label);
    const controls = el("span", "layout-control");
    row.append(el("span", "", label), controls);
    controls.append(input);
    if (selections[key]) {
      input.className = "settings-field";
      for (const [value, name] of Object.entries(selections[key])) input.append(new Option(name, value));
    } else if (ranges[key]) {
      input.type = "range";
      [input.min, input.max] = ranges[key];
      controls.append(el("output"));
    } else {
      input.type = "checkbox";
      input.className = "settings-switch";
      input.setAttribute("role", "switch");
    }
    fields.set(key, input);
    input.addEventListener("change", async () => {
      const value = input.type === "checkbox" ? input.checked : input.type === "range" ? Number(input.value) : input.value;
      try {
        const permissions = globalThis.chrome?.permissions;
        if (key === "frequentBar" && value && (!permissions || !await permissions.request({ permissions: ["topSites"] }))) {
          show(state);
          status.textContent = "需要允许读取最常访问的网站才能显示这一栏。";
          return;
        }
        await setValues({ [prefix + key]: value });
        await refresh();
        status.textContent = "首页设置已保存。";
      } catch {
        show(state);
        status.textContent = "未能保存此设置。";
      }
    });
    card.append(row);
  }

  for (const [key, label] of Object.entries({
    mode: "显示模式",
    clock: "显示时钟",
    search: "显示搜索框",
    bookmarkBar: "顶部显示书签",
    frequentBar: "顶部显示常用网站",
    labels: "显示图标名称",
    iconSize: "图标大小",
    iconRadius: "图标圆角",
    iconOpacity: "图标不透明度",
  })) {
    field(layout, key, label);
  }

  for (const [key, label] of Object.entries({
    fontFace: "图标名称字体",
    fontSize: "图标名称字号",
    labelColor: "图标名称颜色",
    iconShadow: "图标阴影",
    textShadow: "经典布局文字阴影",
    searchWidth: "搜索框宽度",
    searchRadius: "搜索框圆角",
    searchOpacity: "搜索框不透明度",
    searchShadow: "搜索框阴影",
    homeScale: "首页内容缩放",
  })) {
    field(appearance, key, label);
  }
  layout.append(appearance);

  for (const [key, label] of Object.entries({
    linksNewTab: "在新标签页打开首页书签",
    bookmarksNewTab: "在新标签页打开书签列表",
  })) {
    field(opening, key, label);
  }
  root.append(status);

  let request = 0;
  async function refresh() {
    const id = ++request;
    const values = await loadLayout();
    if (id === request) show(values);
  }

  const unsubscribe = onStorageChange(keys, () => {
    refresh().catch(() => {});
  });
  refresh().catch(() => show(defaults));
  return unsubscribe;
}

export function setupQuickStrip(root) {
  let current = defaults;
  let version = 0;

  const row = (title, items, newTab) => {
    const block = el("div", "quick-strip-row");
    block.append(el("strong", "", title));
    for (const item of items) {
      const address = webAddress(item?.url);
      if (!address) continue;
      const a = el("a", "", item.title || address.hostname);
      a.href = address.href;
      a.title = a.textContent + " · " + address.href;
      if (newTab) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
      block.append(a);
    }
    if (block.childElementCount === 1) block.append(el("span", "", "暂无网页"));
    return block;
  };

  async function refresh() {
    const id = ++version;
    const values = current;
    const rows = [];
    const bookmarksApi = globalThis.chrome?.bookmarks;
    const topSitesApi = globalThis.chrome?.topSites;

    if (values.bookmarkBar && bookmarksApi?.getTree) {
      try {
        const tree = await bookmarksApi.getTree();
        const children = tree[0]?.children || [];
        const toolbar = children.find(node => node.folderType === "bookmarks-bar" || node.id === "1") || children[0];
        const collect = nodes => nodes.flatMap(node => (node.url ? [node] : collect(node.children || [])));
        rows.push(row("书签栏", collect(toolbar?.children || []), values.linksNewTab));
      } catch {
        rows.push(row("书签栏", [], false));
      }
    }

    if (values.frequentBar && topSitesApi?.get) {
      try {
        rows.push(row("常用网站", await topSitesApi.get(), values.linksNewTab));
      } catch { /* Ignore when optional permission is absent. */ }
    }

    if (id !== version) return;
    root.replaceChildren(...rows);
    root.hidden = !rows.length;
    delete document.body.dataset.bootQuickRows;
  }

  const bookmarksApi = globalThis.chrome?.bookmarks;
  for (const event of ["onCreated", "onRemoved", "onMoved", "onChanged", "onChildrenReordered", "onImportEnded"]) {
    bookmarksApi?.[event]?.addListener(() => {
      if (current.bookmarkBar) refresh();
    });
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && current.frequentBar) refresh();
  });

  return values => {
    current = values;
    refresh();
  };
}

export function setupSystemShortcuts(container, drawIcon) {
  for (const [id, title, glyph, href] of [
    ["weather", "天气", "weather", "#settings/weather"],
    ["bookmarks", "书签", "bookmark", "#bookmarks"],
    ["settings", "设置", "settings", "#settings"],
  ]) {
    const link = el("a", "system-tile");
    link.href = href;
    link.setAttribute("aria-label", title);
    link.dataset.module = id;
    const icon = el("span", "system-glyph");
    drawIcon(icon, glyph);
    link.append(icon, el("span", "system-label", title));
    container.append(link);
  }
}
