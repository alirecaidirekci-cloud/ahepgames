// Tiny data layer with two backends:
//  - Firebase Realtime Database (real multiplayer between friends)
//  - localStorage (demo mode: multiplayer between tabs of the same browser)
// Paths look like "rooms/footballer/AB12C". Setting a value to null deletes it.
import { firebaseConfig } from "./firebase-config.js";

const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
// Add ?demo to the URL to force local mode (handy for trying things without touching real data).
export const isLocal = !firebaseConfig.apiKey || firebaseConfig.apiKey === "PASTE_ME" || new URLSearchParams(location.search).has("demo");

let impl;

export async function initDb() {
  impl = isLocal ? localBackend() : await firebaseBackend();
}

export const db = {
  now: () => impl.now(),
  get: (p) => impl.get(p),
  set: (p, v) => impl.set(p, v),
  update: (p, obj) => impl.update(p, obj),
  // fn(current) returns the new value, or undefined to abort. Resolves to {committed, value}.
  tx: (p, fn) => impl.tx(p, fn),
  // cb(value) is called now and on every change. Returns an unsubscribe function.
  on: (p, cb) => impl.on(p, cb),
};

async function firebaseBackend() {
  const { initializeApp } = await import(FB + "firebase-app.js");
  const { getAuth, signInAnonymously } = await import(FB + "firebase-auth.js");
  const rtdb = await import(FB + "firebase-database.js");
  const app = initializeApp(firebaseConfig);
  await signInAnonymously(getAuth(app));
  const d = rtdb.getDatabase(app);
  let offset = 0;
  rtdb.onValue(rtdb.ref(d, ".info/serverTimeOffset"), (s) => (offset = s.val() || 0));
  return {
    now: () => Date.now() + offset,
    get: async (p) => (await rtdb.get(rtdb.ref(d, p))).val(),
    set: (p, v) => rtdb.set(rtdb.ref(d, p), v),
    update: (p, obj) => rtdb.update(rtdb.ref(d, p), obj),
    tx: async (p, fn) => {
      // Keep a listener while the transaction runs so it starts from the real server value
      // (otherwise the first attempt may see null and abort).
      const ref = rtdb.ref(d, p);
      let off;
      await new Promise((res) => (off = rtdb.onValue(ref, res)));
      try {
        const r = await rtdb.runTransaction(ref, (cur) => fn(clone(cur)), { applyLocally: false });
        return { committed: r.committed, value: r.snapshot.val() };
      } finally {
        off();
      }
    },
    on: (p, cb) => rtdb.onValue(rtdb.ref(d, p), (s) => cb(s.val())),
  };
}

function localBackend() {
  const KEY = "fg-local-db";
  const listeners = new Set();
  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      return {};
    }
  };
  const save = (root) => {
    localStorage.setItem(KEY, JSON.stringify(prune(root) ?? {}));
    notify();
  };
  const notify = () => {
    const root = load();
    for (const l of listeners) {
      const v = getIn(root, l.path);
      const s = JSON.stringify(v);
      if (s !== l.last) {
        l.last = s;
        l.cb(clone(v));
      }
    }
  };
  window.addEventListener("storage", (e) => e.key === KEY && notify());
  const write = (p, v) => {
    const root = load();
    save(setIn(root, p, v));
  };
  return {
    now: () => Date.now(),
    get: async (p) => clone(getIn(load(), p)),
    set: async (p, v) => write(p, v),
    update: async (p, obj) => {
      let root = load();
      for (const [k, v] of Object.entries(obj)) root = setIn(root, join(p, k), v);
      save(root);
    },
    tx: async (p, fn) => {
      const root = load();
      const next = fn(clone(getIn(root, p)));
      if (next === undefined) return { committed: false, value: getIn(root, p) };
      save(setIn(root, p, next));
      return { committed: true, value: clone(next) };
    },
    on: (p, cb) => {
      const l = { path: p, cb, last: undefined };
      listeners.add(l);
      const v = getIn(load(), p);
      l.last = JSON.stringify(v);
      setTimeout(() => cb(clone(v)));
      return () => listeners.delete(l);
    },
  };
}

// Firebase does not store null values or empty objects/arrays; demo mode drops them the same way
// so the games behave identically in both modes.
function prune(v) {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) {
    const a = v.map(prune).filter((x) => x !== undefined);
    return a.length ? a : undefined;
  }
  if (typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      const p = prune(x);
      if (p !== undefined) o[k] = p;
    }
    return Object.keys(o).length ? o : undefined;
  }
  return v;
}

const parts = (p) => p.split("/").filter(Boolean);
const join = (a, b) => (a ? a + "/" + b : b);
const clone = (v) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));

function getIn(root, p) {
  let cur = root;
  for (const k of parts(p)) {
    if (cur == null || typeof cur !== "object") return null;
    cur = cur[k];
  }
  return cur === undefined ? null : cur;
}

function setIn(root, p, v) {
  const ks = parts(p);
  if (!ks.length) return v ?? {};
  root = root && typeof root === "object" ? root : {};
  let cur = root;
  for (let i = 0; i < ks.length - 1; i++) {
    if (cur[ks[i]] == null || typeof cur[ks[i]] !== "object") cur[ks[i]] = {};
    cur = cur[ks[i]];
  }
  const last = ks[ks.length - 1];
  if (v === null || v === undefined) delete cur[last];
  else cur[last] = v;
  return root;
}

// Firebase turns arrays into objects and drops empty ones; this reads either back as an array.
export const arr = (x) => (Array.isArray(x) ? x.filter((v) => v != null) : x ? Object.values(x) : []);
