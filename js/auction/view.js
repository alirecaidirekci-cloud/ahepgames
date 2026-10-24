// Screens for Transfer Auction.
import { state, act, roomHeader } from "../app.js";
import { db } from "../db.js";
import { t } from "../i18n.js";
import { html, nothing, fmtTime, roomPlayers, shuffle } from "../lib.js";
import * as data from "../footballer/data.js";
import * as logic from "./logic.js";

export const MAX_PLAYERS = logic.MAX_PLAYERS;
export const icon = "💶";
export const reduce = logic.reduce;
export const prepare = () => data.loadData();
export const needsTick = (room, now) => room.status === "playing" && now >= room.deadline;
export const info = () => ({ budget: logic.BUDGET });
export const noScores = true; // no leaderboard points for this game

const nameOf = (key) => state.room.players?.[key]?.name || key;
const ROLE_ICON = { GK: "🧤", DF: "🛡️", MF: "🎯", W: "⚡", ST: "⚽" };
const roleName = (r) => t("role_" + r);

// For each position: one top player and one moderate player (by fame), in random order [shown, hidden].
function drawPairs() {
  const pairs = {};
  for (const role of logic.POSITIONS) {
    const pool = data.players().filter((p) => p.role === role).sort((a, b) => b.fame - a.fame);
    const third = Math.floor(pool.length / 3);
    const top = shuffle(pool.slice(0, third))[0];
    const moderate = shuffle(pool.slice(third, 2 * third))[0];
    pairs[role] = shuffle([top.id, moderate.id]);
  }
  return pairs;
}

export function view() {
  const room = state.room;
  return html`${roomHeader("auction")} ${room.status === "lobby" ? lobby() : room.status === "playing" ? playing() : ended()}`;
}

// ---------- lobby ----------

function lobby() {
  const room = state.room;
  const me = state.me.key;
  const ps = roomPlayers(room);
  return html`<div class="card">
    <h3>${t("players")} (${ps.length}/${MAX_PLAYERS})</h3>
    <ul class="players">
      ${ps.map((p) => html`<li>${p.name} ${p.key === me ? html`<small>(${t("you")})</small>` : nothing}</li>`)}
    </ul>
    <p class="hint">${t("auctionRules", { budget: logic.BUDGET, sec: logic.BID_MS / 1000 })}</p>
    ${room.host === me
      ? html`<button class="primary" ?disabled=${ps.length !== 2} @click=${() => act({ type: "start", pairs: drawPairs() })}>${t("start")}</button>
          ${ps.length !== 2 ? html`<p class="hint">${t("needPlayers", { n: 2 })}</p>` : nothing}`
      : html`<p class="hint">${t("waitingHost")}</p>`}
  </div>`;
}

// ---------- playing ----------

function playerCard(id, extra) {
  const p = data.playerById(id);
  return html`<div class="auction-card">
    <img src=${data.photoUrl(p, 330)} alt=${p.name} />
    <b>${p.name}</b>
    <small>${data.countryName(p.nat)} · ${p.born}</small>
    ${extra || nothing}
  </div>`;
}

const hiddenCard = () => html`<div class="auction-card hidden-card"><div class="mystery">?</div><b>${t("hiddenPlayer")}</b><small>${t("hiddenHint")}</small></div>`;

function squadView(key) {
  const room = state.room;
  const squad = room.squads?.[key] || {};
  return html`<div class="card squad">
    <h3>${nameOf(key)} ${key === state.me.key ? html`<small>(${t("you")})</small>` : nothing}</h3>
    <p class="budget">💶 €${room.budgets[key]}</p>
    <ul class="squad-list">
      ${logic.POSITIONS.map((pos) => {
        const s = squad[pos];
        const p = s && data.playerById(s.id);
        return html`<li>
          <span>${ROLE_ICON[pos]} ${roleName(pos)}</span>
          ${p ? html`<b>${p.name}</b><small>${s.price ? "€" + s.price : t("free")}</small>` : html`<span class="hint">—</span>`}
        </li>`;
      })}
    </ul>
  </div>`;
}

