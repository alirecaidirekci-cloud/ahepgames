// Screens for Team & Nation Guess.
import { state, act, setUi, roomHeader } from "../app.js";
import { db } from "../db.js";
import { t } from "../i18n.js";
import { html, nothing, arr, fmtTime, roomPlayers, awardOnce } from "../lib.js";
import * as pool from "./pool.js";
import * as logic from "./logic.js";

export const MAX_PLAYERS = logic.MAX_PLAYERS;
export const icon = "🌍";
export const reduce = logic.reduce;
export const prepare = () => pool.loadPool();
export const needsTick = (room, now) => room.status === "playing" && room.deadline && now >= room.deadline;
export const newRoomFields = (me) => ({ roles: { [me.key]: "admin" } });
export const info = () => ({ win: logic.WIN_SCORE, sec: logic.GUESS_MS / 1000, pts: logic.WIN_POINTS });

export function onRoom(room, code) {
  if (room?.status === "ended" && !room.scored) {
    const awards = {};
    for (const k of logic.contestants(room)) {
      awards[k] = { name: room.players[k]?.name || k, pts: room.result.points[k] || 0, win: room.result.winner === k };
    }
    awardOnce("teamnation", code, awards);
  }
}

const nameOf = (key) => state.room.players?.[key]?.name || key;
const pickName = (p) => (p.kind === "club" ? pool.clubName(p.id) : pool.countryName(p.id));
const pickIcon = (p) => (p.kind === "club" ? "🏟️" : "🌍");

// Players in our large pool who fit both picks (most famous first).
const matches = (picks) => pool.matches(picks);

export function view() {
  const room = state.room;
  return html`${roomHeader("teamnation")} ${room.status === "lobby" ? lobby() : room.status === "playing" ? playing() : ended()}`;
}

// ---------- lobby ----------

function lobby() {
  const room = state.room;
  const me = state.me.key;
  const isHost = room.host === me;
  const ps = roomPlayers(room);
  const roles = room.roles || {};
  const ready = logic.contestants(room).filter((k) => room.players[k]).length === 2 && room.players[logic.adminOf(room)];
  const roleBtn = (key, role, label) =>
    html`<button class="small" ?disabled=${roles[key] === role} @click=${() => act({ type: "setRole", key, role })}>${label}</button>`;
  return html`<div class="card">
    <h3>${t("players")} (${ps.length})</h3>
    <ul class="players">
      ${ps.map(
        (p) => html`<li>
          ${p.name} ${p.key === me ? html`<small>(${t("you")})</small>` : nothing}
          ${roles[p.key] === "admin" ? html`<span class="pill gold">⚖️ ${t("gameAdmin")}</span>` : nothing}
          ${roles[p.key] === "player" ? html`<span class="pill">🎮 ${t("contestant")}</span>` : nothing}
          ${!roles[p.key] ? html`<span class="pill">👀 ${t("spectator")}</span>` : nothing}
          ${isHost
            ? html`${roleBtn(p.key, "admin", t("makeAdmin"))} ${roleBtn(p.key, "player", t("makeContestant"))}
              ${roles[p.key] ? html`<button class="small" @click=${() => act({ type: "setRole", key: p.key, role: null })}>✕</button>` : nothing}`
            : nothing}
        </li>`
      )}
    </ul>
    <p class="hint">${t("tnRules", { n: logic.WIN_SCORE, sec: logic.GUESS_MS / 1000 })}</p>
    ${isHost
      ? html`<button class="primary" ?disabled=${!ready} @click=${() => act({ type: "start" })}>${t("start")}</button>
          ${ready ? nothing : html`<p class="hint">${t("tnNeedRoles")}</p>`}`
      : html`<p class="hint">${t("waitingHost")}</p>`}
  </div>`;
}

// ---------- playing ----------

function scoreBar() {
  const room = state.room;
  const [a, b] = logic.contestants(room);
  return html`<div class="scorebar">
    <span class="team-A">${nameOf(a)} <b>${room.scores?.[a] || 0}</b></span>
    <span>—</span>
    <span class="team-B"><b>${room.scores?.[b] || 0}</b> ${nameOf(b)}</span>
  </div>
  <p class="hint center">${t("firstTo", { n: logic.WIN_SCORE })} · ⚖️ ${nameOf(logic.adminOf(room))}</p>`;
}

