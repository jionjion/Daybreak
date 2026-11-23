const historyBatch = 250;
const pageSize = 60;
const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "long", day: "numeric", weekday: "short"
});
const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function webAddress(value) {
  try {
    const address = new URL(value);
    return ["https:", "http:"].includes(address.protocol) ? address : null;
  } catch {
    return null;
  }
}

function bookmarkLibrary(tree) {
  const rows = [];
  const folders = [];
  function visit(nodes, path, ancestors, inheritedReadOnly) {
    for (const item of nodes) {
      const readOnly = inheritedReadOnly || Boolean(item.unmodifiable) || item.folderType === "managed";
      if (typeof item.url !== "string") {
        const title = item.title || "未命名文件夹";
        const group = [...path, title];
        folders.push({
          id: item.id, title, path: group.join(" / "), writable: !readOnly, nonEmpty: Boolean(item.children?.length),
          mutable: !readOnly && ancestors.length > 0 && !item.folderType
        });
        visit(item.children || [], group, [...ancestors, item.id], readOnly);
        continue;
      }
      const url = webAddress(item.url);
      if (url) rows.push({
        id: item.id, parentId: item.parentId, title: item.title || url.hostname,
        sourceTitle: item.title, sourceUrl: item.url, url, group: path.join(" / ") || "书签", ancestors, mutable: !readOnly
      });
    }
  }
  for (const root of tree) visit(root.children || [], [], [], Boolean(root.unmodifiable));
  return { rows, folders };
}

function historyRows(items) {
  const rows = [];
  for (const item of items) {
    const url = webAddress(item.url);
    if (!url) continue;
    const date = new Date(item.lastVisitTime);
    const validTime = Number.isFinite(date.getTime());
    rows.push({
      title: item.title || url.hostname, url,
      group: validTime ? dateFormat.format(date) : "更早",
      time: validTime ? timeFormat.format(date) : ""
    });
  }
  return rows;
}

function linkRow(item) {
  const row = element("a", "library-row");
  row.href = item.url.href;
  row.target = "_blank";
  row.rel = "noopener noreferrer";
  row.title = item.url.href;
  const host = item.url.hostname.replace(/^www\./i, "");
  const mark = element("span", "library-mark", host.slice(0, 1).toUpperCase());
  mark.setAttribute("aria-hidden", "true");
  const body = element("span", "library-link-body");
  body.append(element("strong", "library-link-title", item.title), element("span", "library-url", host));
  row.append(mark, body);
  if (item.time) row.append(element("span", "library-time", item.time));
  const arrow = element("span", "library-arrow", "↗");
  arrow.setAttribute("aria-hidden", "true");
  row.append(arrow);
  return row;
}

