// Screens for Transfer Auction.
import { state, act, roomHeader } from "../app.js";
import { db } from "../db.js";
import { t } from "../i18n.js";
import { html, nothing, roomPlayers, shuffle, fmtTime } from "../lib.js";
import * as data from "../footballer/data.js";
import * as logic from "./logic.js";

export const MAX_PLAYERS = logic.MAX_PLAYERS;
export const icon = "💶";
export const reduce = logic.reduce;
export const prepare = () => data.loadData();
export const needsTick = (room, now) => room.status === "playing" && now >= room.deadline;
export const info = () => ({ budget: logic.BUDGET });
export const noScores = true; // no leaderboard points for this game
export const chat = true; // room chat under the game (js/chat.js)

const nameOf = (key) => state.room.players?.[key]?.name || key;
const ROLE_ICON = { GK: "🧤", DF: "🛡️", MF: "🎯", W: "⚡", ST: "⚽" };
const roleName = (r) => t("role_" + r);

// For each position: one top player and one moderate player (by fame), in random order [shown, hidden].
function drawPairs() {
  const pairs = {};
  for (const role of logic.POSITIONS) {
    const pool = data.players().filter((p) => p.role === role && !p.extra).sort((a, b) => b.fame - a.fame);
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
// One compact column that fits a phone screen: money bar, the two cards side by side,
// the bid area, then both teams as small photo lineups.

const surname = (name) => name.split(" ").slice(-1)[0];

function playerCard(id, tag) {
  const p = data.playerById(id);
  return html`<div class="auc-card">
    <img src=${data.photoUrl(p, 330)} alt=${p.name} />
    <b>${p.name}</b>
    <small>${data.countryName(p.nat)} · ${p.born}</small>
    ${tag || nothing}
  </div>`;
}

const hiddenCard = () =>
  html`<div class="auc-card">
    <div class="auc-mystery">?</div>
    <b>${t("hiddenPlayer")}</b>
    <small>${t("hiddenHint")}</small>
  </div>`;

// Both players' money; the one holding the highest bid is highlighted.
function moneyBar() {
  const room = state.room;
  const me = state.me.key;
  const [a, b] = logic.bidders(room);
  const side = (k) => html`<div class="auc-money ${room.bid?.by === k && room.phase === "bid" ? "leading" : ""}">
    <span>${nameOf(k)}${k === me ? ` (${t("you")})` : ""}</span>
    <b>€${room.budgets[k]}</b>
  </div>`;
  return html`<div class="auc-moneybar">${side(a)}<span class="auc-vs">vs</span>${side(b)}</div>`;
}

function progressDots() {
  const room = state.room;
  return html`<div class="auc-progress">
    ${logic.POSITIONS.map(
      (p, i) => html`<span class=${i === room.idx && room.status === "playing" && room.phase !== "vote" ? "now" : i < room.idx || room.status === "ended" ? "done" : ""} title=${roleName(p)}>
        ${ROLE_ICON[p]}<small>${roleName(p)}</small>
      </span>`
    )}
  </div>`;
}

// A team as five small slots (photo, surname, price).
function lineup(key) {
  const room = state.room;
  const squad = room.squads?.[key] || {};
  return html`<div class="auc-lineup">
    <div class="auc-lineup-head">
      <b>${nameOf(key)}${key === state.me.key ? ` (${t("you")})` : ""}</b><span>€${room.budgets[key]}</span>
    </div>
    <div class="auc-slots">
      ${logic.POSITIONS.map((pos) => {
        const s = squad[pos];
        const p = s && data.playerById(s.id);
        return html`<div class="auc-slot ${p ? "" : "empty"}">
          ${p ? html`<img src=${data.photoUrl(p, 120)} alt=${p.name} />` : html`<span class="auc-slot-icon">${ROLE_ICON[pos]}</span>`}
          <small>${p ? surname(p.name) : roleName(pos)}</small>
          ${p ? html`<em>${s.price ? "€" + s.price : t("free")}</em>` : nothing}
        </div>`;
      })}
    </div>
  </div>`;
}

function bidArea() {
  const room = state.room;
  const me = state.me.key;
  const left = Math.max(0, room.deadline - db.now());
  const pct = Math.min(100, (left / logic.BID_MS) * 100);
  const leading = room.bid.by === me;
  const myBudget = room.budgets[me] ?? 0;
  const next = room.bid.amount + 1;
  const quick = [...new Set([next, next + 1, next + 4])].filter((x) => x <= myBudget);
  let controls = nothing;
  if (room.players[me]) {
    if (leading) controls = html`<p class="auc-status ok">✓ ${t("youLead")}</p>`;
    else if (next > myBudget) controls = html`<p class="auc-status">${t("cantAfford")}</p>`;
    else
      controls = html`<div class="auc-buttons">
          ${quick.map((amount) => html`<button class="primary" @click=${() => act({ type: "raise", amount })}>€${amount}</button>`)}
        </div>
        <form class="auc-custom" @submit=${(e) => (e.preventDefault(), act({ type: "raise", amount: Number(new FormData(e.target).get("amt")) }), e.target.reset())}>
          <input name="amt" type="number" inputmode="numeric" min=${next} max=${myBudget} placeholder="€${next}–${myBudget}" />
          <button>${t("bid")}</button>
        </form>`;
  }
  return html`<div class="auc-bid">
    <div class="auc-bid-top">
      <span>${t("highestBid")}</span>
      <b>€${room.bid.amount}</b>
      <span>${nameOf(room.bid.by)}</span>
    </div>
    <div class="auc-timer ${left < 4000 ? "urgent" : ""}"><div style="width:${pct}%"></div></div>
    ${controls}
  </div>`;
}

// ---------- voting (after the transfer window) ----------
// Both teams as two rows of five cards (one column per position), like the lineups during the
// auction but bigger. Everyone in the room taps the better footballer in each column; vote counts
// stay hidden until the vote closes.

function boardCard(owner, pos, { picked, onPick, votes, win }) {
  const s = state.room.squads?.[owner]?.[pos];
  const p = s && data.playerById(s.id);
  if (!p) return html`<div class="auc-bcard empty"></div>`;
  const body = html`<img src=${data.photoUrl(p, 250)} alt=${p.name} />
    <b title=${p.name}>${surname(p.name)}</b>
    <small class="auc-bcard-nat">${data.countryName(p.nat)}</small>
    <em>${s.price ? "€" + s.price : t("free")}</em>
    ${picked ? html`<span class="auc-check">✓</span>` : nothing}
    ${votes !== undefined ? html`<span class="auc-votes">${win ? "🏆" : ""}${t("votesN", { n: votes })}</span>` : nothing}`;
  return onPick
    ? html`<button class="auc-bcard ${picked ? "on" : ""}" title=${p.name} @click=${onPick}>${body}</button>`
    : html`<div class="auc-bcard ${win ? "win" : ""}" title=${p.name}>${body}</div>`;
}

// opts(owner, pos) -> options for boardCard
function teamBoard(opts) {
  const room = state.room;
  const [a, b] = logic.bidders(room);
  const teamRow = (owner) => html`
    <div class="auc-board-team">
      <b>${nameOf(owner)}${owner === state.me.key ? ` (${t("you")})` : ""}</b><span>€${room.budgets?.[owner] ?? 0}</span>
    </div>
    ${logic.POSITIONS.map((pos) => boardCard(owner, pos, opts(owner, pos)))}`;
  return html`<div class="card auc-board">
    ${logic.POSITIONS.map((pos) => html`<div class="auc-board-pos">${ROLE_ICON[pos]}<small>${roleName(pos)}</small></div>`)}
    ${teamRow(a)} ${teamRow(b)}
  </div>`;
}

function voting() {
  const room = state.room;
  const me = state.me.key;
  const canVote = logic.voters(room).includes(me);
  const mine = room.votes?.[me] || {};
  const all = logic.voters(room);
  const done = all.filter((k) => logic.POSITIONS.every((pos) => room.votes?.[k]?.[pos])).length;
  const left = Math.max(0, room.deadline - db.now());
  return html`<div class="auc">
    <div class="card auc-main center">
      <h2>${t("auctionDone")}</h2>
      <p class="big">🗳️ ${t("voteTitle")}</p>
      <p class="hint">${t("voteHint")}</p>
      <div class="auc-timer ${left < 15000 ? "urgent" : ""}"><div style="width:${Math.min(100, (left / logic.VOTE_MS) * 100)}%"></div></div>
      <p class="hint">⏱ ${fmtTime(left)} · ${t("votedCount", { v: done, n: all.length })}</p>
    </div>
    ${teamBoard((owner, pos) => ({ picked: mine[pos] === owner, onPick: canVote ? () => act({ type: "vote", pos, side: owner }) : null }))}
  </div>`;
}

function playing() {
  const room = state.room;
  if (room.phase === "vote") return voting();
  const left = room.deadline - db.now();
  if (room.phase === "coin") {
    const flipping = left > 1200;
    return html`<div class="card center">
      <div class="coin ${flipping ? "flip" : ""}">${flipping ? "🪙" : "💶"}</div>
      <p class="big">${flipping ? t("coinFlip") : t("opensFirst", { name: nameOf(room.coin) })}</p>
    </div>`;
  }
  const [a, b] = logic.bidders(room);
  const pos = logic.POSITIONS[room.idx];
  const [shown, hidden] = room.pairs[pos];
  let stage;
  if (room.phase === "bid") {
    stage = html`<div class="auc-stage">${playerCard(shown)} ${hiddenCard()}</div>
      ${bidArea()}`;
  } else {
    const l = room.last;
    const loser = logic.opponent(room, l.winner);
    stage = html`<div class="auc-stage">
        ${playerCard(shown, html`<span class="pill gold">→ ${nameOf(l.winner)} · ${l.price ? "€" + l.price : t("free")}</span>`)}
        ${playerCard(hidden, html`<span class="pill">→ ${nameOf(loser)} · ${t("free")}</span>`)}
      </div>
      <p class="auc-result">${t("auctionWon", { name: nameOf(l.winner), price: l.price })}</p>`;
  }
  return html`<div class="auc">
    ${progressDots()} ${moneyBar()}
    <div class="card auc-main">
      <p class="auc-title">${ROLE_ICON[pos]} ${roleName(pos)} <small>· ${t("opener", { name: nameOf(logic.openerOf(room, room.idx)) })}</small></p>
      ${stage}
    </div>
    <div class="card auc-teams">${lineup(a)} ${lineup(b)}</div>
    <details class="auc-help"><summary>${t("howItWorks")}</summary><p class="hint">${t("auctionRules", { budget: logic.BUDGET, sec: logic.BID_MS / 1000 })}</p></details>
  </div>`;
}

// ---------- ended ----------

function ended() {
  const room = state.room;
  const [a, b] = logic.bidders(room);
  const res = room.result || logic.tally(room);
  const score = { a: res.won?.[a] || 0, b: res.won?.[b] || 0 };
  const headline = res.winner
    ? t("voteWinner", { name: nameOf(res.winner), x: Math.max(score.a, score.b), y: Math.min(score.a, score.b) })
    : t("voteDraw", { x: score.a, y: score.b });
  return html`<div class="auc">
    <div class="card center auc-main">
      <h2>${t("auctionDone")}</h2>
      <p class="big">${headline}</p>
      <p class="hint">${nameOf(a)} ${score.a} – ${score.b} ${nameOf(b)} · ${t("voteNoPoints")}</p>
    </div>
    ${teamBoard((owner, pos) => {
      const r = res.positions?.[pos] || { counts: {} };
      return { votes: r.counts?.[owner] || 0, win: r.winner === owner };
    })}
    <p class="center">
      ${room.players?.[state.me.key] ? html`<button class="primary" @click=${() => act({ type: "replay", pairs: drawPairs() })}>🔁 ${t("replay")}</button>` : nothing}
      <a class="button" href="#/auction">${t("playAgain")}</a>
    </p>
  </div>`;
}
