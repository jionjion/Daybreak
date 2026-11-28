import test from "node:test";
import assert from "node:assert/strict";

import { BOOT_KEYS, readBoot, writeBoot } from "../shared/boot.js";
import { webAddress } from "../shared/dom.js";
import { isDataImage } from "../shared/image.js";
import {
  getAllKeys,
  getValue,
  getValues,
  hasChromeStorage,
  onStorageChange,
  removeKeys,
  setValues,
} from "../shared/storage.js";
import { applyTheme, DEFAULT_ACCENT, isAccent } from "../widgets/theme.js";
import { addressFor, customList, enginesFor, hasCategoriesFor, validTemplate } from "../widgets/search.js";
import { layoutValues } from "../widgets/home.js";
import { buildSheets } from "../widgets/bookmarks.js";
import { bookmarkLibrary } from "../widgets/library.js";
import { apiError, errorText, matchesCache, validCity } from "../widgets/weather.js";

test("shared/dom: webAddress only accepts http and https URLs", () => {
  assert.equal(webAddress("https://example.com/path")?.href, "https://example.com/path");
  assert.equal(webAddress("http://localhost:8080")?.href, "http://localhost:8080/");
  assert.equal(webAddress("javascript:alert(1)"), null);
  assert.equal(webAddress("chrome://settings"), null);
  assert.equal(webAddress("not a url"), null);
});

test("shared/image: isDataImage validates base64 image data URLs", () => {
  assert.equal(isDataImage("data:image/webp;base64,UklGRg=="), true);
  assert.equal(isDataImage("data:image/png;base64,iVBORw0KGgo="), true);
  assert.equal(isDataImage("data:image/jpeg;base64,/9j/4AAQ"), true);
  assert.equal(isDataImage("data:image/svg+xml;base64,PHN2Zz4="), false);
  assert.equal(isDataImage("https://example.com/a.webp"), false);
  assert.equal(isDataImage(null), false);
});

test("shared/storage: chrome.storage.local and area=local filtering", async () => {
  const prevChrome = globalThis.chrome;
  try {
    const store = new Map([["a", 1], ["b", "hello"]]);
    const listeners = new Set();
    globalThis.chrome = {
      storage: {
        local: {
          async get(keys) {
            if (keys === null) return Object.fromEntries(store);
            const list = Array.isArray(keys) ? keys : [keys];
            const out = {};
            for (const key of list) {
              if (store.has(key)) out[key] = store.get(key);
            }
            return out;
          },
          async set(entries) {
            for (const [k, v] of Object.entries(entries)) store.set(k, v);
          },
          async remove(keys) {
            for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
          },
          async getKeys() {
            return [...store.keys()];
          },
        },
        onChanged: {
          addListener: fn => listeners.add(fn),
          removeListener: fn => listeners.delete(fn),
        },
      },
    };

    assert.equal(hasChromeStorage(), true);
    assert.equal(await getValue("a"), 1);
    assert.deepEqual(await getValues(["a", "missing"]), { a: 1 });
    await setValues({ c: true });
    assert.deepEqual(await getAllKeys(), ["a", "b", "c"]);
    await removeKeys(["b"]);
    assert.equal(await getValue("b"), undefined);

    const seen = [];
    const unsub = onStorageChange(["target"], changes => seen.push(changes));
    for (const fn of listeners) {
      fn({ target: { newValue: 1 } }, "sync");
      fn({ other: { newValue: 2 } }, "local");
      fn({ target: { newValue: 3 } }, "local");
    }
    assert.deepEqual(seen, [{ target: { newValue: 3 } }]);
    unsub();
    for (const fn of listeners) fn({ target: { newValue: 4 } }, "local");
    assert.equal(seen.length, 1);
  } finally {
    globalThis.chrome = prevChrome;
  }
});