// Spectators (anyone who is neither a player nor the game admin) could whisper answers,
// so they see nothing about the picks until the round's result.
const isWatcher = (room, key) => !room.roles?.[key] || !room.players?.[key];

// While players are still picking, a pick is shown only to its picker and the game admin;
// the other player only sees whether it is a club or a nation. Both are revealed together.
function picksView(picks, phase) {
  const room = state.room;
  const me = state.me.key;
  const watcher = isWatcher(room, me);
  const canSee = (p) => (watcher ? phase === "result" : phase !== "pick" || p.by === me || logic.adminOf(room) === me);
  return html`<div class="picks">
    ${[0, 1].map((i) => {
      const p = picks[i];
      if (!p) return html`<div class="card pick-card"><small>…</small><b>?</b></div>`;
      const revealNow = watcher ? phase === "result" : phase === "guess";
      return html`<div class="card pick-card ${revealNow ? "revealed" : ""}">
        <small>${nameOf(p.by)}</small>
        ${canSee(p)
          ? html`<b>${pickIcon(p)} ${pickName(p)}</b>`
          : watcher
          ? html`<b>?</b><small>${t("pickedHidden")}</small>`
          : html`<b>${pickIcon(p)} ?</b><small>${t(p.kind === "club" ? "pickedClub" : "pickedNation")}</small>`}
      </div>`;
    })}
  </div>`;
}

function playing() {
  const room = state.room;
  const me = state.me.key;
  const round = room.round;
  const picks = arr(round.picks);
  const isAdmin = logic.adminOf(room) === me;
  let body;
  if (round.phase === "pick") body = pickPhase();
  else if (round.phase === "guess") body = guessPhase(isAdmin);
  else body = resultView(round);
  return html`${scoreBar()}
    <div class="card">
      <h3>${t("roundN", { n: round.n })}</h3>
      ${picksView(picks, round.phase)} ${body}
    </div>
    ${roundLog()}`;
}

function pickPhase() {
  const room = state.room;
  const me = state.me.key;
  const picker = logic.nextPicker(room);
  if (picker !== me) return html`<p class="big center">⏳ ${t("waitingPick", { name: nameOf(picker) })}</p>`;
  const picks = arr(room.round.picks);
  const mustClub = picks.length === 1 && picks[0].kind === "nation";
  const kind = mustClub ? "club" : state.ui.kind || "club";
  const q = (state.ui.q || "").toLocaleLowerCase();
  // Leave this round's hidden pick in the list so its absence doesn't give it away.
  const used = { ...(room.used || {}) };
  for (const p of picks) delete used[p.id];
  const ids = kind === "club" ? pool.clubIds() : pool.countryIds();
  const options = ids
    .filter((id) => !used[id])
    .map((id) => ({ id, name: kind === "club" ? pool.clubName(id) : pool.countryName(id) }))
    .filter((o) => !q || o.name.toLocaleLowerCase().includes(q))
    .sort((a, b) => pool.popularity(b.id) - pool.popularity(a.id))
    .slice(0, 40);
  const choose = (o) =>
    setUi({
      confirm: {
        text: t("pickConfirm", { name: o.name }),
        yes: async () => setUi({ pickError: !(await act({ type: "pick", kind, id: o.id })) }),
      },
    });
  return html`<p class="big">🎯 ${t("yourPick")}</p>
    ${mustClub ? html`<p class="hint">${t("mustClub")}</p>` : nothing}
    ${state.ui.pickError ? html`<p class="error">${t("alreadyPicked")}</p>` : nothing}
    <div class="row">
      ${mustClub
        ? nothing
        : html`<div class="tabs">
            <button class=${kind === "club" ? "tab active" : "tab"} @click=${() => setUi({ kind: "club" })}>🏟️ ${t("club")}</button>
            <button class=${kind === "nation" ? "tab active" : "tab"} @click=${() => setUi({ kind: "nation" })}>🌍 ${t("nation")}</button>
          </div>`}
      <input placeholder=${t("search")} .value=${state.ui.q || ""} @input=${(e) => setUi({ q: e.target.value })} />
    </div>
    <div class="chips option-list">${options.map((o) => html`<button class="chip" @click=${() => choose(o)}>${o.name}</button>`)}</div>`;
}

