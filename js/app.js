// App shell: login, home (games + leaderboard), room lists, routing to game screens.
import { initDb, db, isLocal } from "./db.js";
import { t, getLang, setLang } from "./i18n.js";
import { html, render, nothing, nameKey, validName, createRoom, joinRoom, leaveRoom, watchRooms, roomPlayers } from "./lib.js";
import * as footballer from "./footballer/view.js";
import * as trivia from "./trivia/view.js";

const GAMES = { footballer, trivia };

// Local demo mode keeps the user per tab so several tabs can be different players.
const store = isLocal ? sessionStorage : localStorage;

export const state = {
  me: null, // {key, name}
  route: [],
  rooms: [],
  room: null,
  leaderboard: null,
  ui: {}, // per-screen UI state (filters, dialogs, ...)
  error: "",
};

let unsub = [];
const root = document.getElementById("app");

export function rerender() {
  render(shell(), root);
}

export function setUi(patch) {
  Object.assign(state.ui, patch);
  rerender();
}

// Runs a game action as a transaction on the current room.
export async function act(action) {
  const [game, code] = state.route;
  const mod = GAMES[game];
  const r = await db.tx(`rooms/${game}/${code}`, (room) => mod.reduce(room, action, state.me.key, db.now()));
  return r.committed;
}

function go(hash) {
  location.hash = hash;
}

async function onRoute() {
  unsub.forEach((u) => u());
  unsub = [];
  state.route = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  state.room = null;
  state.rooms = [];
  state.ui = {};
  state.error = "";
  const [game, code] = state.route;
  if (!state.me) return rerender();
  if (!game) {
    unsub.push(db.on("scores", (s) => ((state.leaderboard = s || {}), rerender())));
  } else if (GAMES[game] && !code) {
    unsub.push(watchRooms(game, (list) => ((state.rooms = list), rerender())));
  } else if (GAMES[game] && code) {
    await GAMES[game].prepare?.();
    unsub.push(
      db.on(`rooms/${game}/${code}`, (room) => {
        state.room = room;
        if (!room) state.error = t("roomNotFound");
        GAMES[game].onRoom?.(room, code);
        rerender();
      })
    );
  }
  rerender();
}

async function login(e) {
  e.preventDefault();
  const name = new FormData(e.target).get("name").trim();
  if (!validName(name)) return ((state.error = t("nameBad")), rerender());
  const key = nameKey(name);
  const r = await db.tx(`users/${key}`, (cur) => ({ name: cur?.name || name, createdAt: cur?.createdAt || db.now(), lastSeen: db.now() }));
  state.me = { key, name: r.value.name };
  store.setItem("fg-user", JSON.stringify(state.me));
  state.error = "";
  onRoute();
}

function logout() {
  store.removeItem("fg-user");
  state.me = null;
  go("#/");
  onRoute();
}

// ---------- views ----------

function shell() {
  return html`
    <header class="top">
      <a class="brand" href="#/">⚽ ${t("appName")}</a>
      <div class="top-right">
        ${state.me ? html`<span class="me">👤 ${state.me.name}</span><button class="link" @click=${logout}>${t("logout")}</button>` : nothing}
        <button class="lang" @click=${() => (setLang(getLang() === "tr" ? "en" : "tr"), rerender())}>${getLang() === "tr" ? "EN" : "TR"}</button>
      </div>
    </header>
    ${isLocal ? html`<div class="banner">${t("localMode")}</div>` : nothing}
    <main>${body()}</main>
    ${confirmDialog()}
  `;
}

function body() {
  if (!state.me) return loginView();
  const [game, code] = state.route;
  if (!game) return homeView();
  if (!GAMES[game]) return html`<p>404 · <a href="#/">${t("back")}</a></p>`;
  if (!code) return roomListView(game);
  if (!state.room) return html`<p>${state.error || "…"}</p><a href="#/${game}">${t("back")}</a>`;
  return GAMES[game].view();
}

function loginView() {
  return html`
    <form class="card narrow" @submit=${login}>
      <h2>${t("chooseName")}</h2>
      <input name="name" autocomplete="off" maxlength="16" placeholder="username" autofocus />
      <p class="hint">${t("nameHint")}</p>
      ${state.error ? html`<p class="error">${state.error}</p>` : nothing}
      <button class="primary">${t("enter")}</button>
    </form>
  `;
}