function button(label, className, onClick) {
  const node = element("button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function modal(panel, title, submitLabel, destructive = false) {
  const dialog = element("dialog", "library-dialog");
  dialog.setAttribute("aria-label", title);
  const form = element("form", "library-form");
  form.noValidate = true;
  const content = element("div", "library-fields");
  const error = element("p", "library-error");
  error.setAttribute("role", "alert");
  const buttons = element("div", "library-actions");
  const cancel = button("取消", "library-button", () => dialog.close());
  const submit = element("button", destructive ? "library-danger" : "library-primary", submitLabel);
  submit.type = "submit";
  buttons.append(cancel, submit);
  form.append(element("h3", "library-dialog-title", title), content, error, buttons);
  dialog.append(form);
  panel.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.addEventListener("cancel", event => { if (submit.disabled) event.preventDefault(); });
  function labeled(label, node) {
    const wrapper = element("label", "library-label", label);
    wrapper.append(node);
    content.append(wrapper);
    return node;
  }
  return {
    content,
    text(label, value = "") {
      const node = element("input", "library-field");
      node.required = true;
      node.value = value;
      return labeled(label, node);
    },
    folder(choices, selected) {
      const node = element("select", "library-field");
      node.required = true;
      node.append(...choices.map(item => new Option(item.path, item.id)));
      if (choices.some(item => item.id === selected)) node.value = selected;
      return labeled("所在文件夹", node);
    },
    open(onSubmit) {
      form.addEventListener("submit", async event => {
        event.preventDefault();
        if (submit.disabled) return;
        submit.disabled = cancel.disabled = true;
        error.textContent = "";
        try {
          await onSubmit();
          dialog.close();
        } catch (problem) {
          error.textContent = problem.message || "操作失败，请重试。";
        } finally {
          submit.disabled = cancel.disabled = false;
        }
      });
      if (destructive) cancel.autofocus = true;
      dialog.showModal();
      if (destructive) cancel.focus();
    }
  };
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

export function mountLibrary(root, mode) {
  const history = mode === "history";
  const label = history ? "历史记录" : "书签";
  const api = globalThis.chrome?.[history ? "history" : "bookmarks"];
  const panel = element("div", "library-panel");
  const bar = element("div", "library-toolbar");
  const field = element("label", "library-search");
  const glass = element("span", "library-glass");
  glass.setAttribute("aria-hidden", "true");
  const input = element("input", "library-input");
  input.type = "search";
  input.placeholder = history ? "搜索浏览过的网页" : "搜索书签名称、网址或文件夹";
  input.setAttribute("aria-label", input.placeholder);
  field.append(glass, input);
  const status = element("span", "library-status", "正在读取…");
  status.setAttribute("role", "status");
  bar.append(field);
  const range = element("select", "library-field");
  range.setAttribute("aria-label", "历史时间范围");
  for (const days of [7, 30, 90, 0]) {
    range.append(new Option(days ? "最近 " + days + " 天" : "全部时间", String(days)));
  }
  range.value = "30";
  if (history) {
    bar.append(range);
    if (api) bar.append(button("清除历史记录", "library-text-button", () => {
      const days = Number(range.value);
      const title = days ? "清除最近 " + days + " 天的历史记录" : "清除全部历史记录";
      const confirm = modal(panel, title, "确认清除", true);
      confirm.content.append(element("p", "library-confirm-message", "将从浏览器清除所选时间内的全部访问，包括当前搜索未显示的网页。操作无法撤销。"));
      confirm.open(async () => {
        if (days) {
          const endTime = Date.now();
          await api.deleteRange({startTime: endTime - days * 86400000, endTime});
        } else await api.deleteAll();
        saved("已清除所选时间内的浏览记录。");
      });
    }));
  }
  bar.append(status);
  const list = element("div", "library-list");
  const folderBar = element("div", "library-folder-bar");
  folderBar.hidden = true;
  const scope = element("select", "library-field");
  scope.setAttribute("aria-label", "浏览书签文件夹");
  const add = button("新建书签", "library-primary", () => bookmarkForm());
  const newFolder = button("新建文件夹", "library-button", () => folderForm());
  const rename = button("重命名文件夹", "library-button", () => folderForm(selectedFolder()));
  const removeFolder = button("删除文件夹", "library-text-button", () => confirmRemove(selectedFolder(), true));
  folderBar.append(scope, add, newFolder, rename, removeFolder);
  const feedback = element("p", "library-feedback");
  feedback.setAttribute("role", "status");
  const more = element("button", "library-more", "显示更多");
  more.type = "button";
  more.hidden = true;
  panel.append(bar);
  if (!history && api) panel.append(folderBar);
  panel.append(feedback, list, more);
  root.replaceChildren(panel);

  let bookmarks = [];
  let folders = [];
  let rows = [];
  let historyFetched = historyBatch;
  let moreHistory = false;
  let focusNext = null;
  let limit = pageSize;
  let generation = 0;
  let timer;
  let active = true;
  const listeners = [];
  const targetKey = "daybreak.layout." + (history ? "historyNewTab" : "bookmarksNewTab");
  let openNew = true;
  const changeTarget = value => {
    openNew = value !== false;
    for (const a of list.querySelectorAll(".library-row")) a.target = openNew ? "_blank" : "_self";
  };
  const preferenceChanged = (changes, area) => {
    if (area === "local" && targetKey in changes) changeTarget(changes[targetKey].newValue);
  };
  globalThis.chrome?.storage?.onChanged.addListener(preferenceChanged);
  globalThis.chrome?.storage?.local.get(targetKey).then(data => { if (active) changeTarget(data[targetKey]); }).catch(() => {});

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
    const editor = modal(panel, record ? "编辑书签" : "新建书签", "保存");
    const title = editor.text("名称", record?.sourceTitle);
    title.required = false;
    const url = editor.text("网页地址", record?.url.href);
    url.placeholder = "https://example.com";
    url.inputMode = "url";
    const parent = editor.folder(folders.filter(item => item.writable), record?.parentId || scope.value);
    editor.open(async () => {
      const raw = url.value.trim();
      const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(raw);
      const hasPort = /^[\w.-]+:\d+(?:[/?#]|$)/.test(raw);
      const address = webAddress(hasScheme && !hasPort ? raw : "https://" + raw);
      if (!address || /\s/.test(raw) || address.username || address.password) throw new Error("请输入有效的 HTTP 或 HTTPS 网页地址。");
      const values = { title: title.value.trim() || address.hostname, url: address.href, parentId: parent.value };
      if (record) await editBookmark(api, record, values);
      else await api.create(values);
      saved(record ? "已更新浏览器书签。" : "已添加浏览器书签。");
    });
  }

  function folderForm(record) {
    const editor = modal(panel, record ? "重命名文件夹" : "新建文件夹", "保存");
    const input = editor.text("文件夹名称", record?.title);
    const parent = record ? null : editor.folder(folders.filter(item => item.writable), scope.value);
    editor.open(async () => {
      const title = input.value.trim();
      if (!title) throw new Error("请输入文件夹名称。");
      if (record) await api.update(record.id, { title });
      else await api.create({ title, parentId: parent.value });
      saved(record ? "已重命名文件夹。" : "已新建文件夹。");
    });
  }

  function confirmRemove(record, isFolder = false) {
    const label = history ? "历史记录" : isFolder ? "文件夹" : "书签";
    const confirm = modal(panel, "删除" + label, "确认删除", true);
    const identity = isFolder ? record.path : record.title;
    confirm.content.append(element("strong", "library-confirm-title", identity));
    if (!isFolder) confirm.content.append(element("span", "library-confirm-url", record.url.href));
    const message = history ? "将删除这个网址的全部浏览记录，包括 30 天之前的访问。"
      : isFolder && record.nonEmpty ? "此文件夹中的所有书签和子文件夹也将一并从浏览器中删除。"
      : "将从浏览器中删除这个" + label + "。";
    confirm.content.append(element("p", "library-confirm-message", message));
    confirm.open(async () => {
      if (history) await api.deleteUrl({ url: record.url.href });
      else if (isFolder && record.nonEmpty) await api.removeTree(record.id);
      else await api.remove(record.id);
      saved("已删除" + label + "。");
    });
  }

  function render() {
    const query = input.value.trim().toLocaleLowerCase();
    const visibleRows = history ? rows : bookmarks.filter(item =>
      (!scope.value || item.ancestors.includes(scope.value)) &&
      (!query || [item.title, item.url.href, item.group].some(value => value.toLocaleLowerCase().includes(query)))
    );
    rename.hidden = removeFolder.hidden = !selectedFolder()?.mutable;
    const count = visibleRows.length;
    status.textContent = history
      ? (moreHistory ? "已读取最近 " : "共 ") + count + " 个网页"
      : count + " 个网页书签";
    more.hidden = count <= limit && !(history && moreHistory);
    const fragment = document.createDocumentFragment();
    let lastGroup;
    for (const item of visibleRows.slice(0, limit)) {
      if (item.group !== lastGroup) {
        fragment.append(element("h3", "library-group", item.group));
        lastGroup = item.group;
      }
      const entry = element("div", "library-entry");
      const link = linkRow(item);
      link.target = openNew ? "_blank" : "_self";
      entry.append(link);
      if (history || item.mutable) {
        if (!history) {
          const edit = button("编辑", "library-text-button", () => bookmarkForm(item));
          edit.setAttribute("aria-label", "编辑书签 " + item.title);
          entry.append(edit);
        }
        const del = button("删除", "library-text-button", () => confirmRemove(item));
        del.setAttribute("aria-label", "删除" + label + " " + item.title);
        entry.append(del);
      }
      fragment.append(entry);
    }
    if (!count) {
      const message = query ? "没有匹配的网页，试试其他关键词。" :
        history ? "所选时间内还没有匹配的网页记录。" : "这个位置还没有网页书签。";
      fragment.append(element("p", "library-empty", message));
    }
    list.replaceChildren(fragment);
    if (focusNext !== null) {
      list.querySelectorAll(".library-row")[focusNext]?.focus();
      focusNext = null;
    }
  }

  async function refresh(request) {
    try {
      if (history) {
        const start = new Date();
        const days = Number(range.value);
        start.setDate(start.getDate() - days);
        const items = await api.search({ text: input.value.trim(), startTime: days ? start.getTime() : 0, maxResults: historyFetched });
        if (request !== generation) return;
        moreHistory = items.length === historyFetched;
        rows = historyRows(items);
      } else {
        const tree = await api.getTree();
        if (request !== generation) return;
        const library = bookmarkLibrary(tree);
        bookmarks = library.rows;
        updateFolders(library.folders);
      }
      render();
    } catch {
      if (request !== generation) return;
      status.textContent = "";
      list.replaceChildren(element("p", "library-empty", "读取" + label + "失败，请检查扩展权限后重试。"));
      more.hidden = true;
    }
  }

  function schedule() {
    const request = ++generation;
    clearTimeout(timer);
    timer = setTimeout(() => refresh(request), 120);
  }

  function resetSearch() {
    limit = pageSize;
    historyFetched = historyBatch;
    focusNext = null;
    if (history) schedule();
    else render();
  }
  input.addEventListener("input", resetSearch);
  range.addEventListener("change", resetSearch);
  scope.addEventListener("change", () => { limit = pageSize; render(); });
  more.addEventListener("click", () => {
    focusNext = list.querySelectorAll(".library-row").length;
    limit += pageSize;
    if (history && moreHistory && rows.length < limit) {
      historyFetched += historyBatch;
      schedule();
    } else render();
  });
  if (api && typeof api[history ? "search" : "getTree"] === "function") {
    const events = history
      ? [api.onVisited, api.onVisitRemoved]
      : [api.onCreated, api.onRemoved, api.onChanged, api.onMoved, api.onChildrenReordered, api.onImportEnded];
    for (const event of events) {
      if (!event) continue;
      event.addListener(schedule);
      listeners.push(event);
    }
    refresh(++generation);
  } else {
    input.disabled = true;
    status.textContent = "";
    list.replaceChildren(element("p", "library-empty", "请通过已加载的晨屿扩展打开此页，并允许读取" + label + "。"));
  }
  return () => {
    active = false;
    generation++;
    clearTimeout(timer);
    for (const event of listeners) event.removeListener(schedule);
    globalThis.chrome?.storage?.onChanged.removeListener(preferenceChanged);
    panel.remove();
  };
}
