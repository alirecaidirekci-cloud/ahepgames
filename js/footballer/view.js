// Screens for "Guess the Footballer".
import { state, act, setUi, roomHeader } from "../app.js";
import { db } from "../db.js";
import { t } from "../i18n.js";
import { html, nothing, arr, fmtTime, roomPlayers, awardOnce } from "../lib.js";
import * as data from "./data.js";
import * as logic from "./logic.js";

export const MAX_PLAYERS = logic.MAX_PLAYERS;
export const prepare = () => data.loadData();
export const reduce = (room, a, me, now) => logic.reduce(room, a, me, now, data);
export const needsTick = (room, now) => room.status === "playing" && now >= room.deadline;
export const newRoomFields = (me) => ({ picker: me.key });

export function onRoom(room, code) {
  if (room?.status === "ended" && !room.scored) {
    const awards = {};
    for (const p of roomPlayers(room)) {
      awards[p.key] = { name: p.name, pts: room.result.points[p.key] || 0, win: room.result.winner === p.key };
    }
    awardOnce("footballer", code, awards);
  }
}

const nameOf = (key) => state.room.players?.[key]?.name || key;
const ask = (text, yes, content) => setUi({ confirm: { text, yes, content } });

export function view() {
  const room = state.room;
  return html`${roomHeader("footballer")}
    ${{ lobby: lobby, picking: picking, playing: playing, ended: ended }[room.status]()}`;
}

function lobby() {
  const room = state.room;
  const me = state.me.key;
  const isHost = room.host === me;
  const ps = roomPlayers(room);
  return html`<div class="card">
    <h3>${t("players")} (${ps.length}/${MAX_PLAYERS})</h3>
    <ul class="players">
      ${ps.map(
        (p) => html`<li>
          ${p.name} ${p.key === me ? html`<small>(${t("you")})</small>` : nothing}
          ${p.key === room.host ? html`<span class="pill">${t("host")}</span>` : nothing}
          ${p.key === room.picker
            ? html`<span class="pill gold">🎯 ${t("picker")}</span>`
            : isHost
            ? html`<button class="small" @click=${() => act({ type: "setPicker", key: p.key })}>${t("makePicker")}</button>`
            : nothing}
        </li>`
      )}
    </ul>
    ${isHost
      ? html`<button class="primary" ?disabled=${ps.length < 2} @click=${() => act({ type: "start" })}>${t("start")}</button>
          ${ps.length < 2 ? html`<p class="hint">${t("needPlayers", { n: 2 })}</p>` : nothing}`
      : html`<p class="hint">${t("waitingHost")}</p>`}
  </div>`;
}

// ---------- picking ----------

function picking() {
  const room = state.room;
  if (room.picker !== state.me.key) return html`<div class="card center"><p class="big">⏳ ${t("pickerChooses", { name: nameOf(room.picker) })}</p></div>`;
  const ui = state.ui;
  const q = (ui.search || "").toLocaleLowerCase();
  let list = data.players().filter(
    (p) =>
      (!q || p.name.toLocaleLowerCase().includes(q)) &&
      (!ui.nat || p.nat === ui.nat) &&
      (!ui.league || p.leagues.includes(ui.league)) &&
      (!ui.pos || p.pos.includes(ui.pos))
  );
  const total = list.length;
  list = list.slice(0, 120);
  const pick = (p) => ask(t("pickThis", { name: p.name }), () => act({ type: "pick", pid: p.id }), playerCard(p, true));
  const countries = [...new Set(data.players().map((p) => p.nat))].sort((a, b) => data.countryName(a).localeCompare(data.countryName(b)));
  const leagues = [...new Set(data.players().flatMap((p) => p.leagues))].sort((a, b) => data.leagueName(a).localeCompare(data.leagueName(b)));
  const rnd = data.players()[Math.floor(Math.random() * data.players().length)];
  return html`<div class="card">
    <h3>${t("pickTitle")}</h3>
    <div class="filters">
      <input placeholder=${t("search")} .value=${ui.search || ""} @input=${(e) => setUi({ search: e.target.value })} />
      <select @change=${(e) => setUi({ nat: e.target.value })}>
        <option value="">${t("allNat")}</option>
        ${countries.map((c) => html`<option value=${c} ?selected=${ui.nat === c}>${data.countryName(c)}</option>`)}
      </select>
      <select @change=${(e) => setUi({ league: e.target.value })}>
        <option value="">${t("allLeague")}</option>
        ${leagues.map((l) => html`<option value=${l} ?selected=${ui.league === l}>${data.leagueName(l)}</option>`)}
      </select>
      <select @change=${(e) => setUi({ pos: e.target.value })}>
        <option value="">${t("allPos")}</option>
        ${data.POSITIONS.map((p) => html`<option value=${p} ?selected=${ui.pos === p}>${data.posLabel(p)}</option>`)}
      </select>
      <button @click=${() => pick(rnd)}>${t("random")}</button>
    </div>
    <p class="hint">${total} / ${data.players().length}</p>
    <div class="grid">${list.map((p) => photo(p, { onClick: () => pick(p) }))}</div>
  </div>`;
}

