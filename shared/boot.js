export const BOOT_KEYS = {
  wallpaper: "daybreak.boot",
  tint: "daybreak.boot.tint",
  layout: "daybreak.boot.layout",
  ui: "daybreak.boot.ui",
  weather: "daybreak.boot.weather",
  metrics: "daybreak.boot.metrics",
};

export function readBoot(key) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeBoot(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch { /* ignore quota or private storage limits */ }
}
