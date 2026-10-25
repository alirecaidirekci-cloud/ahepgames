// App shell: login, home (games + leaderboard), room lists, routing to game screens.
import { initDb, db, isLocal } from "./db.js";
import { t, getLang, setLang } from "./i18n.js";
import { html, render, nothing, nameKey, validName, createRoom, joinRoom, leaveRoom, spectateRoom, isSpectator, watchRooms, roomPlayers, closeRoom, cleanupRooms } from "./lib.js";
import * as footballer from "./footballer/view.js";
import * as trivia from "./trivia/view.js";
import * as academic from "./academic/view.js";
import * as teamnation from "./teamnation/view.js";
import * as auction from "./auction/view.js";
import * as yokak from "./yokak/view.js";
import * as tournamentView from "./tournament/view.js";
import * as tournamentLogic from "./tournament/logic.js";
// Namespace import: a browser that still has an older cached admins.js keeps working.
import * as admins from "./admins.js";
const { isAdmin } = admins;
const HIDDEN_ONLINE = admins.HIDDEN_ONLINE || [];
const canPlay = (key) => admins.canPlay?.(key) ?? true;

const GAMES = { footballer, trivia, academic, teamnation, auction, yokak };

// Set by scripts/release.py. If version.json on the server is newer, this browser still runs
// cached old files: re-download them and reload once.
export const APP_VERSION = "20261026-000226";
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
// Home page rows: football games, quiz games and special games.
const GAME_GROUPS = [
  ["footballGames", ["footballer", "teamnation", "auction"]],
  ["quizGames", ["trivia", "academic"]],
  ["specialGames", ["yokak"]],
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
  users: {}, // everyone's name + last activity (for the online list and invites)
  invite: null, // an invitation to a room for me
  tournaments: null, // all tournaments (watched while logged in)
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

// ---------- online players & invites ----------
// Each logged-in browser writes users/<me>/lastActive (+ where it is) every 30 seconds.
// Someone counts as online if they were active in the last 75 seconds.
// Invites are stored in users/<invited>/invite = {from, fromName, game, code, t}.
const ONLINE_MS = 75 * 1000;
const INVITE_MS = 3 * 60 * 1000;
const isOnline = (u) => !!u?.lastActive && db.now() - u.lastActive < ONLINE_MS;

function heartbeat() {
  if (!state.me) return;
  db.update(`users/${state.me.key}`, { name: state.me.name, lastActive: db.now(), where: state.route.slice(0, 2).join("/") });
}
setInterval(heartbeat, 30 * 1000);
// No server: every logged-in browser helps move tournaments along (start, open matches, results).
setInterval(() => state.me && tournamentLogic.runDue(), 8 * 1000);
window.addEventListener("pagehide", () => state.me && db.update(`users/${state.me.key}`, { lastActive: 0 }));

let presenceOff = [];
function watchPresence() {
  presenceOff.forEach((off) => off());
  presenceOff = [];
  if (!state.me) return;
  presenceOff.push(db.on("users", (u) => ((state.users = u || {}), rerender())));
  presenceOff.push(db.on("tournaments", (v) => ((state.tournaments = v || {}), rerender())));
  presenceOff.push(
    db.on(`users/${state.me.key}/invite`, (inv) => {
      state.invite = inv && db.now() - inv.t < INVITE_MS ? inv : null;
      rerender();
    })
  );
}

export function onlineUsers() {
  return Object.entries(state.users)
    .filter(([key, u]) => isOnline(u) && !u.pending && (!HIDDEN_ONLINE.includes(key) || key === state.me?.key))
    .map(([key, u]) => ({ key, ...u }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Where someone is, in words: home page, a game's room list, or a room.
function whereText(where) {
  const [game, code] = (where || "").split("/");
  if (!game || !GAMES[game]) return t("whereHome");
  if (!code || GAMES[game].pages?.[code]) return t(game);
  return `${t(game)} · ${code}`;
}

async function sendInvite(key) {
  const [game, code] = state.route;
  await db.update(`users/${key}`, { invite: { from: state.me.key, fromName: state.me.name, game, code, t: db.now() } });
  setUi({ invited: { ...(state.ui.invited || {}), [key]: true } });
}

async function answerInvite(accept) {
  const inv = state.invite;
  state.invite = null;
  await db.set(`users/${state.me.key}/invite`, null);
  if (!accept || !inv) return rerender();
  const room = await db.get(`rooms/${inv.game}/${inv.code}`);
  if (!room) return ((state.error = t("roomNotFound")), rerender());
  const mod = GAMES[inv.game];
  const joined = room.status === "lobby" && (await joinRoom(inv.game, inv.code, state.me, mod.MAX_PLAYERS, mod.joinFields?.() || {})) === "ok";
  if (!joined) await spectateRoom(inv.game, inv.code, state.me);
  go(`#/${inv.game}/${inv.code}`);
}

function inviteBanner() {
  const inv = state.invite;
  if (!inv || !state.me || (state.route[0] === inv.game && state.route[1] === inv.code)) return nothing;
  return html`<div class="invite-banner">
    <span>📨 ${t("inviteFrom", { name: inv.fromName, game: t(inv.game), code: inv.code })}</span>
    <span class="row">
      <button class="primary small" @click=${() => answerInvite(true)}>${t("acceptInvite")}</button>
      <button class="small" @click=${() => answerInvite(false)}>${t("dismiss")}</button>
    </span>
  </div>`;
}

function onlineSection() {
  const list = onlineUsers();
  return html`<h2>🟢 ${t("onlineNow")} (${list.length})</h2>
    <div class="online-list">
      ${list.map(
        (u) => html`<div class="online-user ${u.key === state.me.key ? "mine" : ""}">
          <span class="dot"></span><b>${u.name}</b><small>${whereText(u.where)}</small>
        </div>`
      )}
    </div>`;
}

// Host's invite panel inside a room: online players who are not in the room yet.
function invitePanel(room, game) {
  const inRoom = (k) => room.players?.[k] || room.spectators?.[k];
  const list = onlineUsers().filter((u) => !inRoom(u.key));
  const link = `${location.origin}${location.pathname}#/${game}/${room.code}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setUi({ copied: true });
    } catch {
      setUi({ copied: false, showLink: true });
    }
  };
  return html`<details class="card invite-panel" ?open=${state.ui.inviteOpen} @toggle=${(e) => (state.ui.inviteOpen = e.target.open)}>
    <summary>➕ ${t("invitePlayers")} <small>(${list.length} ${t("onlineShort")})</small></summary>
    ${list.length
      ? html`<div class="online-list">
          ${list.map(
            (u) => html`<div class="online-user">
              <span class="dot"></span><b>${u.name}</b><small>${whereText(u.where)}</small>
              <button class="small primary" ?disabled=${state.ui.invited?.[u.key]} @click=${() => sendInvite(u.key)}>
                ${state.ui.invited?.[u.key] ? t("invited") : t("invite")}
              </button>
            </div>`
          )}
        </div>`
      : html`<p class="hint">${t("nobodyOnline")}</p>`}
    <div class="row">
      <button class="small" @click=${copy}>🔗 ${state.ui.copied ? t("linkCopied") : t("copyLink")}</button>
      ${state.ui.showLink ? html`<input class="link-box" readonly .value=${link} @focus=${(e) => e.target.select()} />` : nothing}
    </div>
  </details>`;
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
  heartbeat();
  if (!game) {
    updateIfNeeded();
    unsub.push(db.on("scores", (s) => ((state.leaderboard = s || {}), rerender())));
    unsub.push(tournamentView.watchMedals());
    cleanupRooms(Object.keys(GAMES));
  } else if (game === "tournaments") {
    unsub.push(...tournamentView.enter(state.route));
  } else if (game === "signups") {
    // state.users is already watched (presence)
  } else if (GAMES[game]?.pages?.[code]) {
    unsub.push(...(GAMES[game].pages[code].enter?.() || []));
  } else if (GAMES[game] && !code) {
    unsub.push(watchRooms(game, (list) => ((state.rooms = list), rerender())));
  } else if (GAMES[game] && code && !canPlay(state.me.key)) {
    // admin-only account: body() shows a note instead of the room (no joining or watching)
  } else if (GAMES[game] && code) {
    await GAMES[game].prepare?.();
    // Opening the room an invite points to uses up that invite.
    if (state.invite?.game === game && state.invite?.code === code) db.set(`users/${state.me.key}/invite`, null);
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
          const inRoster = room.roster && ["A", "B"].some((tm) => (room.roster[tm] || []).includes(state.me.key));
          if (inRoster && room.status === "lobby") joinRoom(game, code, state.me, GAMES[game].MAX_PLAYERS);
          else spectateRoom(game, code, state.me);
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

// ---------- passwords ----------
// Simple passwords: users/<key>/pw = {salt, hash} with hash = SHA-256(salt + password).
// New usernames and existing usernames without a password choose one (typed twice) on login.
const PW_MIN = 6;
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function hashPw(salt, pw) {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + pw)));
}
async function newPw(pw) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await hashPw(salt, pw) };
}

const loginError = (key) => ((state.error = t(key)), rerender());

async function login(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  const step = state.loginStep; // set when the password has to be typed a second time
  const name = step ? step.name : form.get("name").trim();
  const pw = form.get("pw") || "";
  if (!validName(name)) return loginError("nameBad");
  const key = nameKey(name);
  if (step) {
    if (form.get("pw2") !== step.pw) return loginError("pwMismatch");
    const pwData = await newPw(step.pw);
    // Only sets the password if nobody else set one in the meantime.
    // New usernames wait for an admin's approval; existing usernames (claiming) log in right away.
    const r = await db.tx(`users/${key}`, (cur) => {
      if (cur?.pw || (!cur && step.claim) || (cur && !step.claim)) return undefined;
      return { ...(cur || {}), name: cur?.name || name, createdAt: cur?.createdAt || db.now(), lastSeen: db.now(), pw: pwData, ...(cur ? {} : { pending: true }) };
    });
    if (!r.committed) return ((state.loginStep = null), loginError("pwTaken"));
    if (r.value.pending) return ((state.loginStep = null), loginError("signupPending"));
    return finishLogin(key, r.value.name);
  }
  if (pw.length < PW_MIN) return loginError("pwShort");
  const cur = await db.get(`users/${key}`);
  if (cur?.pw) {
    if ((await hashPw(cur.pw.salt, pw)) !== cur.pw.hash) return loginError("pwWrong");
    if (cur.pending) return loginError("signupPending");
    await db.update(`users/${key}`, { lastSeen: db.now() });
    return finishLogin(key, cur.name || name);
  }
  // New username, or an existing one that has no password yet: confirm the new password.
  state.loginStep = { name: cur?.name || name, pw, claim: !!cur };
  state.error = "";
  rerender();
}

function finishLogin(key, name) {
  state.loginStep = null;
  state.me = { key, name };
  store.setItem("fg-user", JSON.stringify(state.me));
  state.error = "";
  showWelcome();
  watchPresence();
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
  if (state.me) db.update(`users/${state.me.key}`, { lastActive: 0 });
  store.removeItem("fg-user");
  state.me = null;
  watchPresence(); // stops listening for the old user's invites
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
    ${inviteBanner()} ${confirmDialog()} ${welcomeScreen()}
  `;
}

function body() {
  if (!state.me) return loginView();
  const [game, code] = state.route;
  if (!game) return homeView();
  if (game === "tournaments") return tournamentView.view(state.route);
  if (game === "signups") return signupsView();
  if (!GAMES[game]) return html`<p>404 · <a href="#/">${t("back")}</a></p>`;
  if (!code) return roomListView(game);
  const page = GAMES[game].pages?.[code];
  if ((!page || page.play) && !canPlay(state.me.key)) return html`<a href="#/${game}" class="back">${t("back")}</a><p class="hint">🛡️ ${t("adminNoPlay")}</p>`;
  if (page) return page.view();
  if (!state.room) return html`<p>${state.error || "…"}</p><a href="#/${game}">${t("back")}</a>`;
  return GAMES[game].view();
}

function loginView() {
  const step = state.loginStep;
  if (step) {
    const back = () => ((state.loginStep = null), (state.error = ""), rerender());
    return html`
      <form class="card narrow" @submit=${login}>
        <h2>${t(step.claim ? "pwClaimTitle" : "pwNewTitle", { name: step.name })}</h2>
        <p class="hint">${t(step.claim ? "pwClaimHint" : "pwNewHint")}</p>
        <input name="pw2" type="password" autocomplete="new-password" placeholder=${t("pwAgain")} autofocus />
        ${state.error ? html`<p class="error">${state.error}</p>` : nothing}
        <div class="row">
          <button type="button" @click=${back}>${t("back")}</button>
          <button class="primary">${t("pwSave")}</button>
        </div>
      </form>
    `;
  }
  return html`
    <form class="card narrow" @submit=${login}>
      <h2>${t("chooseName")}</h2>
      <input name="name" autocomplete="username" maxlength="16" placeholder=${t("usernamePh")} autofocus />
      <input name="pw" type="password" autocomplete="current-password" placeholder=${t("passwordPh")} />
      <p class="hint">${t("nameHint")}</p>
      ${state.error ? html`<p class="error">${state.error}</p>` : nothing}
      <button class="primary">${t("enter")}</button>
    </form>
  `;
}

// ---------- sign-up approval (admins only, see admins.js) ----------
const pendingSignups = () =>
  Object.entries(state.users)
    .filter(([, u]) => u?.pending)
    .map(([key, u]) => ({ key, ...u }))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

function signupNotice() {
  const n = isAdmin(state.me) ? pendingSignups().length : 0;
  return n ? html`<div class="notices"><a class="notice" href="#/signups">🆕 ${t("signupNotice", { n })}</a></div>` : nothing;
}

function signupsView() {
  if (!isAdmin(state.me)) return html`<p>404 · <a href="#/">${t("back")}</a></p>`;
  const list = pendingSignups();
  const approve = (key) => db.update(`users/${key}`, { pending: null });
  const reject = (u) => setUi({ confirm: { text: t("signupRejectConfirm", { name: u.name }), yes: () => db.set(`users/${u.key}`, null) } });
  return html`
    <a href="#/" class="back">${t("back")}</a>
    <h2>🆕 ${t("signupsTitle")}</h2>
    ${list.length
      ? html`<div class="room-list">
          ${list.map(
            (u) => html`<div class="card room-item">
              <b>${u.name}</b><span class="hint">${u.createdAt ? new Date(u.createdAt).toLocaleString(getLang() === "tr" ? "tr-TR" : "en-US") : ""}</span>
              <button class="small primary" @click=${() => approve(u.key)}>✅ ${t("approve")}</button>
              <button class="small" @click=${() => reject(u)}>✖ ${t("reject")}</button>
            </div>`
          )}
        </div>`
      : html`<p class="hint">${t("noSignups")}</p>`}
  `;
}

function homeView() {
  const games = Object.keys(GAMES).filter((g) => !GAMES[g].noScores);
  const rows = Object.entries(state.leaderboard || {}).filter(([key]) => canPlay(key)).map(([key, s]) => {
    const name = games.map((g) => s[g]?.name).find(Boolean) || key;
    const pts = games.map((g) => s[g]?.points || 0);
    const wins = games.reduce((sum, g) => sum + (s[g]?.wins || 0), 0);
    return { key, name, pts, total: pts.reduce((a, b) => a + b, 0), wins };
  });
  rows.sort((a, b) => b.total - a.total);
  return html`
    ${signupNotice()} ${tournamentView.homeNotices()}
    ${GAME_GROUPS.map(
      ([title, keys]) => html`<h2>${t(title)}</h2>
        <div class="games games-${title === "quizGames" ? keys.length + 1 : keys.length}">
          ${keys.map(
            (g) => html`<a class="card game" href="#/${g}">
              <div class="game-icon">${GAMES[g].icon}</div>
              <h3>${t(g)}</h3>
              <p>${t(g + "Desc")}</p>
              <p class="info">${t(g + "Info", GAMES[g].info())}</p>
            </a>`
          )}
          ${title === "quizGames" ? tournamentView.homeCard() : nothing}
        </div>`
    )}
    ${onlineSection()}
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
    <h2>🏅 ${t("medalTable")}</h2>
    ${tournamentView.medalTable()}
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
    ${canPlay(state.me.key)
      ? html`<div class="row">
          <button class="primary" @click=${create}>＋ ${t("createRoom")}</button>
          <form class="row" @submit=${(e) => (e.preventDefault(), join(new FormData(e.target).get("code")))}>
            <input name="code" placeholder=${t("joinCode")} maxlength="5" class="code-input" />
            <button>${t("join")}</button>
            <button type="button" @click=${(e) => watch(e.target.form.code.value)}>👀 ${t("watch")}</button>
          </form>
        </div>`
      : html`<p class="hint">🛡️ ${t("adminNoPlay")}</p>`}
    ${state.error ? html`<p class="error">${state.error}</p>` : nothing}
    <h3>${t("openRooms")}</h3>
    ${state.rooms.length
      ? html`<div class="room-list">
          ${state.rooms.map((r) => {
            const ps = roomPlayers(r);
            const open = r.status === "lobby" && ps.length < mod.MAX_PLAYERS;
            return html`<div class="card room-item">
              <b>${r.tournament ? "🏆 " : ""}${r.code}</b><span>${ps.map((p) => p.name).join(", ")}</span>
              <span class="pill">${r.status === "lobby" ? t("statusWaiting") : t("statusPlaying")} · ${ps.length}/${mod.MAX_PLAYERS}</span>
              ${open && canPlay(state.me.key) ? html`<button class="small primary" @click=${() => join(r.code)}>${t("join")}</button>` : nothing}
              ${canPlay(state.me.key) ? html`<button class="small" @click=${() => watch(r.code)}>👀 ${t("watch")}</button>` : nothing}
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
        ${room.host === state.me.key && !room.tournament ? html`<button class="small" @click=${close}>🚪 ${t("closeRoom")}</button>` : nothing}
      </span>
    </div>
    ${isSpectator(room, state.me.key)
      ? html`<p class="watch-note">
          👀 ${t("youWatch")}
          ${room.status === "lobby" && (!room.roster || ["A", "B"].some((tm) => (room.roster[tm] || []).includes(state.me.key)))
            ? html`<button class="small primary" @click=${async () => {
                const res = await joinRoom(game, room.code, state.me, GAMES[game].MAX_PLAYERS, GAMES[game].joinFields?.() || {});
                if (res !== "ok") ((state.error = t(res === "full" ? "roomFull" : "roomNotFound")), rerender());
              }}>${t("joinGame")}</button>`
            : nothing}
        </p>`
      : nothing}
    ${watchers.length ? html`<p class="hint">👀 ${t("watchers", { names: watchers.join(", ") })}</p>` : nothing}
    ${state.error ? html`<p class="error">${state.error}</p>` : nothing}
    ${room.host === state.me.key && room.status !== "ended" && !room.tournament ? invitePanel(room, game) : nothing}`;
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
  watchPresence();
  window.addEventListener("hashchange", onRoute);
  onRoute();
})();
