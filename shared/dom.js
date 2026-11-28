export function el(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

export function webAddress(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

export function syncScrollEdges(container) {
  if (!container) return;
  const start = container.scrollLeft <= 2;
  const end = container.scrollLeft + container.clientWidth >= container.scrollWidth - 2;
  container.dataset.edges = start && end ? "none" : start ? "right" : end ? "left" : "both";
}
