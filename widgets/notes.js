const PREFIX = "daybreak.note.";
const storage = globalThis.chrome?.storage?.local;

function parseNote(key, value) {
  if (!key.startsWith(PREFIX) || !value || typeof value.text !== "string") return null;
  return { ...value, id: key.slice(PREFIX.length) };
}

async function readNotes() {
  if (storage) {
    const keys = storage.getKeys ? (await storage.getKeys()).filter(key => key.startsWith(PREFIX)) : null;
    return Object.entries(await storage.get(keys));
  }
  return Object.keys(localStorage).filter(key => key.startsWith(PREFIX)).map(key => {
    try { return [key, JSON.parse(localStorage.getItem(key))]; }
    catch { return [key, null]; }
  });
}

async function putNote(note) {
  const key = PREFIX + note.id;
  if (storage) await storage.set({ [key]: note });
  else localStorage.setItem(key, JSON.stringify(note));
}

async function removeNote(id) {
  if (storage) await storage.remove(PREFIX + id);
  else localStorage.removeItem(PREFIX + id);
}

function watchNotes(onChange) {
  if (storage) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      for (const [key, change] of Object.entries(changes)) {
        if (key.startsWith(PREFIX)) onChange(key, change.newValue);
      }
    });
  } else {
    window.addEventListener("storage", event => {
      if (event.storageArea !== localStorage || !event.key?.startsWith(PREFIX)) return;
      try { onChange(event.key, JSON.parse(event.newValue)); }
      catch { /* Ignore unrelated or unreadable values. */ }
    });
  }
}

function make(tag, className, label) {
  const element = document.createElement(tag);
  element.className = "notes-" + className;
  if (label) element.textContent = label;
  if (tag === "button") element.type = "button";
  return element;
}

function blankNote() {
  return { id: crypto.randomUUID(), text: "", created: Date.now() };
}

function titleOf(note) {
  if (typeof note.title === "string" && note.title.trim()) return note.title.trim();
  const firstLine = note.text.trimStart().split(/\r?\n/, 1)[0].trim();
  if (!firstLine) return "未命名笔记";
  const letters = Array.from(firstLine);
  return letters.length > 24 ? letters.slice(0, 24).join("") + "…" : firstLine;
}