function playing() {
  const room = state.room;
  const me = state.me.key;
  const [a, b] = logic.bidders(room);
  const left = room.deadline - db.now();
  if (room.phase === "coin") {
    const flipping = left > 1200;
    return html`<div class="card center">
      <div class="coin ${flipping ? "flip" : ""}">${flipping ? "🪙" : "💶"}</div>
      <p class="big">${flipping ? t("coinFlip") : t("opensFirst", { name: nameOf(room.coin) })}</p>
    </div>`;
  }
  const pos = logic.POSITIONS[room.idx];
  const [shown, hidden] = room.pairs[pos];
  const progress = html`<div class="progress">
    ${logic.POSITIONS.map((p, i) => html`<span class=${i === room.idx ? "pill gold" : i < room.idx ? "pill done" : "pill"}>${ROLE_ICON[p]} ${roleName(p)}</span>`)}
  </div>`;

  let center;
  if (room.phase === "bid") {
    const leading = room.bid.by === me;
    const myBudget = room.budgets[me] ?? 0;
    const bidBtn = (amount) =>
      html`<button class="primary" ?disabled=${leading || amount > myBudget} @click=${() => act({ type: "raise", amount })}>€${amount}</button>`;
    const next = room.bid.amount + 1;
    center = html`<div class="auction-stage">
        ${playerCard(shown)} ${hiddenCard()}
      </div>
      <div class="bid-box">
        <p class="big">${t("currentBid", { amount: room.bid.amount, name: nameOf(room.bid.by) })}</p>
        <p><span class="timer ${left < 4000 ? "urgent" : ""}">⏱ ${fmtTime(left)}</span></p>
        ${room.players[me]
          ? leading
            ? html`<p class="hint">${t("youLead")}</p>`
            : html`<div class="row center-row">
                  ${bidBtn(next)} ${bidBtn(next + 1)} ${bidBtn(next + 4)}
                  <form class="row" @submit=${(e) => (e.preventDefault(), act({ type: "raise", amount: Number(new FormData(e.target).get("amt")) }))}>
                    <input name="amt" type="number" min=${next} max=${myBudget} placeholder="€" class="bid-input" />
                    <button ?disabled=${next > myBudget}>${t("bid")}</button>
                  </form>
                </div>
                ${next > myBudget ? html`<p class="hint">${t("cantAfford")}</p>` : nothing}`
          : nothing}
        <p class="hint">${t("bidRule")}</p>
      </div>`;
  } else {
    const l = room.last;
    const loser = logic.opponent(room, l.winner);
    center = html`<div class="auction-stage">
        ${playerCard(shown, html`<span class="pill gold">${nameOf(l.winner)} · ${l.price ? "€" + l.price : t("free")}</span>`)}
        ${playerCard(hidden, html`<span class="pill">${nameOf(loser)} · ${t("free")}</span>`)}
      </div>
      <p class="big center">${t("auctionWon", { name: nameOf(l.winner), price: l.price })}</p>`;
  }

  return html`${progress}
    <div class="auction-layout">
      ${squadView(a)}
      <div class="card auction-center">
        <h3>${ROLE_ICON[pos]} ${roleName(pos)} · ${t("opener", { name: nameOf(logic.openerOf(room, room.idx)) })}</h3>
        ${center}
      </div>
      ${squadView(b)}
    </div>`;
}

// ---------- ended ----------

function ended() {
  const room = state.room;
  const [a, b] = logic.bidders(room);
  return html`<div class="card center">
      <h2>${t("auctionDone")}</h2>
      <p class="hint">${t("noWinner")}</p>
    </div>
    <div class="auction-layout two">${squadView(a)} ${squadView(b)}</div>
    <p class="center"><a class="button primary" href="#/auction">${t("playAgain")}</a></p>`;
}