test("shared/storage: localStorage fallback and custom change events", async () => {
  const prevChrome = globalThis.chrome;
  const prevLS = globalThis.localStorage;
  const prevWin = globalThis.window;
  const prevCustomEvent = globalThis.CustomEvent;
  try {
    globalThis.chrome = undefined;
    const map = new Map();
    globalThis.localStorage = {
      getItem: k => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: k => map.delete(k),
    };
    const target = new EventTarget();
    globalThis.window = {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    };
    globalThis.CustomEvent = class extends Event {
      constructor(type, init = {}) {
        super(type);
        this.detail = init.detail;
      }
    };

    assert.equal(hasChromeStorage(), false);
    const events = [];
    const unsub = onStorageChange(["k1"], changes => events.push(changes));
    await setValues({ k1: { ok: true }, k2: 99 });
    assert.deepEqual(await getValue("k1"), { ok: true });
    await removeKeys(["k1"]);
    assert.equal(await getValue("k1"), undefined);
    assert.deepEqual(events, [
      { k1: { oldValue: undefined, newValue: { ok: true } }, k2: { oldValue: undefined, newValue: 99 } },
      { k1: { oldValue: { ok: true }, newValue: undefined } },
    ]);
    unsub();
  } finally {
    globalThis.chrome = prevChrome;
    globalThis.localStorage = prevLS;
    globalThis.window = prevWin;
    globalThis.CustomEvent = prevCustomEvent;
  }
});

test("widgets/theme: accent validation and CSS variable application", () => {
  assert.equal(isAccent("#3d5a72"), true);
  assert.equal(isAccent("#fff"), false);
  const props = new Map();
  const mockTarget = { style: { setProperty: (k, v) => props.set(k, v) } };
  assert.equal(applyTheme("#FFFFFF", mockTarget), "#ffffff");
  assert.equal(props.get("--accent"), "#ffffff");
  assert.equal(props.get("--accent-contrast"), "#1d1c16");
  assert.equal(applyTheme("invalid", mockTarget), DEFAULT_ACCENT);
  assert.equal(props.get("--accent-contrast"), "#ffffff");
});

test("widgets/search: templates, custom engine list, and direct addresses", () => {
  assert.equal(validTemplate("https://example.com/search?q=%s"), true);
  assert.equal(validTemplate("https://%s.example.com/"), false);
  assert.equal(validTemplate("javascript:%s"), false);
  assert.equal(validTemplate("https://example.com/search"), false);

  const customs = customList([
    { id: "bing", name: "Dup", template: "https://a.com/?q=%s" },
    { id: "c1", name: "MDN", template: "https://developer.mozilla.org/search?q=%s", types: { web: "https://x.com/%s", images: "https://developer.mozilla.org/img?q=%s" } },
    { id: "c1", name: "DupID", template: "https://b.com/?q=%s" },
    { id: "bad", name: "   ", template: "https://b.com/?q=%s" },
  ]);
  assert.equal(customs.length, 1);
  assert.deepEqual(customs[0].types, { images: "https://developer.mozilla.org/img?q=%s" });
  assert.ok(enginesFor({ customEngines: customs }).some(e => e.id === "c1"));

  assert.equal(addressFor("example.com/docs"), "https://example.com/docs");
  assert.equal(addressFor("localhost:3000"), "https://localhost:3000/");
  assert.equal(addressFor("hello world"), null);
  assert.equal(addressFor("https://user:pass@example.com"), null);
});

test("widgets/home: layoutValues clamps ranges and rejects invalid selections", () => {
  const result = layoutValues({
    "daybreak.layout.mode": "unknown",
    "daybreak.layout.iconSize": 999,
    "daybreak.layout.searchWidth": 500,
    "daybreak.layout.linksNewTab": false,
  });
  assert.equal(result.mode, "dashboard");
  assert.equal(result.iconSize, 54);
  assert.equal(result.searchWidth, 500);
  assert.equal(result.linksNewTab, false);
  assert.equal(result.bookmarksNewTab, false);
});

