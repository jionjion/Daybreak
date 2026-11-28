import { el } from "./dom.js";

export function createModal(host, { title, submitLabel = "确定", cancelLabel = "取消", destructive = false }) {
  const dialog = el("dialog", "daybreak-dialog");
  dialog.setAttribute("aria-label", title);
  const form = el("form", "daybreak-form");
  form.noValidate = true;
  const content = el("div", "daybreak-fields");
  const error = el("p", "daybreak-error");
  error.setAttribute("role", "alert");
  const buttons = el("div", "daybreak-actions");
  const cancel = el("button", "daybreak-button", cancelLabel);
  cancel.type = "button";
  const submit = el("button", destructive ? "daybreak-danger" : "daybreak-primary", submitLabel);
  submit.type = "submit";
  buttons.append(cancel, submit);
  form.append(el("h3", "daybreak-dialog-title", title), content, error, buttons);
  dialog.append(form);
  (host || document.body).append(dialog);

  cancel.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", event => {
    if (submit.disabled) event.preventDefault();
  });
  dialog.addEventListener("keydown", event => {
    // Keep Esc inside the modal so an outer drawer stays open.
    if (event.key === "Escape") event.stopPropagation();
  });

  function labeled(label, node) {
    const wrapper = el("label", "daybreak-label", label);
    wrapper.append(node);
    content.append(wrapper);
    return node;
  }

  return {
    dialog,
    content,
    text(label, value = "", attrs = {}) {
      const node = el("input", "daybreak-field");
      node.required = true;
      node.value = value;
      for (const [key, val] of Object.entries(attrs)) {
        if (val !== undefined && val !== null) node[key] = val;
      }
      return labeled(label, node);
    },
    select(label, choices, selected) {
      const node = el("select", "daybreak-field");
      node.required = true;
      node.append(...choices.map(item => new Option(item.label ?? item.path ?? item.title, item.value ?? item.id)));
      if (choices.some(item => (item.value ?? item.id) === selected)) node.value = selected;
      return labeled(label, node);
    },
    open(onSubmit) {
      dialog.addEventListener("close", () => dialog.remove(), { once: true });
      form.addEventListener("submit", async event => {
        event.preventDefault();
        if (submit.disabled) return;
        submit.disabled = cancel.disabled = true;
        error.textContent = "";
        try {
          await onSubmit();
          dialog.close();
        } catch (problem) {
          error.textContent = problem?.message || "操作失败，请重试。";
        } finally {
          submit.disabled = cancel.disabled = false;
        }
      });
      if (destructive) cancel.autofocus = true;
      dialog.showModal();
      if (destructive) cancel.focus();
    },
  };
}

export function confirmDialog(
  host,
  { title, heading, detail, message, confirmLabel = "确认删除", cancelLabel = "取消", destructive = true }
) {
  return new Promise(resolve => {
    let settled = false;
    const modal = createModal(host, { title, submitLabel: confirmLabel, cancelLabel, destructive });
    if (heading) modal.content.append(el("strong", "daybreak-confirm-title", heading));
    if (detail) modal.content.append(el("span", "daybreak-confirm-url", detail));
    if (message) modal.content.append(el("p", "daybreak-confirm-message", message));
    modal.dialog.addEventListener("close", () => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }, { once: true });
    modal.open(() => {
      settled = true;
      resolve(true);
    });
  });
}

export function promptDialog(
  host,
  { title, label, value = "", placeholder = "", submitLabel = "确定", cancelLabel = "取消", validate }
) {
  return new Promise(resolve => {
    let settled = false;
    const modal = createModal(host, { title, submitLabel, cancelLabel });
    const input = modal.text(label, value, { placeholder });
    modal.dialog.addEventListener("close", () => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, { once: true });
    modal.open(() => {
      const next = input.value.trim();
      const error = validate ? validate(next) : (next ? "" : "请输入内容。");
      if (error) throw new Error(error);
      settled = true;
      resolve(next);
    });
    input.focus();
  });
}
