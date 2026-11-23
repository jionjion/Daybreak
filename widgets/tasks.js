const itemPrefix = "daybreak.tasks.item.";
const donePrefix = "daybreak.tasks.done.";
const editPrefix = "daybreak.tasks.edit.";
const reminderPrefix = "daybreak.tasks.reminder.";
const badgeKey = "daybreak.tasks.badge";
function taskKeys(id) { return [itemPrefix, donePrefix, editPrefix, reminderPrefix].map(prefix => prefix + id); }
const filters = [
  ["all", "全部", "还没有待办"],
  ["open", "待完成", "没有待完成的事项"],
  ["done", "已完成", "还没有已完成的事项"],
];

function isTaskKey(key) {
  return key?.startsWith("daybreak.tasks.");
}

function taskStorage() {
  const storage = globalThis.chrome?.storage;
  if (storage?.local) {
    return {
      read: async () => storage.local.get(storage.local.getKeys ? (await storage.local.getKeys()).filter(isTaskKey) : null),
      write: (key, value) => storage.local.set({ [key]: value }),
      remove: (keys) => storage.local.remove(keys),
      listen(update) {
        const listener = (changes, area) => {
          if (area === "local" && Object.keys(changes).some(isTaskKey)) update();
        };
        storage.onChanged.addListener(listener);
        return () => storage.onChanged.removeListener(listener);
      },
    };
  }
  return {
    read() {
      const values = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!isTaskKey(key)) continue;
        try {
          values[key] = JSON.parse(localStorage.getItem(key));
        } catch {
          // Ignore a malformed record without hiding other tasks.
        }
      }
      return values;
    },
    write: (key, value) => localStorage.setItem(key, JSON.stringify(value)),
    remove: (keys) => keys.forEach((key) => localStorage.removeItem(key)),
    listen(update) {
      const listener = (event) => {
        if (event.storageArea === localStorage && (event.key === null || isTaskKey(event.key))) update();
      };
      window.addEventListener("storage", listener);
      return () => window.removeEventListener("storage", listener);
    },
  };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountTasks(root) {
  root.classList.add("tasks-widget");
  const header = element("div", "tasks-header");
  const title = element("h2", "tasks-title", "待办事项");
  const count = element("span", "tasks-count");
  count.setAttribute("aria-live", "polite");
  header.append(title, count);

  const filterBar = element("div", "tasks-filters");
  filterBar.setAttribute("role", "group");
  filterBar.setAttribute("aria-label", "筛选待办事项");
  const list = element("ul", "tasks-list");
  list.setAttribute("aria-label", "待办事项列表");
  const empty = element("p", "tasks-empty");
  const form = element("form", "tasks-form");
  const input = element("input", "tasks-input");
  input.type = "text";
  input.placeholder = "添加一项待办…";
  input.setAttribute("aria-label", "新待办事项");
  input.autocomplete = "off";
  const add = element("button", "tasks-add", "+");
  add.type = "submit";
  add.title = "添加待办";
  add.setAttribute("aria-label", "添加待办");
  form.append(input, add);
  const errorMessage = element("p", "tasks-error");
  errorMessage.setAttribute("role", "alert");
  errorMessage.hidden = true;
  empty.hidden = true;
  const management = element("details", "tasks-management");
  const summary = element("summary", "tasks-management-label", "管理待办");
  const search = element("input", "tasks-field");
  search.type = "search"; search.placeholder = "搜索待办"; search.setAttribute("aria-label", search.placeholder);
  const sort = element("select", "tasks-field");
  sort.setAttribute("aria-label", "待办排序");
  sort.append(new Option("最新添加", "recent"), new Option("较早添加", "old"), new Option("按提醒时间", "reminder"), new Option("按名称", "text"));
  const clear = element("button", "tasks-action", "清除已完成"); clear.type = "button";
  const badgeLabel = element("label", "tasks-badge-label");
  const badge = element("input", "tasks-badge"); badge.type = "checkbox";
  badgeLabel.append(badge, "在扩展和待办图标上显示未完成数量");
  const filterFields = element("div", "tasks-search-sort");
  filterFields.append(search, sort);
  management.append(summary, filterFields, badgeLabel, clear);
  root.append(header, form, filterBar, list, empty, management, errorMessage);

  const storage = taskStorage();
  let tasks = [];
  let filter = "all";
  let revision = 0;
  let active = true;

  function showError(message) {
    if (!active) return;
    errorMessage.textContent = message;
    errorMessage.hidden = !message;
  }

  function render() {
    const completedCount = tasks.filter((task) => task.done).length;
    root.dispatchEvent(new CustomEvent("daybreak-task-count",{bubbles:true,detail:badge.checked?tasks.length-completedCount:0}));
    count.textContent = `已完成 ${completedCount} / ${tasks.length}`;
    for (const button of filterBar.children) {
      button.setAttribute("aria-pressed", String(button.dataset.filter === filter));
    }
    const q = search.value.trim().toLocaleLowerCase();
    const visible = tasks.filter(task => (filter === "all" || task.done === (filter === "done")) && task.text.toLocaleLowerCase().includes(q))
      .sort((a, b) => Number(a.done) - Number(b.done) || (sort.value === "text" ? a.text.localeCompare(b.text, "zh-CN") :
        sort.value === "reminder" ? (a.reminder || Infinity) - (b.reminder || Infinity) :
        sort.value === "old" ? a.created - b.created : b.created - a.created) || a.id.localeCompare(b.id));
    clear.disabled = completedCount === 0;
    const focused = document.activeElement;
    const focusedRow = list.contains(focused) ? focused.closest("li") : null;
    const focusIndex = focusedRow ? Array.from(list.children).indexOf(focusedRow) : -1;
    const focusClass = focused?.classList.contains("tasks-delete") ? ".tasks-delete" : ".tasks-check";
    const rows = visible.map((task) => {
      const row = element("li", "tasks-item");
      row.dataset.id = task.id;
      row.dataset.completed = String(task.done);
      const checkbox = element("input", "tasks-check");
      checkbox.type = "checkbox";
      checkbox.checked = task.done;
      const label = element("label", "tasks-text", task.text);
      checkbox.id = `daybreak-task-${task.id}`;
      label.htmlFor = checkbox.id;
      const remove = element("button", "tasks-delete", "×");
      remove.type = "button";
      remove.title = "删除待办";
      remove.setAttribute("aria-label", `删除待办「${task.text}」`);
      const edit = element("button", "tasks-edit", "编辑");
      edit.type = "button"; edit.setAttribute("aria-label", "编辑待办 " + task.text);
      edit.addEventListener("click", () => editTask(task));
      if (task.reminder && !task.done) {
        const when = element("small", "tasks-when", new Date(task.reminder).toLocaleString("zh-CN",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}));
        label.append(when);
      }
      row.append(checkbox, label, edit, remove);
      return row;
    });
    list.replaceChildren(...rows);
    empty.textContent = q ? "没有匹配的待办" : filters.find(([value]) => value === filter)[2];
    empty.hidden = rows.length > 0;
    if (focusedRow) {
      const nextRow = rows.find((row) => row.dataset.id === focusedRow.dataset.id)
        ?? rows[Math.min(focusIndex, rows.length - 1)];
      (nextRow?.querySelector(focusClass) ?? input).focus({ preventScroll: true });
    }
  }

  async function refresh() {
    const current = ++revision;
    try {
      const values = await storage.read();
      if (!active || current !== revision) return;
      tasks = Object.entries(values)
        .filter(([key, item]) => key.startsWith(itemPrefix) && typeof item?.text === "string")
        .map(([key, item]) => {
          const id = key.slice(itemPrefix.length);
          return { id, text: values[editPrefix + id] || item.text, created: item.created, done: values[donePrefix + id] === true, reminder: values[reminderPrefix + id] };
        })
        .sort((a, b) => Number(a.done) - Number(b.done) || b.created - a.created || a.id.localeCompare(b.id));
      badge.checked = !!values[badgeKey];
      render();
    } catch {
      if (active && current === revision) showError("读取待办事项失败。请刷新页面重试。");
    }
  }

  let pending = Promise.resolve();
  function editTask(task) {
    const dialog = element("dialog", "tasks-dialog");
    dialog.setAttribute("aria-label", "编辑待办");
    dialog.innerHTML = '<form novalidate><h3>编辑待办</h3><label>待办内容<input class="tasks-field" name="text" required></label><label>本地提醒<input class="tasks-field" name="remind" type="datetime-local"></label><p role="status"></p><div><button type="button">取消</button><button type="submit">保存</button></div></form>';
    root.append(dialog);
    const form = dialog.querySelector("form"), title = form.elements.text, date = form.elements.remind;
    title.value = task.text; date.disabled = !!task.done;
    if (task.reminder) {
      const d = new Date(task.reminder);
      date.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16);
    }
    dialog.querySelector('[type="button"]').onclick = () => dialog.close();
    dialog.onclose = () => dialog.remove();
    form.onsubmit = async event => {
      event.preventDefault();
      const error = dialog.querySelector('[role="status"]');
      const text = title.value.trim();
      const when = date.value ? new Date(date.value).getTime() : null;
      if (!text) { title.focus(); return; }
      const nextMinute = task.reminder && Math.floor(task.reminder/60000) === Math.floor(when/60000);
      if (!nextMinute && when && when <= Date.now()) { error.textContent = "请选择未来的提醒时间。";return; }
      try {
        if (!task.done && when && !nextMinute && !(await globalThis.chrome?.permissions?.request({permissions:["notifications"]}))) {
          error.textContent = "请允许系统通知，或清空提醒时间后保存。"; return;
        }
        if (!(await storage.read())[itemPrefix + task.id]) { error.textContent = "此待办已在其他页面删除。"; return; }
        await storage.write(editPrefix + task.id, text);
        if (!task.done && !nextMinute) {
          if (when) await storage.write(reminderPrefix + task.id, when);
          else await storage.remove([reminderPrefix + task.id]);
        }
        dialog.close(); await refresh();
      } catch { error.textContent = "无法保存待办或提醒，请重试。"; }
    };
    dialog.showModal(); title.focus();
  }
  search.addEventListener("input", render);
  sort.addEventListener("change", render);
  badge.addEventListener("change", () => save(() => storage.write(badgeKey, badge.checked)));
  clear.addEventListener("click", () => {
    const done = tasks.filter(task => task.done);
    if (done.length && window.confirm("删除 " + done.length + " 项已完成的待办？")) save(async () => {
      const values = await storage.read();
      await storage.remove(done.filter(task => values[donePrefix + task.id]).flatMap(task => taskKeys(task.id)));
    });
  });
  function save(operation, recover) {
    pending = pending.then(async () => {
      try {
        await operation();
        showError("");
        await refresh();
      } catch {
        if (active) {
          recover?.();
          await refresh();
          showError("保存更改失败。请重试。");
        }
      }
    });
  }

  for (const [value, label] of filters) {
    const button = element("button", "tasks-filter", label);
    button.type = "button";
    button.dataset.filter = value;
    button.setAttribute("aria-pressed", String(value === filter));
    button.addEventListener("click", () => {
      filter = value;
      render();
    });
    filterBar.append(button);
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }
    const id = crypto.randomUUID();
    const record = { text, created: Date.now() };
    input.value = "";
    if (filter === "done") filter = "all";
    input.focus();
    save(() => storage.write(itemPrefix + id, record), () => {
      if (!input.value) input.value = text;
    });
  });
  list.addEventListener("change", (event) => {
    if (!event.target.matches(".tasks-check")) return;
    const id = event.target.closest("li").dataset.id;
    const done = event.target.checked;
    // Completion has its own key so an edit in another tab cannot revive a deleted task.
    save(async () => {
      if (done) {
        await storage.write(donePrefix + id, true);
        await storage.remove([reminderPrefix + id]);
      } else await storage.remove([donePrefix + id]);
    });
  });
  list.addEventListener("click", (event) => {
    const button = event.target.closest(".tasks-delete");
    if (!button) return;
    const id = button.closest("li").dataset.id;
    save(() => storage.remove(taskKeys(id)));
  });
  const stopListening = storage.listen(refresh);
  refresh();
  return () => {
    active = false;
    stopListening();
    root.replaceChildren();
    root.classList.remove("tasks-widget");
  };
}
