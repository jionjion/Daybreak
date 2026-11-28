/* Synchronous first-paint restore: chrome.storage is async, so without this the
   page paints defaults and then reflows/swaps once storage resolves. */
(() => {
  const body = document.body;
  const root = document.documentElement.style;
  const hash = location.hash;
  // Settings is a drawer over the home view, so the home route (and its
  // wallpaper) paints first and the drawer slides in on top.
  body.dataset.route = hash === "#bookmarks" ? "detail" : "home";
  body.dataset.settingsOpen = String(hash.startsWith("#settings"));

  const read = key => {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  };
  const inRange = (val, min, max) => typeof val === "number" && Number.isFinite(val) && val >= min && val <= max;

  const boot = read("daybreak.boot");
  const tint = read("daybreak.boot.tint");
  if (boot && typeof boot === "object" && ["lake", "pine", "paper", "color", "custom"].includes(boot.theme)) {
    body.dataset.wallTheme = boot.theme;
    const layer = document.getElementById("wall-layer");
    layer.dataset.theme = boot.theme;
    const style = layer.style;
    if (typeof boot.customImage === "string" && /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(boot.customImage)) {
      style.setProperty("--custom-wallpaper", 'url("' + boot.customImage + '")');
    }
    if (typeof boot.wallpaperColor === "string" && /^#[0-9a-f]{6}$/i.test(boot.wallpaperColor)) {
      style.setProperty("--wallpaper-color", boot.wallpaperColor);
    }
    if (typeof boot.mask === "number" && Number.isFinite(boot.mask)) {
      style.setProperty("--wallpaper-mask", String(boot.mask));
    }
    if (typeof boot.blur === "number" && Number.isFinite(boot.blur)) {
      style.setProperty("--wallpaper-blur", boot.blur + "px");
    }
    if (["cover", "contain", "auto"].includes(boot.fit)) {
      style.setProperty("--wallpaper-fit", boot.fit);
    }
    const hue = Number.isFinite(tint?.hue) ? tint.hue : boot.hue;
    const sat = Number.isFinite(tint?.sat) ? tint.sat : boot.sat;
    if (typeof hue === "number" && Number.isFinite(hue)) {
      root.setProperty("--wall-hue", String(hue));
      root.setProperty("--wall-sat", (typeof sat === "number" && Number.isFinite(sat) ? sat : 22) + "%");
    }
  }

  const layout = read("daybreak.boot.layout");
  if (layout && typeof layout === "object") {
    if (["dashboard", "classic", "minimal"].includes(layout.mode)) body.dataset.homeLayout = layout.mode;
    if (typeof layout.clock === "boolean") body.dataset.showClock = String(layout.clock);
    if (typeof layout.search === "boolean") body.dataset.showSearch = String(layout.search);
    if (inRange(layout.iconSize, 34, 104)) root.setProperty("--daybreak-icon-size", layout.iconSize + "px");
    if (inRange(layout.iconRadius, 0, 52)) root.setProperty("--daybreak-icon-radius", layout.iconRadius + "px");
    if (inRange(layout.iconOpacity, 25, 100)) root.setProperty("--daybreak-icon-opacity", String(layout.iconOpacity / 100));
    if (typeof layout.labels === "boolean") root.setProperty("--daybreak-icon-label-display", layout.labels ? "block" : "none");
    if (typeof layout.iconShadow === "boolean") {
      root.setProperty("--icon-shadow", layout.iconShadow ? "0 3px 10px rgb(28 24 16 / .34)" : "none");
    }
    if (typeof layout.textShadow === "boolean") {
      root.setProperty("--label-shadow", layout.textShadow ? "0 1px 4px rgb(24 20 14 / .6)" : "none");
    }
    if (inRange(layout.fontSize, 10, 22)) root.setProperty("--label-size", layout.fontSize + "px");
    const fontMap = { system: "inherit", serif: "Georgia, SimSun, serif", mono: "Consolas, monospace" };
    if (Object.hasOwn(fontMap, layout.fontFace)) root.setProperty("--label-font", fontMap[layout.fontFace]);
    const colorMap = { dark: "var(--accent-text)", light: "#fffdf1", gold: "#e7bf6c" };
    if (Object.hasOwn(colorMap, layout.labelColor)) root.setProperty("--label-color", colorMap[layout.labelColor]);
    if (inRange(layout.searchWidth, 285, 900)) root.setProperty("--search-width", layout.searchWidth + "px");
    if (inRange(layout.searchRadius, 0, 32)) root.setProperty("--search-radius", layout.searchRadius + "px");
    if (inRange(layout.searchOpacity, 35, 100)) root.setProperty("--search-alpha", String(layout.searchOpacity / 100));
    if (typeof layout.searchShadow === "boolean") {
      root.setProperty("--search-shadow", layout.searchShadow ? "0 2px 10px rgb(30 26 18 / .21)" : "none");
    }
    if (inRange(layout.homeScale, 75, 130)) root.setProperty("--home-zoom", String(layout.homeScale / 100));

    const quickRows = (layout.bookmarkBar === true ? 1 : 0) + (layout.frequentBar === true ? 1 : 0);
    if (quickRows > 0) body.dataset.bootQuickRows = String(quickRows);
  }

  const ui = read("daybreak.boot.ui");
  if (ui && typeof ui === "object") {
    if (typeof ui.accent === "string" && /^#[0-9a-f]{6}$/i.test(ui.accent)) {
      root.setProperty("--accent", ui.accent.toLowerCase());
    }
    if (ui.accentContrast === "#ffffff" || ui.accentContrast === "#1d1c16") {
      root.setProperty("--accent-contrast", ui.accentContrast);
    }
    if (typeof ui.showCategories === "boolean") {
      body.dataset.bootCategories = String(ui.showCategories);
    }
    if (ui.weather === false) {
      body.dataset.bootWeather = "false";
    } else if (typeof ui.weatherVisible === "boolean") {
      body.dataset.bootWeather = String(ui.weatherVisible);
    }
  }

  const weatherBoot = read("daybreak.boot.weather");
  if (ui?.weather !== false && weatherBoot && typeof weatherBoot.visible === "boolean") {
    body.dataset.bootWeather = String(weatherBoot.visible);
  }

  const metrics = read("daybreak.boot.metrics");
  if (metrics && typeof metrics === "object") {
    if (typeof metrics.listHeight === "number" && Number.isFinite(metrics.listHeight)) {
      const clamped = Math.max(86, Math.min(224, Math.round(metrics.listHeight)));
      root.setProperty("--boot-bookmarks-height", clamped + "px");
    }
    if (typeof metrics.hasTabs === "boolean") {
      body.dataset.bootBookmarksTabs = String(metrics.hasTabs);
    }
  }
})();