function guessPhase(isAdmin) {
  const room = state.room;
  const picks = arr(room.round.picks);
  const left = room.deadline - db.now();
  const [a, b] = logic.contestants(room);
  const prompt = html`<p class="question center">${t("sayPlayer", { a: describe(picks[0]), b: describe(picks[1]) })}</p>
    <p class="center"><span class="timer ${left < 15000 ? "urgent" : ""}">⏱ ${fmtTime(left)}</span></p>`;
  if (isWatcher(room, state.me.key))
    return html`<p class="big center">🗣️ ${t("watcherGuessing")}</p>
      <p class="center"><span class="timer ${left < 15000 ? "urgent" : ""}">⏱ ${fmtTime(left)}</span></p>`;
  if (!isAdmin) return html`${prompt}<p class="hint center">${t("sayAloud")}</p>`;
  const found = matches(picks);
  const chosen = state.ui.answer;
  const award = (key) => act({ type: "award", key, answer: chosen || null });
  return html`${prompt}
    <div class="admin-box">
      <h4>⚖️ ${t("adminPanel")}</h4>
      <p class="hint">${found.length ? t("dbMatches", { n: found.length }) : t("noDbMatch")}</p>
      ${found.length > 12
        ? html`<input placeholder=${t("checkName")} .value=${state.ui.adminQ || ""} @input=${(e) => setUi({ adminQ: e.target.value })} />`
        : nothing}
      <div class="chips admin-matches">
        ${found
          .filter((p) => !state.ui.adminQ || p.name.toLocaleLowerCase("tr").includes(state.ui.adminQ.toLocaleLowerCase("tr")))
          .slice(0, 80)
          .map(
          (p) => html`<button class=${chosen === p.name ? "chip on" : "chip"} @click=${() => setUi({ answer: chosen === p.name ? null : p.name })}>${p.name}</button>`
        )}
      </div>
      <div class="row">
        <button class="primary" @click=${() => award(a)}>✓ ${t("saidFirst", { name: nameOf(a) })}</button>
        <button class="primary" @click=${() => award(b)}>✓ ${t("saidFirst", { name: nameOf(b) })}</button>
        <button @click=${() => setUi({ confirm: { text: t("noValidConfirm"), yes: () => act({ type: "noValid" }) } })}>🚫 ${t("noValid")}</button>
      </div>
      <p class="hint">${t("adminHint")}</p>
    </div>`;
}

const describe = (p) => (p.kind === "club" ? t("playedFor", { name: pickName(p) }) : t("isFrom", { name: pickName(p) }));

function resultView(round) {
  const text =
    round.reason === "correct"
      ? t("roundWon", { name: nameOf(round.winner) }) + (round.answer ? ` (${round.answer})` : "")
      : round.reason === "timeout"
      ? t("roundTimeout")
      : t("roundNoValid");
  return html`<p class="big center">${text}</p>`;
}

function roundLog() {
  const log = arr(state.room.log);
  if (!log.length) return nothing;
  return html`<div class="card">
    <h3>📜 ${t("rounds")}</h3>
    <ol class="log">
      ${log.map(
        (r) => html`<li>
          ${arr(r.picks).map((p) => `${pickIcon(p)} ${pickName(p)}`).join(" + ")} →
          ${r.reason === "correct"
            ? html`<b class="yes">${nameOf(r.winner)}</b>${r.answer ? ` (${r.answer})` : ""}`
            : html`<span class="no">${r.reason === "timeout" ? t("timeUp") : t("noValidShort")}</span>`}
        </li>`
      )}
    </ol>
  </div>`;
}

// ---------- ended ----------

function ended() {
  const room = state.room;
  const w = room.result.winner;
  return html`${scoreBar()}
    <div class="card center">
      <h2>${t("gameOver")}</h2>
      <p class="big">🏆 ${t("tnWinner", { name: nameOf(w) })}</p>
      <table class="board">
        ${logic.contestants(room).map(
          (k) => html`<tr class=${k === state.me.key ? "mine" : ""}><td>${nameOf(k)}</td><td><b>${t("pointsWon", { n: room.result.points[k] || 0 })}</b></td></tr>`
        )}
      </table>
      <a class="button primary" href="#/teamnation">${t("playAgain")}</a>
    </div>
    ${roundLog()}`;
}