function homeView() {
  const rows = Object.entries(state.leaderboard || {}).map(([key, s]) => {
    const name = s.footballer?.name || s.trivia?.name || key;
    const f = s.footballer?.points || 0;
    const tr = s.trivia?.points || 0;
    return { key, name, f, tr, total: f + tr, wins: (s.footballer?.wins || 0) + (s.trivia?.wins || 0) };
  });
  rows.sort((a, b) => b.total - a.total);
  return html`
    <h2>${t("games")}</h2>
    <div class="games">
      ${Object.keys(GAMES).map(
        (g) => html`<a class="card game" href="#/${g}">
          <div class="game-icon">${g === "footballer" ? "🕵️" : "🧠"}</div>
          <h3>${t(g)}</h3>
          <p>${t(g + "Desc")}</p>
          <p class="info">${t(g + "Info", GAMES[g].info())}</p>
        </a>`
      )}
    </div>
    <h2>🏆 ${t("leaderboard")}</h2>
    ${rows.length
      ? html`<table class="board">
          <thead><tr><th>#</th><th>${t("player")}</th><th>${t("footballer")}</th><th>${t("trivia")}</th><th>${t("wins")}</th><th>${t("total")}</th></tr></thead>
          <tbody>
            ${rows.map(
              (r, i) => html`<tr class=${r.key === state.me.key ? "mine" : ""}>
                <td>${i + 1}</td><td>${r.name}</td><td>${r.f}</td><td>${r.tr}</td><td>${r.wins}</td><td><b>${r.total}</b></td>
              </tr>`
            )}
          </tbody>
        </table>`
      : html`<p class="hint">${t("noScores")}</p>`}
  `;
}

function roomListView(game) {
  const mod = GAMES[game];
  const create = async () => go(`#/${game}/${await createRoom(game, state.me, mod.newRoomFields?.(state.me) || {})}`);
  const join = async (code) => {
    code = code.trim().toUpperCase();
    const res = await joinRoom(game, code, state.me, mod.MAX_PLAYERS, mod.joinFields?.() || {});
    if (res === "ok") go(`#/${game}/${code}`);
    else ((state.error = t(res === "full" ? "roomFull" : "roomNotFound")), rerender());
  };
  return html`
    <a href="#/" class="back">${t("back")}</a>
    <h2>${t(game)}</h2>
    <p class="hint">${t(game + "Desc")}</p>
    <p class="info">${t(game + "Info", mod.info())}</p>
    <div class="row">
      <button class="primary" @click=${create}>＋ ${t("createRoom")}</button>
      <form class="row" @submit=${(e) => (e.preventDefault(), join(new FormData(e.target).get("code")))}>
        <input name="code" placeholder=${t("joinCode")} maxlength="5" class="code-input" />
        <button>${t("join")}</button>
      </form>
    </div>
    ${state.error ? html`<p class="error">${state.error}</p>` : nothing}
    <h3>${t("openRooms")}</h3>
    ${state.rooms.length
      ? html`<div class="room-list">
          ${state.rooms.map((r) => {
            const ps = roomPlayers(r);
            return html`<button class="card room-item" @click=${() => join(r.code)}>
              <b>${r.code}</b><span>${ps.map((p) => p.name).join(", ")}</span><span class="pill">${ps.length}/${mod.MAX_PLAYERS}</span>
            </button>`;
          })}
        </div>`
      : html`<p class="hint">${t("noRooms")}</p>`}
  `;
}

// Shared room header used by the game screens.
export function roomHeader(game) {
  const room = state.room;
  const leave = async () => {
    await leaveRoom(game, room.code, state.me);
    go(`#/${game}`);
  };
  return html`<div class="room-head">
    <a href="#/${game}" class="back" @click=${(e) => (e.preventDefault(), leave())}>${t("back")}</a>
    <span>${t(game)} · ${t("room")} <b class="code">${room.code}</b></span>
  </div>`;
}

// Confirmation dialog: setUi({confirm: {text, yes: fn}})
function confirmDialog() {
  const c = state.ui.confirm;
  if (!c) return nothing;
  const close = () => setUi({ confirm: null });
  return html`<div class="overlay" @click=${close}>
    <div class="card dialog" @click=${(e) => e.stopPropagation()}>
      ${c.content || nothing}
      <p>${c.text}</p>
      <div class="row end">
        <button @click=${close}>${t("cancel")}</button>
        <button class="primary" @click=${() => (close(), c.yes())}>${t("confirm")}</button>
      </div>
    </div>
  </div>`;
}

// Timers and time-based rules (round timeouts) are checked every second by every client.
setInterval(() => {
  const [game] = state.route;
  if (state.room && GAMES[game]?.needsTick?.(state.room, db.now())) act({ type: "tick" });
  if (state.room) rerender();
}, 1000);

(async function boot() {
  try {
    await initDb();
  } catch (e) {
    root.innerHTML = `<pre class="error">Could not connect to the database:\n${e.message}</pre>`;
    return;
  }
  try {
    state.me = JSON.parse(store.getItem("fg-user"));
  } catch {}
  root.textContent = "";
  window.addEventListener("hashchange", onRoute);
  onRoute();
})();
