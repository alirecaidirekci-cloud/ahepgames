// App shell: login, home (games + leaderboard), room lists, routing to game screens.
import { initDb, db, isLocal } from "./db.js";
import { t, getLang, setLang } from "./i18n.js";
import { html, render, nothing, nameKey, validName, createRoom, joinRoom, leaveRoom, spectateRoom, isSpectator, watchRooms, roomPlayers, closeRoom, cleanupRooms } from "./lib.js";
import * as footballer from "./footballer/view.js";
import * as trivia from "./trivia/view.js";
import * as academic from "./academic/view.js";
import * as teamnation from "./teamnation/view.js";
import * as auction from "./auction/view.js";

const GAMES = { footballer, trivia, academic, teamnation, auction };

// Set by scripts/release.py. If version.json on the server is newer, this browser still runs
// cached old files: re-download them and reload once.
export const APP_VERSION = "20261024-130653";
async function updateIfNeeded() {
  try {
    const info = await (await fetch("version.json", { cache: "no-store" })).json();
    if (!info?.v || info.v === APP_VERSION || sessionStorage.getItem("fg-updated-to") === info.v) return false;
    sessionStorage.setItem("fg-updated-to", info.v);
    await Promise.all(info.files.map((f) => fetch(f, { cache: "reload" }).catch(() => null)));
    location.reload();
    return true;
  } catch {
    return false;
  }
}
// Home page rows: football games and quiz games.
const GAME_GROUPS = [
  ["footballGames", ["footballer", "teamnation", "auction"]],
  ["quizGames", ["trivia", "academic"]],
];

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
  const r = await db.tx(`rooms/${game}/${code}`, (room) => {
    const next = mod.reduce(room, action, state.me.key, db.now());
    if (next) next.updatedAt = db.now(); // rooms without activity are cleaned up
    return next;
  });
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
    updateIfNeeded();
    unsub.push(db.on("scores", (s) => ((state.leaderboard = s || {}), rerender())));
    cleanupRooms(Object.keys(GAMES));
  } else if (GAMES[game]?.pages?.[code]) {
    unsub.push(...(GAMES[game].pages[code].enter?.() || []));
  } else if (GAMES[game] && !code) {
    unsub.push(watchRooms(game, (list) => ((state.rooms = list), rerender())));
  } else if (GAMES[game] && code) {
    await GAMES[game].prepare?.();
    let registered = false;
    let seen = false;
    unsub.push(
      db.on(`rooms/${game}/${code}`, (room) => {
        // The room was closed (by the host or automatically): go back to the room list.
        if (!room && seen) {
          state.room = null;
          state.error = t("roomClosed");
          rerender();
          setTimeout(() => state.route[1] === code && go(`#/${game}`), 2500);
          return;
        }
        seen = seen || !!room;
        if (room && !registered && isSpectator(room, state.me.key) && !room.spectators?.[state.me.key]) {
          registered = true;
          spectateRoom(game, code, state.me);
        }
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
  showWelcome();
  onRoute();
}

// Short welcome screen with the mascot right after logging in.
const WELCOME_MS = 2500;
function showWelcome() {
  state.welcome = "in";
  // Skipped if the player already clicked the screen away.
  setTimeout(() => state.welcome === "in" && ((state.welcome = "out"), rerender()), WELCOME_MS);
  setTimeout(() => state.welcome === "out" && ((state.welcome = null), rerender()), WELCOME_MS + 500);
}

function welcomeScreen() {
  if (!state.welcome) return nothing;
  return html`<div class="welcome-screen ${state.welcome === "out" ? "leaving" : ""}" @click=${() => ((state.welcome = null), rerender())}>
    <div class="welcome">
      <img class="mascot" src="img/mascot.png" alt="" />
      <div class="bubble">${t("mascotSays")}</div>
    </div>
  </div>`;
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
      <a class="brand" href="#/"><img class="logo" src="img/logo.png" alt="" />${t("appName")}</a>
      <div class="top-right">
        ${state.me ? html`<span class="me">👤 ${state.me.name}</span><button class="link" @click=${logout}>${t("logout")}</button>` : nothing}
        <button class="lang" @click=${() => (setLang(getLang() === "tr" ? "en" : "tr"), rerender())}>${getLang() === "tr" ? "EN" : "TR"}</button>
      </div>
    </header>
    ${isLocal ? html`<div class="banner">${t("localMode")}</div>` : nothing}
    <main>${body()}</main>
    ${confirmDialog()} ${welcomeScreen()}
  `;
}

function body() {
  if (!state.me) return loginView();
  const [game, code] = state.route;
  if (!game) return homeView();
  if (!GAMES[game]) return html`<p>404 · <a href="#/">${t("back")}</a></p>`;
  if (!code) return roomListView(game);
  if (GAMES[game].pages?.[code]) return GAMES[game].pages[code].view();
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
  const games = Object.keys(GAMES).filter((g) => !GAMES[g].noScores);
  const rows = Object.entries(state.leaderboard || {}).map(([key, s]) => {
    const name = games.map((g) => s[g]?.name).find(Boolean) || key;
    const pts = games.map((g) => s[g]?.points || 0);
    const wins = games.reduce((sum, g) => sum + (s[g]?.wins || 0), 0);
    return { key, name, pts, total: pts.reduce((a, b) => a + b, 0), wins };
  });
  rows.sort((a, b) => b.total - a.total);
  return html`
    ${GAME_GROUPS.map(
      ([title, keys]) => html`<h2>${t(title)}</h2>
        <div class="games games-${keys.length}">
          ${keys.map(
            (g) => html`<a class="card game" href="#/${g}">
              <div class="game-icon">${GAMES[g].icon}</div>
              <h3>${t(g)}</h3>
              <p>${t(g + "Desc")}</p>
              <p class="info">${t(g + "Info", GAMES[g].info())}</p>
            </a>`
          )}
        </div>`
    )}
    <h2>🏆 ${t("leaderboard")}</h2>
    ${rows.length
      ? html`<table class="board">
          <thead><tr><th>#</th><th>${t("player")}</th>${games.map((g) => html`<th class="game-col">${t(g)}</th>`)}<th>${t("wins")}</th><th>${t("total")}</th></tr></thead>
          <tbody>
            ${rows.map(
              (r, i) => html`<tr class=${r.key === state.me.key ? "mine" : ""}>
                <td>${i + 1}</td><td>${r.name}</td>${r.pts.map((p) => html`<td class="game-col">${p}</td>`)}<td>${r.wins}</td><td><b>${r.total}</b></td>
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
  const watch = async (code) => {
    code = code.trim().toUpperCase();
    if ((await spectateRoom(game, code, state.me)) === "ok") go(`#/${game}/${code}`);
    else ((state.error = t("roomNotFound")), rerender());
  };
  return html`
    <a href="#/" class="back">${t("back")}</a>
    <h2>${t(game)}</h2>
    <p class="hint">${t(game + "Desc")}</p>
    <p class="info">${t(game + "Info", mod.info())}</p>
    ${mod.lobbyExtra?.() || nothing}
    <div class="row">
      <button class="primary" @click=${create}>＋ ${t("createRoom")}</button>
      <form class="row" @submit=${(e) => (e.preventDefault(), join(new FormData(e.target).get("code")))}>
        <input name="code" placeholder=${t("joinCode")} maxlength="5" class="code-input" />
        <button>${t("join")}</button>
        <button type="button" @click=${(e) => watch(e.target.form.code.value)}>👀 ${t("watch")}</button>
      </form>
    </div>
    ${state.error ? html`<p class="error">${state.error}</p>` : nothing}
    <h3>${t("openRooms")}</h3>
    ${state.rooms.length
      ? html`<div class="room-list">
          ${state.rooms.map((r) => {
            const ps = roomPlayers(r);
            const open = r.status === "lobby" && ps.length < mod.MAX_PLAYERS;
            return html`<div class="card room-item">
              <b>${r.code}</b><span>${ps.map((p) => p.name).join(", ")}</span>
              <span class="pill">${r.status === "lobby" ? t("statusWaiting") : t("statusPlaying")} · ${ps.length}/${mod.MAX_PLAYERS}</span>
              ${open ? html`<button class="small primary" @click=${() => join(r.code)}>${t("join")}</button>` : nothing}
              <button class="small" @click=${() => watch(r.code)}>👀 ${t("watch")}</button>
            </div>`;
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
  const watchers = Object.values(room.spectators || {}).map((s) => s.name);
  const close = () =>
    setUi({ confirm: { text: t("closeRoomConfirm"), yes: async () => (await closeRoom(game, room.code), go(`#/${game}`)) } });
  return html`<div class="room-head">
      <a href="#/${game}" class="back" @click=${(e) => (e.preventDefault(), leave())}>${t("back")}</a>
      <span class="row">
        <span>${t(game)} · ${t("room")} <b class="code">${room.code}</b></span>
        ${room.host === state.me.key ? html`<button class="small" @click=${close}>🚪 ${t("closeRoom")}</button>` : nothing}
      </span>
    </div>
    ${isSpectator(room, state.me.key)
      ? html`<p class="watch-note">
          👀 ${t("youWatch")}
          ${room.status === "lobby"
            ? html`<button class="small primary" @click=${async () => {
                const res = await joinRoom(game, room.code, state.me, GAMES[game].MAX_PLAYERS, GAMES[game].joinFields?.() || {});
                if (res !== "ok") ((state.error = t(res === "full" ? "roomFull" : "roomNotFound")), rerender());
              }}>${t("joinGame")}</button>`
            : nothing}
        </p>`
      : nothing}
    ${watchers.length ? html`<p class="hint">👀 ${t("watchers", { names: watchers.join(", ") })}</p>` : nothing}
    ${state.error ? html`<p class="error">${state.error}</p>` : nothing}`;
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
  if (await updateIfNeeded()) return;
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
