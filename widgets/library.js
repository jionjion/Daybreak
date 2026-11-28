import { el, webAddress } from "../shared/dom.js";
import { createModal } from "../shared/modal.js";
import { getValue, onStorageChange } from "../shared/storage.js";

const pageSize = 60;

export function bookmarkLibrary(tree) {
  const rows = [];
  const folders = [];
  function visit(nodes, path, ancestors, inheritedReadOnly) {
    for (const item of nodes) {
      const readOnly = inheritedReadOnly || Boolean(item.unmodifiable) || item.folderType === "managed";
      if (typeof item.url !== "string") {
        const title = item.title || "未命名文件夹";
        const group = [...path, title];
        folders.push({
          id: item.id,
          title,
          path: group.join(" / "),
          writable: !readOnly,
          nonEmpty: Boolean(item.children?.length),
          mutable: !readOnly && ancestors.length > 0 && !item.folderType,
        });
        visit(item.children || [], group, [...ancestors, item.id], readOnly);
        continue;
      }
      const url = webAddress(item.url);
      if (url) {
        rows.push({
          id: item.id,
          parentId: item.parentId,
          title: item.title || url.hostname,
          sourceTitle: item.title,
          sourceUrl: item.url,
          url,
          group: path.join(" / ") || "书签",
          ancestors,
          mutable: !readOnly,
        });
      }
    }
  }
  for (const root of tree) visit(root.children || [], [], [], Boolean(root.unmodifiable));
  return { rows, folders };
}

function linkRow(item) {
  const row = el("a", "library-row");
  row.href = item.url.href;
  row.target = "_blank";
  row.rel = "noopener noreferrer";
  row.title = item.url.href;
  const host = item.url.hostname.replace(/^www\./i, "");
  const mark = el("span", "library-mark", host.slice(0, 1).toUpperCase());
  mark.setAttribute("aria-hidden", "true");
  const body = el("span", "library-link-body");
  body.append(el("strong", "library-link-title", item.title), el("span", "library-url", host));
  row.append(mark, body);
  const arrow = el("span", "library-arrow", "↗");
  arrow.setAttribute("aria-hidden", "true");
  row.append(arrow);
  return row;
}

