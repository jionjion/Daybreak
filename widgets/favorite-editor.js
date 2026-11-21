import {changeGroup, favoriteAddress, groupPair, removeFavorite, saveFavorite, validIconImage} from "./favorite-store.js";

export function make(tag, name, label) {
  const node = document.createElement(tag);
  node.className = "favorites-" + name;
  if (label !== undefined) node.textContent = label;
  if (tag === "button") node.type = "button";
  return node;
}
export function button(name, text, callback) {
  const btn = make("button", name, text);
  btn.addEventListener("click", callback);
  return btn;
}
let defaultFavicon;
async function faviconImage(pageUrl) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl",pageUrl);
  url.searchParams.set("size","64");
  const image = make("img","browser-icon");
  image.alt = "";
  image.src = url.href;
  await image.decode();
  return image;
}
function pixels(image) {
  const canvas=document.createElement("canvas");
  canvas.width=canvas.height=32;
  canvas.getContext("2d").drawImage(image,0,0,32,32);
  return canvas.toDataURL();
}
async function loadBrowserIcon(mark, pageUrl) {
  if (!globalThis.chrome?.runtime?.getURL) return;
  try {
    // Chromium may return a built-in globe (HTTP 200) for a cache miss.
    defaultFavicon ??= faviconImage("https://daybreak-missing-favicon.invalid/").then(pixels).catch(()=>null);
    const [image, empty] = await Promise.all([faviconImage(pageUrl),defaultFavicon]);
    if (!empty || pixels(image)!==empty) mark.replaceChildren(image);
  } catch { /* Keep the locally drawn initials when Chromium has no usable icon. */ }
}
export function iconMark(record, small = false) {
  const mark = make("span", small ? "mini-mark" : "monogram");
  mark.setAttribute("aria-hidden", "true");
  if (record.iconMode!=="browser" && validIconImage(record.iconImage)) {
    const img = make("img", "icon-image");
    img.alt = "";
    img.src = record.iconImage;
    mark.append(img);
  } else {
    const host = new URL(record.url).hostname;
    mark.dataset.color = String([...host].reduce((sum, c) => (sum * 31 + c.codePointAt(0)) % 6, 0));
    if (/^#[0-9a-f]{6}$/i.test(record.iconColor)) {
      mark.style.backgroundColor = record.iconColor;
      const channels = [1,3,5].map(n => parseInt(record.iconColor.slice(n,n+2),16)/255)
        .map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
      const luminance = .2126*channels[0] + .7152*channels[1] + .0722*channels[2];
      mark.style.color = luminance > .18 ? "#0c1812" : "#fff";
    }
    const custom = String(record.iconText || "").trim();
    mark.textContent = custom || Array.from(record.title.trim() || host)[0].toLocaleUpperCase();
    if (custom.length > 1) mark.classList.add("favorites-multi-letter");
    if (record.iconMode==="browser") loadBrowserIcon(mark,record.url);
  }
  return mark;
}
async function localIcon(file) {
  if (!file || !/^image\/(png|jpeg|webp|gif|bmp|avif|x-icon|vnd.microsoft.icon)$/i.test(file.type)) throw new Error("请选择 PNG、JPEG、WebP、GIF、ICO 或 AVIF 图片。");
  if (file.size > 12 * 1024 * 1024) throw new Error("请选择小于 12 MB 的图标图片。");
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 144;
    const width = image.naturalWidth, height = image.naturalHeight;
    const side = Math.min(width,height);
    canvas.getContext("2d").drawImage(image,(width-side)/2,(height-side)/2,side,side,0,0,144,144);
    return canvas.toDataURL("image/webp", .88);
  } finally { URL.revokeObjectURL(source); }
}
function dialogForm(container, heading, saveText = "保存") {
  const dialog = make("dialog","dialog");
  dialog.setAttribute("aria-label",heading);
  const form = make("form","form");
  form.append(make("h3","dialog-title",heading));
  const status = make("p","message");
  status.setAttribute("role","status");
  const actions = make("div","actions");
  const cancel = button("secondary","取消",()=>dialog.close());
  const submit = make("button","primary",saveText);
  submit.type = "submit";
  actions.append(cancel,submit);
  dialog.append(form);
  container.append(dialog);
  let busy = false;
  function row(caption, control) {
    const label = make("label","label",caption);
    label.append(control);
    form.append(label);
    return control;
  }
  function field(caption, placeholder, value, max) {
    const input = make("input","field");
    input.type = "text";
    input.placeholder = placeholder;
    input.value = value || "";
    if (max) input.maxLength = max;
    return row(caption,input);
  }
  async function run(action) {
    if (busy) return;
    busy = true;
    for (const btn of actions.querySelectorAll("button")) btn.disabled = true;
    try { await action(); dialog.close(); }
    catch (err) { status.textContent = err.message || "操作失败，请重试。"; }
    finally {
      busy = false;
      for (const btn of actions.querySelectorAll("button")) btn.disabled = false;
    }
  }
  function open(action) {
    form.append(status,actions);
    form.addEventListener("submit",event=>{ event.preventDefault(); run(action); });
    dialog.addEventListener("cancel",event=>{ if(busy) event.preventDefault(); });
    dialog.addEventListener("close",()=>dialog.remove(),{once:true});
    dialog.showModal();
  }
  return {dialog,form,status,actions,submit,field,row,run,open};
}

