import { favoriteAddress, findFavorite, saveFavorite } from "./widgets/favorites.js";

const status = document.getElementById("popup-status");
const title = document.getElementById("page-title");
const folder = document.getElementById("page-folder");
const save = document.getElementById("save-favorite");
const domain = document.getElementById("page-domain");
let currentUrl;
let existingUrl;

document.getElementById("open-daybreak").addEventListener("click", async () => {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html") });
    window.close();
  } catch { status.textContent = "启动页打开失败，请重试。"; }
});

document.getElementById("save-page").addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentUrl || save.disabled) return;
  save.disabled = true;
  try {
    const values = { url: currentUrl, title: title.value, folder: folder.value };
    if (!existingUrl) values.iconMode = "browser";
    const saved = await saveFavorite(values, existingUrl);
    existingUrl = saved.url;
    save.textContent = "更新收藏";
    status.textContent = "已保存到晨屿。";
  } catch (error) {
    status.textContent = error.message || "保存失败，请再试一次。";
  } finally { save.disabled = false; }
});

async function loadTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!/^https?:\/\//i.test(tab?.url || "")) {
      title.disabled = true;
      folder.disabled = true;
      status.textContent = "打开一个普通网页，即可将它加入收藏。";
      return;
    }
    const address = favoriteAddress(tab.url);
    const existing = await findFavorite(address.href);
    title.value = existing?.title || tab.title || address.hostname;
    folder.value = existing?.folder || "";
    domain.textContent = address.hostname;
    domain.title = address.href;
    currentUrl = address.href;
    existingUrl = existing?.url;
    save.textContent = existing ? "更新收藏" : "添加到收藏";
    if (existing) status.textContent = "这个网页已在收藏夹中。";
    save.disabled = false;
  } catch {
    status.textContent = "无法读取当前网页，请在启动页手动添加收藏。";
  }
}
loadTab();