function button(label, className, onClick) {
  const node = el("button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

async function editBookmark(api, record, values) {
  const [old] = await api.get(record.id);
  if (!old || old.url !== record.sourceUrl || old.title !== record.sourceTitle || old.parentId !== record.parentId) {
    throw new Error("这条书签已更改，请关闭后重新打开编辑。");
  }
  const moving = values.parentId !== old.parentId;
  const updating = values.title !== old.title || values.url !== old.url;
  if (moving) await api.move(record.id, { parentId: values.parentId });
  if (!updating) return;
  try {
    await api.update(record.id, { title: values.title, url: values.url });
  } catch (error) {
    if (moving) {
      try {
        const [current] = await api.get(record.id);
        if (current.parentId === values.parentId && current.title === old.title && current.url === old.url) {
          await api.move(record.id, { parentId: old.parentId, index: old.index });
        }
      } catch { /* Browser state may have changed again in another tab. */ }
    }
    throw error;
  }
}

export function mountLibrary(root) {
  const api = globalThis.chrome?.bookmarks;
  const panel = el("div", "library-panel");
  const bar = el("div", "library-toolbar");
  const field = el("label", "library-search");
  const glass = el("span", "library-glass");
  glass.setAttribute("aria-hidden", "true");
  const input = el("input", "library-input");
  input.type = "search";
  input.placeholder = "搜索书签名称、网址或文件夹";
  input.setAttribute("aria-label", input.placeholder);
  field.append(glass, input);
  const status = el("span", "library-status", "正在读取…");
  status.setAttribute("role", "status");
  bar.append(field, status);
  const list = el("div", "library-list");
  const folderBar = el("div", "library-folder-bar");
  folderBar.hidden = true;
  const scope = el("select", "library-field");
  scope.setAttribute("aria-label", "浏览书签文件夹");
  const add = button("新建书签", "library-primary", () => bookmarkForm());
  const newFolder = button("新建文件夹", "library-button", () => folderForm());
  const rename = button("重命名文件夹", "library-button", () => folderForm(selectedFolder()));
  const removeFolder = button("删除文件夹", "library-text-button", () => confirmRemove(selectedFolder(), true));
  folderBar.append(scope, add, newFolder, rename, removeFolder);
  const feedback = el("p", "library-feedback");
  feedback.setAttribute("role", "status");
  const more = el("button", "library-more", "显示更多");
  more.type = "button";
  more.hidden = true;
  panel.append(bar);
  if (api) panel.append(folderBar);
  panel.append(feedback, list, more);
  root.replaceChildren(panel);

  let bookmarks = [];
  let folders = [];
  let focusNext = null;
  let limit = pageSize;
  let generation = 0;
  let timer;
  let active = true;
  const listeners = [];
  const targetKey = "daybreak.layout.bookmarksNewTab";
  let openNew = false;

  const changeTarget = value => {
    openNew = value === true;
    for (const a of list.querySelectorAll(".library-row")) {
      a.target = openNew ? "_blank" : "_self";
    }
  };
  const unsubscribeStorage = onStorageChange([targetKey], changes => {
    if (targetKey in changes) changeTarget(changes[targetKey].newValue);
  });
  getValue(targetKey).then(value => {
    if (active) changeTarget(value);
  }).catch(() => {});

  function selectedFolder() {
    return folders.find(folder => folder.id === scope.value);
  }

  function updateFolders(next) {
    const selected = scope.value;
    folders = next;
    scope.replaceChildren(new Option("全部文件夹", ""), ...folders.map(item => new Option(item.path, item.id)));
    if (folders.some(item => item.id === selected)) scope.value = selected;
    const canCreate = folders.some(item => item.writable);
    add.disabled = newFolder.disabled = !canCreate;
    folderBar.hidden = false;
  }

  function saved(message) {
    if (!active) return;
    feedback.textContent = message;
    schedule();
  }

  function bookmarkForm(record) {
    const editor = createModal(panel, { title: record ? "编辑书签" : "新建书签", submitLabel: "保存" });
    const title = editor.text("名称", record?.sourceTitle || "", { required: false });
    const url = editor.text("网页地址", record?.url.href || "", { placeholder: "https://example.com", inputMode: "url" });
    const parent = editor.select("所在文件夹", folders.filter(item => item.writable), record?.parentId || scope.value);
    editor.open(async () => {
      const raw = url.value.trim();
      const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(raw);
      const hasPort = /^[\w.-]+:\d+(?:[/?#]|$)/.test(raw);
      const address = webAddress(hasScheme && !hasPort ? raw : "https://" + raw);
      if (!address || /\s/.test(raw) || address.username || address.password) {
        throw new Error("请输入有效的 HTTP 或 HTTPS 网页地址。");
      }
      const values = { title: title.value.trim() || address.hostname, url: address.href, parentId: parent.value };
      if (record) await editBookmark(api, record, values);
      else await api.create(values);
      saved(record ? "已更新浏览器书签。" : "已添加浏览器书签。");
    });
  }

  function folderForm(record) {
    const editor = createModal(panel, { title: record ? "重命名文件夹" : "新建文件夹", submitLabel: "保存" });
    const nameInput = editor.text("文件夹名称", record?.title || "");
    const parent = record ? null : editor.select("所在文件夹", folders.filter(item => item.writable), scope.value);
    editor.open(async () => {
      const title = nameInput.value.trim();
      if (!title) throw new Error("请输入文件夹名称。");
      if (record) await api.update(record.id, { title });
      else await api.create({ title, parentId: parent.value });
      saved(record ? "已重命名文件夹。" : "已新建文件夹。");
    });
  }

  function confirmRemove(record, isFolder = false) {
    const label = isFolder ? "文件夹" : "书签";
    const confirm = createModal(panel, { title: "删除" + label, submitLabel: "确认删除", destructive: true });
    const identity = isFolder ? record.path : record.title;
    confirm.content.append(el("strong", "daybreak-confirm-title", identity));
    if (!isFolder) confirm.content.append(el("span", "daybreak-confirm-url", record.url.href));
    const message = isFolder && record.nonEmpty
      ? "此文件夹中的所有书签和子文件夹也将一并从浏览器中删除。"
      : "将从浏览器中删除这个" + label + "。";
    confirm.content.append(el("p", "daybreak-confirm-message", message));
    confirm.open(async () => {
      if (isFolder && record.nonEmpty) await api.removeTree(record.id);
      else await api.remove(record.id);
      saved("已删除" + label + "。");
    });
  }

  function render() {
    const query = input.value.trim().toLocaleLowerCase();
    const visibleRows = bookmarks.filter(item =>
      (!scope.value || item.ancestors.includes(scope.value)) &&
      (!query || [item.title, item.url.href, item.group].some(value => value.toLocaleLowerCase().includes(query)))
    );
    rename.hidden = removeFolder.hidden = !selectedFolder()?.mutable;
    const count = visibleRows.length;
    status.textContent = count + " 个网页书签";
    more.hidden = count <= limit;
    const fragment = document.createDocumentFragment();
    let lastGroup;
    for (const item of visibleRows.slice(0, limit)) {
      if (item.group !== lastGroup) {
        fragment.append(el("h3", "library-group", item.group));
        lastGroup = item.group;
      }
      const entry = el("div", "library-entry");
      const link = linkRow(item);
      link.target = openNew ? "_blank" : "_self";
      entry.append(link);
      if (item.mutable) {
        const edit = button("编辑", "library-text-button", () => bookmarkForm(item));
        edit.setAttribute("aria-label", "编辑书签 " + item.title);
        entry.append(edit);
        const del = button("删除", "library-text-button", () => confirmRemove(item));
        del.setAttribute("aria-label", "删除书签 " + item.title);
        entry.append(del);
      }
      fragment.append(entry);
    }
    if (!count) {
      const message = query ? "没有匹配的网页，试试其他关键词。" : "这个位置还没有网页书签。";
      fragment.append(el("p", "library-empty", message));
    }
    list.replaceChildren(fragment);
    if (focusNext !== null) {
      list.querySelectorAll(".library-row")[focusNext]?.focus();
      focusNext = null;
    }
  }

  async function refresh(request) {
    try {
      const tree = await api.getTree();
      if (request !== generation) return;
      const library = bookmarkLibrary(tree);
      bookmarks = library.rows;
      updateFolders(library.folders);
      render();
    } catch {
      if (request !== generation) return;
      status.textContent = "";
      list.replaceChildren(el("p", "library-empty", "读取书签失败，请检查扩展权限后重试。"));
      more.hidden = true;
    }
  }

  function schedule() {
    const request = ++generation;
    clearTimeout(timer);
    timer = setTimeout(() => refresh(request), 120);
  }

  input.addEventListener("input", () => { limit = pageSize; focusNext = null; render(); });
  scope.addEventListener("change", () => { limit = pageSize; render(); });
  more.addEventListener("click", () => {
    focusNext = list.querySelectorAll(".library-row").length;
    limit += pageSize;
    render();
  });

  if (api && typeof api.getTree === "function") {
    const events = [api.onCreated, api.onRemoved, api.onChanged, api.onMoved, api.onChildrenReordered, api.onImportEnded];
    for (const event of events) {
      if (!event) continue;
      event.addListener(schedule);
      listeners.push(event);
    }
    refresh(++generation);
  } else {
    input.disabled = true;
    status.textContent = "";
    list.replaceChildren(el("p", "library-empty", "请通过已加载的晨屿扩展打开此页，并允许读取书签。"));
  }

  return () => {
    active = false;
    generation++;
    clearTimeout(timer);
    for (const event of listeners) event.removeListener(schedule);
    unsubscribeStorage();
    panel.remove();
  };
}
