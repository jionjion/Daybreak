/* Synchronous first-paint restore: chrome.storage is async, so without this the
   page paints the default lake/green and then swaps to the saved wallpaper.
   The mirror is written by settings.js (rememberWallpaper) on every change. */
(() => {
  const body = document.body;
  const hash = location.hash;
  body.dataset.route = hash.startsWith("#settings") ? "settings" : hash === "#bookmarks" ? "detail" : "home";
  let boot = null;
  try { boot = JSON.parse(localStorage.getItem("daybreak.boot") || "null"); } catch {}
  if (!boot || typeof boot !== "object") return;
  if (!["lake", "pine", "paper", "color", "custom"].includes(boot.theme)) return;
  body.dataset.wallTheme = boot.theme;
  const layer = document.getElementById("wall-layer");
  layer.dataset.theme = boot.theme;
  const style = layer.style;
  if (boot.customImage) style.setProperty("--custom-wallpaper", 'url("' + boot.customImage + '")');
  if (boot.wallpaperColor) style.setProperty("--wallpaper-color", boot.wallpaperColor);
  if (boot.mask != null) style.setProperty("--wallpaper-mask", String(boot.mask));
  if (boot.blur != null) style.setProperty("--wallpaper-blur", boot.blur + "px");
  if (boot.fit) style.setProperty("--wallpaper-fit", boot.fit);
  if (boot.hue != null) {
    const root = document.documentElement.style;
    root.setProperty("--wall-hue", String(boot.hue));
    root.setProperty("--wall-sat", (boot.sat ?? 22) + "%");
  }
})();