// ---------- playing ----------

function playing() {
  const room = state.room;
  const me = state.me.key;
  const log = arr(room.log);
  const u = logic.usage(room, me);
  const left = room.deadline - db.now();
  const cands = data.candidates(log);
  const wrong = new Set(log.filter((e) => e.kind === "g" && !e.ok).map((e) => e.pid));
  const isPicker = room.picker === me;
  return html`
    <div class="status-bar">
      <span class="timer ${left < 60000 ? "urgent" : ""}">⏱ ${fmtTime(left)}</span>
      <span>${t("questionsCount", { used: u.usedQ, g: u.usedG })}</span>
      <span>🎯 ${t("picker")}: ${nameOf(room.picker)}</span>
    </div>
    <div class="cols">
      <div class="col-left">
        ${isPicker ? secretCard() : askPanel(u)}
        ${proposalBox()}
        ${logView(log)}
      </div>
      <div class="col-right card">
        <h3>${t("candidates", { n: cands.length })}</h3>
        ${isPicker ? nothing : html`<p class="hint">${t("guessHint")}</p>`}
        <div class="grid">
          ${[...cands, ...data.players().filter((p) => wrong.has(p.id))].map((p) =>
            photo(p, { crossed: wrong.has(p.id), onClick: isPicker || wrong.has(p.id) ? null : () => guess(p, u) })
          )}
        </div>
      </div>
    </div>`;
}

function guess(p, u) {
  if (u.myG > 0) ask(t("guessThis", { name: p.name }), () => act({ type: "guess", pid: p.id }), playerCard(p));
  else if (u.sharedG > 0 && !state.room.proposal)
    ask(t("proposeG", { name: p.name }), () => act({ type: "propose", kind: "g", value: p.id }), playerCard(p));
  else ask(t("noGuessesLeft"), () => {});
}

function secretCard() {
  const p = data.playerById(state.room.secret);
  return html`<div class="card"><h3>🤫 ${t("secretIs")}</h3>${playerCard(p)}</div>`;
}

function askPanel(u) {
  const room = state.room;
  const asked = new Set(arr(room.log).filter((e) => e.kind === "q").map((e) => e.qid));
  const cat = state.ui.cat || "nat";
  const cats = ["nat", "league", "club", "career", "look", "award"];
  const canAsk = u.myQ > 0 || (u.sharedQ > 0 && !room.proposal);
  const onAsk = (q) => {
    if (u.myQ > 0) ask(q.text(), () => act({ type: "ask", qid: q.id }));
    else if (u.sharedQ > 0) ask(t("proposeQ") + " — " + q.text(), () => act({ type: "propose", kind: "q", value: q.id }));
  };
  return html`<div class="card">
    <h3>❓ ${t("askTitle")}</h3>
    <p class="quota">${t("yourQuestions", { n: u.myQ })} · ${t("yourGuesses", { n: u.myG })}</p>
    ${u.sharedQ + u.sharedG > 0 ? html`<p class="hint">${t("sharedLeft", { q: u.sharedQ, g: u.sharedG })}</p>` : nothing}
    ${canAsk
      ? html`<div class="tabs">
            ${cats.map((c) => html`<button class=${c === cat ? "tab active" : "tab"} @click=${() => setUi({ cat: c })}>${t("cat_" + c)}</button>`)}
          </div>
          <div class="qlist">
            ${data
              .questions()
              .filter((q) => q.cat === cat && !asked.has(q.id))
              .map((q) => html`<button class="q" @click=${() => onAsk(q)}>${q.text()}</button>`)}
          </div>`
      : html`<p class="hint">${t("noQuestionsLeft")}</p>`}
  </div>`;
}