export async function mountNotes(root) {
  const notes = new Map();
  const writer = crypto.randomUUID();
  const localRevisions = new Map();
  let draft = blankNote();
  let active = draft.id;
  let confirming = false;
  let deleting = false;
  let revision = 0;
  let pendingChanges = [];

  const toolbar = make("div", "toolbar");
  const select = make("select", "select");
  select.setAttribute("aria-label", "选择笔记");
  const add = make("button", "add", "新建");
  add.setAttribute("aria-label", "新建笔记");
  const del = make("button", "delete", "删除");
  del.setAttribute("aria-label", "删除当前笔记");
  toolbar.append(select, add, del);
  const confirmation = make("div", "confirm");
  const prompt = make("span", "confirm-label", "删除这篇笔记？");
  const cancel = make("button", "cancel", "取消");
  const accept = make("button", "accept", "确认删除");
  confirmation.append(prompt, cancel, accept);
  confirmation.hidden = true;
  const editor = make("textarea", "editor");
  editor.setAttribute("aria-label", "笔记正文");
  editor.placeholder = "在这里写笔记…";
  const footer = make("div", "footer");
  const status = make("span", "status");
  status.setAttribute("role", "status");
  const count = make("span", "count");
  footer.append(status, count);
  const tools = make("details", "tools");
  const summary = make("summary", "tools-label", "管理笔记");
  const search = make("input", "field");
  search.type = "search";
  search.placeholder = "搜索标题或正文";
  search.setAttribute("aria-label", search.placeholder);
  const results = make("div", "results");
  const title = make("input", "field");
  title.placeholder = "笔记标题";
  title.setAttribute("aria-label", title.placeholder);
  title.maxLength = 160;
  const sort = make("select", "field");
  sort.setAttribute("aria-label", "笔记排序");
  sort.append(new Option("最近创建", "created"), new Option("最近修改", "updated"), new Option("按标题", "title"));
  const actions = make("div", "actions");
  const pin = make("button", "action", "置顶");
  const insert = make("button", "action", "插入图片");
  const bold = make("button", "action", "加粗");
  const link = make("button", "action", "插入链接");
  const toggle = make("button", "action", "图文预览");
  const file = make("input", "upload");
  file.type = "file";
  file.accept = "image/*";
  file.hidden = true;
  const preview = make("div", "preview");
  preview.hidden = true;
  actions.append(pin, bold, link, insert, toggle);
  const filterFields = make("div", "search-sort");
  filterFields.append(search, sort);
  const titleLabel = make("label", "title-label", "当前笔记标题");
  titleLabel.append(title);
  tools.append(summary, filterFields, results, titleLabel, actions, file);

  function orderedNotes() {
    return [...notes.values()].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) ||
      (sort.value === "title" ? titleOf(a).localeCompare(titleOf(b), "zh-CN") :
        sort.value === "updated" ? (b.updated || b.created) - (a.updated || a.created) : b.created - a.created) || a.id.localeCompare(b.id));
  }

  function renderResults() {
    results.replaceChildren();
    const q = search.value.trim().toLocaleLowerCase();
    if (!q) return;
    for (const note of orderedNotes().filter(item => (titleOf(item) + " " + item.text).toLocaleLowerCase().includes(q))) {
      const result = make("button", "result", titleOf(note));
      result.addEventListener("click", () => { active = note.id; search.value = ""; render(); });
      results.append(result);
    }
    if (!results.children.length) results.textContent = "没有匹配的笔记";
  }

  function renderPreview(note) {
    preview.replaceChildren();
    function appendText(text) {
      let position = 0;
      for (const token of text.matchAll(/\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/gi)) {
        preview.append(text.slice(position, token.index));
        const node = document.createElement(token[1] ? "strong" : "a");
        node.textContent = token[1] || token[2];
        if (!token[1]) {
          node.href = token[3];
          node.target = "_blank";
          node.rel = "noopener noreferrer";
        }
        preview.append(node);
        position = token.index + token[0].length;
      }
      preview.append(text.slice(position));
    }
    let offset = 0;
    for (const match of note.text.matchAll(/!\[([^\]\n]*)\]\(image:([a-z0-9-]+)\)/gi)) {
      appendText(note.text.slice(offset, match.index));
      const src = note.images?.[match[2]];
      if (typeof src === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/i.test(src)) {
        const image = document.createElement("img");
        image.src = src; image.alt = match[1] || "笔记图片"; preview.append(image);
      } else preview.append(match[0]);
      offset = match.index + match[0].length;
    }
    appendText(note.text.slice(offset));
  }

  function renderPicker() {
    const list = orderedNotes();
    if (!notes.has(active)) list.unshift(draft);
    select.replaceChildren(...list.map(note => new Option((note.pinned ? "↑ " : "") + titleOf(note), note.id)));
    select.value = active;
    del.disabled = !notes.has(active);
    const note = notes.get(active) || draft;
    pin.textContent = note.pinned ? "取消置顶" : "置顶";
    pin.setAttribute("aria-pressed", String(!!note.pinned));
    renderResults();
    if (!preview.hidden) renderPreview(note);
  }

  function updateCount() {
    count.textContent = Array.from(editor.value).length + " 字";
  }

  function render() {
    const note = notes.get(active) || draft;
    if (editor.value !== note.text) editor.value = note.text;
    title.value = note.title || "";
    status.textContent = notes.has(active) ? "已保存到本机" : "";
    confirming = false;
    confirmation.hidden = true;
    renderPicker();
    updateCount();
  }

  function chooseAvailable() {
    const first = orderedNotes()[0];
    if (!first) draft = blankNote();
    active = first?.id || draft.id;
  }

  function changed(key, value) {
    const id = key.slice(PREFIX.length);
    const note = parseNote(key, value);
    if (note?.writer === writer && (note.revision < localRevisions.get(id) ||
        notes.get(id)?.revision === note.revision && notes.get(id)?.writer === writer)) return;
    const oldActive = active;
    if (note) notes.set(id, note);
    else notes.delete(id);
    if (active === id && !note) chooseAvailable();
    else if (active !== id && !notes.has(active) && !editor.value && note) active = id;
    if (active === id || oldActive !== active) render();
    else renderPicker();
  }

  watchNotes((key, value) => {
    if (pendingChanges) pendingChanges.push([key, value]);
    else changed(key, value);
  });
  try {
    for (const [key, value] of await readNotes()) {
      const note = parseNote(key, value);
      if (note) notes.set(note.id, note);
    }
    chooseAvailable();
    render();
    for (const [key, value] of pendingChanges) changed(key, value);
  } catch {
    render();
    status.textContent = "读取失败，请重新打开新标签页";
  }
  pendingChanges = null;
  root.replaceChildren(toolbar, confirmation, editor, preview, footer, tools);

  async function save(text, changes = {}) {
    const previous = notes.get(active) || draft;
    const note = { ...previous, ...changes, text, updated: Date.now(), writer, revision: ++revision };
    localRevisions.set(note.id, note.revision);
    notes.set(note.id, note);
    status.textContent = "保存中…";
    renderPicker();
    updateCount();
    try {
      await putNote(note);
      if (active === note.id && notes.get(active) === note) status.textContent = "已保存到本机";
    } catch {
      if (active === note.id && notes.get(active) === note) status.textContent = "保存失败，请复制正文备份";
    }
  }

  editor.addEventListener("input", () => save(editor.value));
  title.addEventListener("change", () => save(editor.value, { title: title.value.trim() }));
  search.addEventListener("input", renderResults);
  sort.addEventListener("change", renderPicker);
  pin.addEventListener("click", () => save(editor.value, { pinned: !notes.get(active)?.pinned }));
  toggle.addEventListener("click", () => {
    preview.hidden = !preview.hidden;
    editor.hidden = !preview.hidden;
    toggle.textContent = preview.hidden ? "图文预览" : "编辑正文";
    if (!preview.hidden) renderPreview(notes.get(active) || draft);
  });
  insert.addEventListener("click", () => file.click());
  function insertMarkup(markup) {
    preview.hidden = true;
    editor.hidden = false;
    toggle.textContent = "图文预览";
    editor.setRangeText(markup, editor.selectionStart, editor.selectionEnd, "end");
    save(editor.value);
    editor.focus();
  }
  bold.addEventListener("click", () => {
    const chosen = editor.value.slice(editor.selectionStart, editor.selectionEnd);
    insertMarkup("**" + (chosen || "加粗文字") + "**");
    if (!chosen) editor.setSelectionRange(editor.selectionEnd - 6, editor.selectionEnd - 2);
  });
  link.addEventListener("click", () => {
    const entered = window.prompt("输入链接地址", "https://");
    if (!entered) return;
    try {
      const url = new URL(entered.trim());
      if (!["https:", "http:"].includes(url.protocol)) throw new Error();
      const text = (editor.value.slice(editor.selectionStart, editor.selectionEnd) || url.hostname).replace(/[\[\]\n\r]/g, " ");
      insertMarkup("[" + text + "](" + url.href.replace(/\)/g, "%29") + ")");
    } catch { status.textContent = "请输入有效的 HTTP 或 HTTPS 网页地址。"; }
  });
  file.addEventListener("change", async () => {
    const upload = file.files[0];
    file.value = "";
    if (!upload) return;
    const target = active;
    const blobUrl = URL.createObjectURL(upload);
    try {
      const image = new Image();
      image.src = blobUrl;
      await image.decode();
      const ratio = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      if (active !== target) return;
      const id = crypto.randomUUID();
      const alt = upload.name.replace(/[\[\]\n\r]/g, " ");
      const marker = "![" + alt + "](image:" + id + ")";
      editor.setRangeText(marker, editor.selectionStart, editor.selectionEnd, "end");
      await save(editor.value, { images: {...notes.get(active)?.images, [id]: canvas.toDataURL("image/webp", 0.78)} });
      preview.hidden = false;
      editor.hidden = true;
      toggle.textContent = "编辑正文";
      renderPreview(notes.get(active) || draft);
    } catch { status.textContent = "图片读取失败，请换一张图片。"; }
    finally { URL.revokeObjectURL(blobUrl); }
  });
  select.addEventListener("change", () => {
    active = select.value;
    render();
  });
  add.addEventListener("click", () => {
    draft = blankNote();
    active = draft.id;
    preview.hidden = true;
    editor.hidden = false;
    toggle.textContent = "图文预览";
    render();
    save("");
    editor.focus();
  });
  del.addEventListener("click", () => {
    confirming = true;
    confirmation.hidden = false;
    cancel.focus();
  });
  cancel.addEventListener("click", () => {
    confirming = false;
    confirmation.hidden = true;
    del.focus();
  });
  accept.addEventListener("click", async () => {
    if (!confirming || deleting) return;
    const target = active;
    deleting = true;
    try {
      await removeNote(target);
      notes.delete(target);
      if (active === target) chooseAvailable();
      render();
      editor.focus();
    } catch {
      status.textContent = "删除失败，请重试";
    } finally {
      deleting = false;
    }
  });
}
