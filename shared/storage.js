function chromeLocal() {
  return globalThis.chrome?.storage?.local || null;
}

function safeParse(raw) {
  if (raw === null || raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function toMatcher(matcher) {
  if (typeof matcher === "function") return matcher;
  const set = matcher instanceof Set ? matcher : new Set(matcher || []);
  return key => set.has(key);
}

function dispatchLocalChanges(changes) {
  const win = globalThis.window;
  if (!win?.dispatchEvent || typeof globalThis.CustomEvent !== "function") return;
  if (!Object.keys(changes).length) return;
  win.dispatchEvent(new CustomEvent("daybreak:storage", { detail: { changes } }));
}

export function hasChromeStorage() {
  return Boolean(chromeLocal());
}

export async function getValue(key) {
  const storage = chromeLocal();
  if (storage) {
    const result = await storage.get(key);
    return result?.[key];
  }
  return safeParse(globalThis.localStorage?.getItem(key));
}

export async function getValues(keys) {
  const list = [...keys];
  if (!list.length) return {};
  const storage = chromeLocal();
  if (storage) return (await storage.get(list)) || {};
  const result = {};
  const ls = globalThis.localStorage;
  if (!ls) return result;
  for (const key of list) {
    const value = safeParse(ls.getItem(key));
    if (value !== undefined) result[key] = value;
  }
  return result;
}

export async function setValues(entries) {
  const pairs = Object.entries(entries || {});
  if (!pairs.length) return;
  const storage = chromeLocal();
  if (storage) {
    await storage.set(entries);
    return;
  }
  const ls = globalThis.localStorage;
  if (!ls) return;
  const changes = {};
  for (const [key, value] of pairs) {
    const oldValue = safeParse(ls.getItem(key));
    ls.setItem(key, JSON.stringify(value));
    changes[key] = { oldValue, newValue: value };
  }
  dispatchLocalChanges(changes);
}

export async function removeKeys(keys) {
  const list = [...keys];
  if (!list.length) return;
  const storage = chromeLocal();
  if (storage) {
    await storage.remove(list);
    return;
  }
  const ls = globalThis.localStorage;
  if (!ls) return;
  const changes = {};
  for (const key of list) {
    const oldValue = safeParse(ls.getItem(key));
    ls.removeItem(key);
    changes[key] = { oldValue, newValue: undefined };
  }
  dispatchLocalChanges(changes);
}

export async function getAllKeys() {
  const storage = chromeLocal();
  if (storage) {
    return storage.getKeys
      ? await storage.getKeys()
      : Object.keys((await storage.get(null)) || {});
  }
  const ls = globalThis.localStorage;
  return ls ? Object.keys(ls) : [];
}

export function onStorageChange(matcher, callback) {
  const matches = toMatcher(matcher);
  const onChanged = globalThis.chrome?.storage?.onChanged;
  if (onChanged?.addListener) {
    const listener = (changes, area) => {
      if (area !== "local" || !changes) return;
      if (Object.keys(changes).some(matches)) callback(changes);
    };
    onChanged.addListener(listener);
    return () => onChanged.removeListener?.(listener);
  }

  const win = globalThis.window;
  if (!win?.addEventListener) return () => {};

  const onStorage = event => {
    if (event.storageArea && globalThis.localStorage && event.storageArea !== globalThis.localStorage) return;
    if (event.key !== null && !matches(event.key)) return;
    const changes = event.key === null
      ? {}
      : { [event.key]: { oldValue: safeParse(event.oldValue), newValue: safeParse(event.newValue) } };
    callback(changes);
  };
  const onCustom = event => {
    const changes = event.detail?.changes;
    if (changes && Object.keys(changes).some(matches)) callback(changes);
  };
  win.addEventListener("storage", onStorage);
  win.addEventListener("daybreak:storage", onCustom);
  return () => {
    win.removeEventListener("storage", onStorage);
    win.removeEventListener("daybreak:storage", onCustom);
  };
}