function proposalBox() {
  const room = state.room;
  const p = room.proposal;
  if (!p) return nothing;
  const me = state.me.key;
  const what = p.kind === "q" ? data.questionById(p.value).text() : t("proposalGuess", { name: data.playerById(p.value).name });
  const voted = p.votes?.[me];
  const isGuesser = arr(room.guessers).includes(me);
  return html`<div class="card proposal">
    <p>${t("proposal", { name: nameOf(p.by) })}</p>
    <p class="big">${what}</p>
    ${isGuesser && !voted
      ? html`<div class="row">
          <button class="primary" @click=${() => act({ type: "vote", yes: true })}>👍 ${t("agree")}</button>
          <button @click=${() => act({ type: "vote", yes: false })}>👎 ${t("disagree")}</button>
        </div>`
      : html`<p class="hint">${t("waitingVotes")}</p>
          ${p.by === me ? html`<button class="small" @click=${() => act({ type: "cancelProposal" })}>${t("cancel")}</button>` : nothing}`}
  </div>`;
}

function logView(log) {
  return html`<div class="card">
    <h3>📜 ${t("log")}</h3>
    ${log.length
      ? html`<ol class="log">
          ${log.map((e) =>
            e.kind === "q"
              ? html`<li>
                  <small>${nameOf(e.by)}${e.shared ? " 🤝" : ""}:</small> ${data.questionById(e.qid).text()}
                  <b class=${e.ans ? "yes" : "no"}>${e.ans ? t("yes") : t("no")}</b>
                </li>`
              : html`<li>
                  <small>${nameOf(e.by)}${e.shared ? " 🤝" : ""}:</small> ${t("guessed", { name: data.playerById(e.pid).name })}
                  <b class=${e.ok ? "yes" : "no"}>${e.ok ? t("correct") : t("wrong")}</b>
                </li>`
          )}
        </ol>`
      : html`<p class="hint">—</p>`}
  </div>`;
}

// ---------- ended ----------

function ended() {
  const room = state.room;
  const r = room.result;
  const p = data.playerById(room.secret);
  const info = logic.pot(room, room.endedAt);
  return html`<div class="card center">
      <h2>${t("gameOver")}</h2>
      <p class="big">${r.pickerWon ? t("pickerWins", { name: nameOf(room.picker) }) : t("winnerIs", { name: nameOf(r.winner) })}</p>
      <p>${t("answerWas", { name: p.name })}</p>
      ${playerCard(p)}
      ${r.pickerWon ? nothing : html`<p class="hint">${t("potInfo", { pot: info.pot, ...info })}</p>`}
      <table class="board">
        ${roomPlayers(room).map(
          (pl) => html`<tr class=${pl.key === state.me.key ? "mine" : ""}>
            <td>${pl.name}${pl.key === room.picker ? " 🎯" : ""}</td><td><b>${t("pointsWon", { n: r.points[pl.key] || 0 })}</b></td>
          </tr>`
        )}
      </table>
      <a class="button primary" href="#/footballer">${t("playAgain")}</a>
    </div>
    ${logView(arr(room.log))}`;
}

// ---------- pieces ----------

function photo(p, { onClick, crossed } = {}) {
  return html`<button class="photo ${crossed ? "crossed" : ""}" ?disabled=${!onClick} @click=${onClick || null} title=${p.name}>
    <img loading="lazy" src=${data.photoUrl(p)} alt=${p.name} />
    <span>${p.name}</span>
  </button>`;
}

function playerCard(p, short) {
  return html`<div class="player-card">
    <img src=${data.photoUrl(p, 330)} alt=${p.name} />
    <div>
      <h3>${p.name}</h3>
      <p>${data.countryName(p.nat)} · ${p.born} · ${p.pos.map(data.posLabel).join(", ")}${p.height ? ` · ${p.height} cm` : ""}</p>
      ${short ? nothing : html`<p class="hint">${p.clubs.map(data.clubName).join(", ")}</p>`}
    </div>
  </div>`;
}