export function siteForm(container, initial, desk, currentFolder, onSaved) {
  const ui = dialogForm(container, initial ? "编辑收藏" : "添加收藏");
  const address = ui.field("网页地址","https://example.com",initial?.url);
  address.required = true;
  address.inputMode = "url";
  const title = ui.field("显示名称","留空时使用网站域名",initial?.title,200);
  const folder = ui.field("分组","留空显示在首页，或输入新文件夹名称",initial?.folder ?? currentFolder,80);
  const choices = make("datalist","folder-options");
  choices.id = "folders-" + crypto.randomUUID();
  choices.append(...[...desk.folders.keys()].map(name=>new Option(name,name)));
  folder.setAttribute("list",choices.id);
  ui.form.append(choices);
  const group = make("details","appearance");
  const preview = make("span","icon-preview");
  const caption = make("summary","appearance-summary");
  caption.append(preview,make("span","appearance-title","自定义图标"));
  group.append(caption);
  const controls = make("div","appearance-fields");
  group.append(controls);
  ui.form.append(group);
  let image = validIconImage(initial?.iconImage) ? initial.iconImage : "";
  let color = initial?.iconColor || "";
  let pending = Promise.resolve();
  let seq = 0;
  function inGroup(caption,control) {
    const label = make("label","label",caption);
    label.append(control);
    controls.append(label);
  }
  const mode = make("select","field");
  mode.append(new Option("自定义文字或图片","custom"), new Option("浏览器网站图标","browser"));
  mode.value = initial?.iconMode==="browser" ? "browser" : "custom";
  inGroup("图标来源",mode);
  mode.addEventListener("change",draw);
  const text = make("input","field");
  text.maxLength = 8;
  text.placeholder = "1 至 3 个字";
  text.value = initial?.iconText || "";
  const picker = make("input","color");
  picker.type = "color";
  picker.value = color || "#30664f";
  const upload = make("input","upload");
  upload.type = "file";
  upload.accept = "image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp,image/x-icon,image/vnd.microsoft.icon,.ico";
  inGroup("图标文字",text); inGroup("图标背景色",picker); inGroup("本地图标图片",upload);
  const reset = button("secondary","恢复自动图标",()=>{
    seq++; mode.value="custom"; image = ""; color = ""; text.value = ""; upload.value = ""; picker.value = "#30664f"; draw();
  });
  controls.append(reset);
  function draw() {
    let url = "https://example.com";
    try { url = favoriteAddress(address.value).href; } catch { /* Form validation will report errors on save. */ }
    preview.replaceChildren(iconMark({url,title:title.value || "网",iconText:text.value,iconColor:color,iconImage:image,iconMode:mode.value}));
  }
  for (const field of [title,address]) field.addEventListener("input",draw);
  text.addEventListener("input",()=>{ seq++; mode.value="custom"; image=""; upload.value=""; draw(); });
  picker.addEventListener("input",()=>{ seq++; mode.value="custom"; color=picker.value; image=""; upload.value=""; draw(); });
  upload.addEventListener("change",()=>{
    const file = upload.files[0];
    if (!file) return;
    const request = ++seq;
    pending = localIcon(file).then(data=>{
      if (seq===request) { mode.value="custom"; image=data; ui.status.textContent=""; draw(); }
    }).catch(err=>{
      if (seq===request) { upload.value=""; ui.status.textContent=err.message || "无法读取这张图片。"; }
    });
  });
  draw();
  if (initial) {
    let confirmed = false;
    const del = button("remove","删除收藏",()=>{
      if (!confirmed) { confirmed=true; del.textContent="确认删除"; ui.status.textContent="删除后将从个人收藏夹移除。"; return; }
      ui.run(async()=>{await removeFavorite(initial.url);onSaved("已删除收藏");});
    });
    ui.actions.prepend(del);
  }
  ui.open(async()=>{
    await pending;
    await saveFavorite({url:address.value,title:title.value,folder:folder.value,iconText:text.value,iconColor:color,iconImage:image,iconMode:mode.value},initial?.url);
    onSaved(initial ? "已更新收藏" : "已添加收藏");
  });
  address.focus();
}
export function pairForm(container, first, second, desk, onSaved) {
  const ui=dialogForm(container,"收纳为文件夹","创建文件夹");
  let suggestion="新文件夹",suffix=2;
  while(desk.folders.has(suggestion)) suggestion="新文件夹 "+suffix++;
  ui.form.append(make("p","message","把「"+first.title+"」和「"+second.title+"」移入同一个文件夹。"));
  const name=ui.field("文件夹名称","例如 工作",suggestion,80);
  name.required=true;
  ui.open(async()=>{await groupPair(first.url,second.url,name.value);onSaved("已收纳到「"+name.value.trim()+"」");});
  name.select();
}

export function groupForm(container, name, onSaved) {
  const ui = dialogForm(container, name ? "管理文件夹" : "新建文件夹");
  const title = ui.field("文件夹名称","例如 工作",name,80);
  title.required = true;
  if (name) {
    const options = make("div","group-options");
    function action(label, mode, question) {
      const btn = button("secondary",label,()=>{
        if (btn.dataset.confirm !== "yes") {
          for(const other of options.querySelectorAll("button")) { other.dataset.confirm=""; other.textContent=other.dataset.label; }
          btn.dataset.confirm="yes"; btn.textContent="确认"+label; ui.status.textContent=question; return;
        }
        ui.run(async()=>{await changeGroup(name,"",mode);onSaved(mode==="release"?"已解散文件夹，网页已移回首页":"已删除文件夹及其中的收藏","");});
      });
      btn.dataset.label=label;
      options.append(btn);
    }
    action("解散文件夹","release","所有网页将移回首页，并保留各自的图标。");
    action("删除文件夹","delete","这个文件夹和其中所有网页收藏都将删除。");
    ui.form.append(options);
  }
  ui.open(async()=>{
    const next=title.value.trim();
    await changeGroup(name,next,name?"rename":"create");
    onSaved(name ? "已更新文件夹" : "已新建文件夹",next);
  });
}
