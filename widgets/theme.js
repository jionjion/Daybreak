export const DEFAULT_ACCENT = "#3f3f3c";

export const ACCENT_PRESETS = [
  ["石墨", "#3f3f3c"],
  ["黛蓝", "#3d5a72"],
  ["松墨", "#35604a"],
  ["青瓷", "#396a6b"],
  ["绛紫", "#6b4a63"],
  ["赭石", "#8a5a3b"],
  ["绯红", "#934a4a"],
];

export function isAccent(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function luminance(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = shift => {
    const c = (value >> shift & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

export function applyTheme(accent, target = document.documentElement) {
  const color = (isAccent(accent) ? accent : DEFAULT_ACCENT).toLowerCase();
  target.style.setProperty("--accent", color);
  target.style.setProperty("--accent-contrast", luminance(color) > 0.42 ? "#1d1c16" : "#ffffff");
  return color;
}