test("widgets/bookmarks & library: tree traversal and read-only inheritance", () => {
  const tree = [
    {
      id: "0",
      children: [
        {
          id: "1",
          folderType: "bookmarks-bar",
          title: "Bookmarks Bar",
          children: [
            { id: "10", parentId: "1", title: "Example", url: "https://example.com" },
            { id: "11", parentId: "1", title: "Bookmarklet", url: "javascript:void(0)" },
            {
              id: "12",
              parentId: "1",
              title: "Dev",
              children: [{ id: "13", parentId: "12", title: "Docs", url: "https://docs.example.com" }],
            },
          ],
        },
        {
          id: "3",
          folderType: "managed",
          title: "Managed",
          children: [{ id: "30", parentId: "3", title: "Corp", url: "https://corp.example.com" }],
        },
      ],
    },
  ];

  const sheets = buildSheets(tree);
  assert.deepEqual(sheets.map(s => [s.id, s.title, s.path]), [
    ["1", "书签栏", "书签栏"],
    ["12", "Dev", "书签栏 / Dev"],
  ]);

  const lib = bookmarkLibrary(tree);
  assert.equal(lib.rows.length, 3);
  assert.equal(lib.rows.find(r => r.id === "13")?.group, "Bookmarks Bar / Dev");
  assert.equal(lib.rows.find(r => r.id === "13")?.mutable, true);
  assert.equal(lib.rows.find(r => r.id === "30")?.mutable, false);
  assert.equal(lib.folders.find(f => f.id === "1")?.mutable, false);
  assert.equal(lib.folders.find(f => f.id === "12")?.mutable, true);
  assert.equal(lib.folders.find(f => f.id === "3")?.writable, false);
});

test("shared/boot: readBoot and writeBoot handle valid and malformed JSON", () => {
  const prevLS = globalThis.localStorage;
  try {
    const map = new Map([["bad.json", "{broken"]]);
    globalThis.localStorage = {
      getItem: k => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
    };
    assert.equal(readBoot("bad.json"), null);
    assert.equal(readBoot(BOOT_KEYS.ui), null);
    writeBoot(BOOT_KEYS.ui, { accent: "#3d5a72", clock24: false });
    assert.deepEqual(readBoot(BOOT_KEYS.ui), { accent: "#3d5a72", clock24: false });
  } finally {
    globalThis.localStorage = prevLS;
  }
});

test("widgets/search: hasCategoriesFor reflects engine capabilities and hideCategories", () => {
  assert.equal(hasCategoriesFor({ engine: "bing", hideCategories: false }), true);
  assert.equal(hasCategoriesFor({ engine: "bing", hideCategories: true }), false);
  const customNoTypes = { id: "c1", name: "MDN", template: "https://developer.mozilla.org/search?q=%s" };
  const customWithTypes = { ...customNoTypes, types: { images: "https://developer.mozilla.org/img?q=%s" } };
  assert.equal(hasCategoriesFor({ engine: "c1", customEngines: [customNoTypes], hideCategories: false }), false);
  assert.equal(hasCategoriesFor({ engine: "c1", customEngines: [customWithTypes], hideCategories: false }), true);
});

test("widgets/weather: apiError, errorText, validCity, and matchesCache", () => {
  assert.equal(apiError({ status: "1", infocode: "10000" }), null);
  assert.match(apiError({ status: "0", infocode: "10001" }).message, /认证失败/);
  assert.match(apiError({ status: "0", infocode: "10003" }).message, /用尽/);

  assert.match(errorText(new Error("CONFIG"), "fallback"), /API Key/);
  assert.match(errorText({ status: 403 }, "fallback"), /权限/);
  assert.equal(errorText(new Error("network"), "fallback"), "fallback");

  const city = { name: "杭州", adcode: "330100" };
  assert.equal(validCity(city), true);
  assert.equal(validCity({ name: "杭州" }), false);
  assert.equal(matchesCache({ city: "330100", fetched: 1, current: 20, high: 25, low: 15 }, city), true);
  assert.equal(matchesCache({ city: "110000", fetched: 1, current: 20, high: 25, low: 15 }, city), false);
});
