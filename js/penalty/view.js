// Screens for the Penalty Shootout: 1v1 rooms and solo against the computer (#/penalty/solo, played
// only in this browser). The goal is an SVG scene; aiming uses markers that sweep across the goal
// and bars that fill and empty (moved by requestAnimationFrame, not by re-rendering). Each kick is
// shown as a CSS animation that is re-created for every new kick (keyed).
import { state, act, rerender, roomHeader } from "../app.js";
import { db } from "../db.js";
import { t } from "../i18n.js";
import { html, nothing, roomPlayers, isSpectator, fmtTime } from "../lib.js";
import { svg } from "https://cdn.jsdelivr.net/npm/lit-html@3.1.4/lit-html.js";
import { keyed } from "https://cdn.jsdelivr.net/npm/lit-html@3.1.4/directives/keyed.js";
import * as logic from "./logic.js";
import * as admins from "../admins.js";

export const MAX_PLAYERS = logic.MAX_PLAYERS;
export const icon = "🥅";
export const noScores = true;
export const reduce = logic.reduce;
export const info = () => ({ k: logic.KICKS, lv: logic.LEVELS });
export const needsTick = (room, now) => room.status === "playing" && !!room.cur && now >= room.cur.deadline;

// ---------- scene geometry (SVG units) ----------
// Goal: posts at x 80 and 320, ground at y 150, crossbar at y 70 (240 × 80 = 7.32 m × 2.44 m).
const gx = (x) => 80 + 240 * x;
const gy = (y) => 150 - 80 * y;
const PX_PER_M = 240 / logic.GOAL_W;
const SPOT = [200, 228];
const KEEPER_MID = [200, 119]; // middle of the standing keeper's body

const r1 = (n) => Math.round(n * 10) / 10;

function keeperFigure(cls = "") {
  return svg`<g class="pk-keeper ${cls}">
    <rect x="193" y="128" width="5" height="22" rx="2" class="pk-leg" />
    <rect x="202" y="128" width="5" height="22" rx="2" class="pk-leg" />
    <rect x="189" y="104" width="22" height="27" rx="5" class="pk-kit-k" />
    <rect x="176" y="104" width="14" height="5" rx="2" class="pk-kit-k" transform="rotate(-35 189 106)" />
    <rect x="210" y="104" width="14" height="5" rx="2" class="pk-kit-k" transform="rotate(35 211 106)" />
    <circle cx="176" cy="96" r="4" class="pk-glove" />
    <circle cx="224" cy="96" r="4" class="pk-glove" />
    <circle cx="200" cy="96" r="7" class="pk-skin" />
  </g>`;
}
const takerFigure = () => svg`<g class="pk-taker">
  <rect x="171" y="238" width="5" height="16" rx="2" class="pk-leg" />
  <rect x="179" y="238" width="5" height="16" rx="2" class="pk-leg" />
  <rect x="168" y="218" width="19" height="22" rx="5" class="pk-kit-t" />
  <circle cx="177.5" cy="211" r="6.5" class="pk-skin" />
</g>`;

// Grass, lines, net and goal frame; extra = SVG drawn on top (markers, ball, figures).
function scene(extra, cls = "", style = "") {
  const net = [];
  for (let x = 80; x <= 320; x += 12) net.push(svg`<line x1=${x} y1="70" x2=${x} y2="150" />`);
  for (let y = 70; y <= 150; y += 10) net.push(svg`<line x1="80" y1=${y} x2="320" y2=${y} />`);
  return html`<svg class="pk-scene ${cls}" style=${style} viewBox="0 0 400 260" role="img" aria-label=${t("penalty")}>
    <defs>
      <linearGradient id="pk-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="pk-sky1" /><stop offset="1" class="pk-sky2" /></linearGradient>
    </defs>
    <rect width="400" height="150" fill="url(#pk-sky)" />
    <rect y="150" width="400" height="110" class="pk-grass" />
    ${[0, 1, 2, 3, 4].map((i) => svg`<rect y=${150 + i * 22} width="400" height="11" class="pk-stripe" />`)}
    <path d="M20 150 L60 205 L340 205 L380 150" class="pk-line" />
    <circle cx=${SPOT[0]} cy=${SPOT[1]} r="2.5" class="pk-spotdot" />
    <g class="pk-net">${net}</g>
    <path d="M80 150 L80 70 L320 70 L320 150" class="pk-frame" />
    ${extra}
  </svg>`;
}

// ---------- the kick animation ----------
// Timeline (ms): taker runs 0–350, ball flies 300–1000, keeper dives 250–850, banner at 1050.
// started: ms since the kick when it was first shown here (a late viewer sees the end state at
// once: negative delays). Fixed per kick, so re-rendering doesn't move the animation.
const firstSeen = new Map();
function kickScene(id, k, startedNow) {
  if (!firstSeen.has(id)) firstSeen.set(id, startedNow);
  const started = firstSeen.get(id);
  const tx = gx(k.bx);
  const ty = gy(k.by);
  const dx = r1(tx - SPOT[0]);
  const dy = r1(ty - SPOT[1]);
  const side = Math.sign(dx) || 1;
  const kdx = r1(gx(k.kx) - KEEPER_MID[0]);
  const kdy = r1(Math.min(gy(k.ky), 131) - KEEPER_MID[1]);
  const rot = Math.round(Math.max(-80, Math.min(80, (k.kx - 0.5) * 190)));
  const vars = `--t0:${-Math.round(started)}ms; --dx:${dx}px; --dy:${dy}px; --rx:${r1(dx + side * 55)}px; --ry:${r1(dy + 70)}px;
    --kdx:${kdx}px; --kdy:${kdy}px; --krot:${rot}deg`;
  const label = { goal: t("pkGoal"), save: t("pkSave"), miss: k.late ? t("pkLate") : t("pkMiss") }[k.out];
  return scene(
    svg`<g class="pk-anim">
      ${k.reach ? svg`<circle cx=${r1(gx(k.kx))} cy=${r1(gy(k.ky))} r=${r1(k.reach * PX_PER_M)} class="pk-reach" />` : nothing}
      <g class="pk-dive">${keeperFigure()}</g>
      <g class="pk-run">${takerFigure()}</g>
      <g class="pk-ball"><circle cx=${SPOT[0]} cy=${SPOT[1]} r="7" class="pk-ballc" /><path d="M196 225 l4 -3 l4 3 l-1.5 4.5 h-5 z" class="pk-ballp" /></g>
      <text x="200" y="44" class="pk-banner">${label}</text>
    </g>`,
    `pk-out-${k.out}`,
    vars
  );
}

// ---------- aiming / diving ----------
// One input per kick: x (left → right), y (ground → bar) and b (the bar), each set by stopping a
// moving marker. Kept in memory per kick; the sealed value and its salt stay in this browser until
// they are revealed (sessionStorage, so a refresh doesn't lose them).
const tri = (ms, period) => {
  const p = (ms % period) / period;
  return p < 0.5 ? p * 2 : 2 - p * 2;
};
let inp = null; // {id, level, role, step: 0 x, 1 y, 2 bar, 3 done, t0, x, y}
const PENDING = "fg-pk-pending";
const loadPending = () => {
  try {
    return JSON.parse(sessionStorage.getItem(PENDING) || "{}");
  } catch {
    return {};
  }
};
function savePending(id, val) {
  const all = loadPending();
  all[id] = val;
  for (const k of Object.keys(all).slice(0, -6)) delete all[k]; // keep only the last few
  try {
    sessionStorage.setItem(PENDING, JSON.stringify(all));
  } catch {}
}

function currentValue() {
  const ms = performance.now() - inp.t0;
  return tri(ms, inp.step === 2 ? logic.BAR_MS[inp.level - 1] : logic.AIM_MS[inp.level - 1]);
}

// Moves the markers every frame while an input is running.
let frameOn = false;
function frame() {
  if (!inp || inp.step > 2 || !document.querySelector(".pk-input")) return (frameOn = false);
  const v = currentValue();
  const mx = document.getElementById("pk-mx");
  const my = document.getElementById("pk-my");
  const ind = document.getElementById("pk-ind");
  if (inp.step === 0 && mx) mx.setAttribute("transform", `translate(${r1(gx(v) - 200)} 0)`);
  if (inp.step === 1 && my) my.setAttribute("transform", `translate(0 ${r1(gy(v) - 110)})`);
  if (inp.step === 2 && ind) ind.style.left = `${(v * 100).toFixed(1)}%`;
  requestAnimationFrame(frame);
}
function startFrames() {
  if (frameOn) return;
  frameOn = true;
  requestAnimationFrame(frame);
}

// A tap (button, the scene or the space bar) stops the current marker.
function stop(submit) {
  if (!inp || inp.step > 2) return;
  const v = Math.round(currentValue() * 1000) / 1000;
  if (inp.step === 0) inp.x = v;
  else if (inp.step === 1) inp.y = v;
  else {
    const val = { x: inp.x, y: inp.y, b: v };
    const s = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    savePending(inp.id, { v: val, s });
    inp.b = v;
    submit(logic.sealOf(val, s));
  }
  inp.step++;
  inp.t0 = performance.now();
  rerender();
}
addEventListener("keydown", (e) => {
  if ((e.code === "Space" || e.code === "Enter") && inp && inp.step <= 2 && document.querySelector(".pk-input") && e.target === document.body) {
    e.preventDefault();
    document.querySelector(".pk-stop")?.click();
  }
});

function inputView(id, role, level, submit) {
  if (inp?.id !== id) inp = { id, role, level, step: 0, t0: performance.now() };
  const taker = role === "taker";
  const step = inp.step;
  const steps = taker ? ["pkStepAimX", "pkStepAimY", "pkStepPower"] : ["pkStepDiveX", "pkStepDiveY", "pkStepReach"];
  const [lo, hi] = logic.green(level);
  const mark = taker ? "pk-aim" : "pk-glovemark";
  const doStop = () => stop(submit);
  startFrames();
  const markers = svg`
    ${step === 0 ? svg`<g id="pk-mx" class=${mark}><line x1="200" y1="60" x2="200" y2="156" /></g>` : nothing}
    ${step >= 1 ? svg`<line x1=${gx(inp.x)} y1="60" x2=${gx(inp.x)} y2="156" class="${mark} pk-set" />` : nothing}
    ${step === 1 ? svg`<g id="pk-my" class=${mark}><line x1="74" y1="110" x2="326" y2="110" /><circle cx=${gx(inp.x)} cy="110" r="7" /></g>` : nothing}
    ${step >= 2 ? svg`<circle cx=${gx(inp.x)} cy=${gy(inp.y)} r="7" class="${mark} pk-set" />` : nothing}`;
  return html`<div class="pk-input">
    <p class="pk-role">${taker ? t("pkYouShoot") : t("pkYouKeep")}</p>
    <div class="pk-tap" @click=${doStop}>
      ${scene(svg`${keeperFigure()} ${takerFigure()}<circle cx=${SPOT[0]} cy=${SPOT[1]} r="7" class="pk-ballc" />${markers}`)}
    </div>
    ${step === 2
      ? html`<div class="pk-bar ${taker ? "" : "reach"}">
          <div class="pk-green" style="left:${(lo * 100).toFixed(1)}%; width:${((hi - lo) * 100).toFixed(1)}%"></div>
          <div class="pk-ind" id="pk-ind"></div>
        </div>`
      : nothing}
    <p class="pk-step"><b>${step + 1}/3</b> ${t(steps[step])}</p>
    <button class="primary pk-stop" @click=${doStop}>✋ ${t("pkStop")}</button>
  </div>`;
}

// Waiting / watching: the scene with both figures standing.
const idleScene = () =>
  scene(svg`${keeperFigure()} ${takerFigure()}<circle cx=${SPOT[0]} cy=${SPOT[1]} r="7" class="pk-ballc" />`);

// ---------- scoreboard ----------
function scoreboard(room, nameOf) {
  const [a, b] = logic.order(room);
  const ks = logic.kicks(room);
  const n = Math.max(logic.KICKS, Math.ceil(ks.length / 2) + (ks.length % 2 === 0 && room.status === "playing" ? 1 : 0));
  const g = logic.goals(room);
  const row = (key, i) => {
    const mine = ks.filter((_, j) => j % 2 === i);
    return html`<div class="pk-row">
      <span class="pk-name">${nameOf(key)}</span>
      <span class="pk-dots">
        ${Array.from({ length: n }, (_, j) =>
          html`<span class="pk-dot ${mine[j] ? (mine[j].out === "goal" ? "goal" : "miss") : ""} ${j >= logic.KICKS ? "sd" : ""}">
            ${mine[j] ? (mine[j].out === "goal" ? "⚽" : "✖") : ""}
          </span>`
        )}
      </span>
      <b class="pk-goals">${g[key] || 0}</b>
    </div>`;
  };
  return html`<div class="card pk-board">${row(a, 0)} ${row(b, 1)}</div>`;
}

// The middle of a game, for rooms and solo alike.
// me: my key, or null for a spectator; now: the clock to use; submit(hash): commits my input.
function playView(room, me, now, nameOf, submit) {
  const ks = logic.kicks(room);
  const last = ks[ks.length - 1];
  const n = ks.length;
  const animating = last && now - last.t < logic.ANIM_MS;
  const level = logic.levelOf(n);
  const { taker, keeper } = logic.roles(room, n);
  // the kick shown: the one being animated, or the next one to take
  const shown = animating || room.status === "ended" ? n : n + 1;
  const head = html`${scoreboard(room, nameOf)}
    <p class="pk-head">
      ${shown > 2 * logic.KICKS ? html`<b class="pk-sd">⚡ ${t("pkSudden")}</b> · ` : nothing}
      ${t("pkLevel", { n: shown, lv: logic.levelOf(shown - 1) })}
    </p>`;
  if (animating || room.status === "ended") {
    return html`${head}
      <p class="pk-who">${t("pkWatchTake", { taker: nameOf(last.taker), keeper: nameOf(last.keeper) })}</p>
      ${keyed(`${room.startedAt}/${n}`, kickScene(`${room.code}/${room.startedAt}/${n}`, last, now - last.t))}`;
  }
  const left = room.cur.deadline - now;
  const committed = room.cur.commit || {};
  const timer = html`<span class="timer ${left < 8000 ? "urgent" : ""}">⏱ ${fmtTime(left)}</span>`;
  const mineRole = me === taker ? "taker" : me === keeper ? "keeper" : null;
  if (mineRole && !committed[me]) {
    return html`${head}<p class="pk-who">${timer} · ${t("pkWatchTake", { taker: nameOf(taker), keeper: nameOf(keeper) })}</p>
      ${inputView(`${room.code || "solo"}/${room.startedAt}/${n}`, mineRole, level, submit)}`;
  }
  const other = me === taker ? keeper : taker;
  return html`${head}
    <p class="pk-who">${timer} · ${t("pkWatchTake", { taker: nameOf(taker), keeper: nameOf(keeper) })}</p>
    ${idleScene()}
    <p class="hint center">
      ${mineRole
        ? t("pkLocked", { name: nameOf(other) })
        : html`⚽ ${nameOf(taker)} ${committed[taker] ? "✅" : "⏳"} · 🧤 ${nameOf(keeper)} ${committed[keeper] ? "✅" : "⏳"}`}
    </p>`;
}

// ---------- multiplayer rooms ----------
const nameOfRoom = (key) => state.room?.players?.[key]?.name || key;

// Reveal my sealed input once both sides have committed (or the time is up). Checked on every room
// change and every screen refresh, and retried until it is saved: a lost reveal would count as
// "no input" when the time runs out.
let revealing = null;
function tryReveal() {
  const room = state.room;
  const me = state.me?.key;
  const c = room?.cur?.commit;
  if (room?.status !== "playing" || !c?.[me] || room.cur.reveal?.[me]) return;
  if (Object.keys(c).length < 2 && db.now() < room.cur.deadline) return;
  const id = `${room.code}/${room.startedAt}/${logic.kicks(room).length}`;
  const p = loadPending()[id];
  if (!p || revealing === id) return;
  revealing = id;
  act({ type: "reveal", v: p.v, s: p.s })
    .catch(() => false)
    .then((ok) => {
      revealing = null;
      if (!ok) setTimeout(tryReveal, 500);
    });
}
export const onRoom = () => setTimeout(tryReveal);

export function view() {
  const room = state.room;
  const me = state.me.key;
  if (room.status === "playing") setTimeout(tryReveal);
  return html`${roomHeader("penalty")}
    ${room.status === "lobby"
      ? lobby(room, me)
      : html`${playView(room, isSpectator(room, me) ? null : me, db.now(), nameOfRoom, (h) => act({ type: "commit", h }))}
          ${room.status === "ended" && db.now() - (logic.kicks(room).at(-1)?.t || 0) >= logic.ANIM_MS ? ended(room, me) : nothing}`}`;
}

const rules = () => html`<p class="hint">${t("pkRules")}</p>`;

function lobby(room, me) {
  const ps = roomPlayers(room);
  return html`<div class="card">
    <h3>${t("players")} (${ps.length}/${MAX_PLAYERS})</h3>
    <ul class="players">
      ${ps.map((p) => html`<li>${p.name} ${p.key === me ? html`<small>(${t("you")})</small>` : nothing}
        ${p.key === room.host ? html`<span class="pill">${t("host")}</span>` : nothing}</li>`)}
    </ul>
    ${rules()}
    ${room.host === me
      ? html`<button class="primary" ?disabled=${ps.length !== 2} @click=${() => act({ type: "start" })}>${t("start")}</button>
          ${ps.length !== 2 ? html`<p class="hint">${t("pkNeed2")}</p>` : nothing}`
      : html`<p class="hint">${t("waitingHost")}</p>`}
  </div>`;
}

function ended(room, me) {
  const w = room.result?.winner;
  const g = logic.goals(room);
  const [a, b] = logic.order(room);
  return html`<div class="card center">
    <h2>${t("gameOver")}</h2>
    <p class="big">🏆 ${t("pkWins", { name: nameOfRoom(w) })}</p>
    <p>${nameOfRoom(a)} <b>${g[a]}–${g[b]}</b> ${nameOfRoom(b)}</p>
    <div class="row center">
      ${room.host === me ? html`<button class="primary" @click=${() => act({ type: "rematch" })}>🔁 ${t("pkRematch")}</button>` : nothing}
      <button @click=${() => (location.hash = "#/penalty")}>${t("back")}</button>
    </div>
  </div>`;
}

// ---------- solo against the computer (#/penalty/solo) ----------
// The same reducer runs locally; the computer's inputs are random, worse at higher levels.
const CPU = "cpu";
const CPU_GREEN = [0.8, 0.72, 0.64, 0.56, 0.5]; // chance the computer stops a bar in the green
const rand = (a, b) => a + Math.random() * (b - a);
function cpuInput(role, level) {
  const [lo, hi] = logic.green(level);
  const b = Math.random() < CPU_GREEN[level - 1] ? rand(lo, hi) : rand(0.3, 1);
  const side = () => (Math.random() < 0.5 ? rand(0.05, 0.28) : rand(0.72, 0.95));
  const v =
    role === "taker"
      ? { x: Math.random() < 0.7 ? side() : rand(0.3, 0.7), y: rand(0.08, 0.85), b }
      : { x: Math.random() < 0.75 ? side() : rand(0.4, 0.6), y: rand(0.12, 0.7), b };
  for (const k of ["x", "y", "b"]) v[k] = Math.round(v[k] * 1000) / 1000;
  return v;
}

let solo = null; // the local room
let cpuSecret = null; // {id, v, s}
const soloName = (key) => (key === CPU ? "🤖 " + t("computer") : state.me.name);
function soloDo(a, who) {
  const next = logic.reduce(structuredClone(solo), a, who, Date.now());
  if (next) solo = next;
}
// After every change: the computer commits its input, then both reveal once both have committed.
function soloStep() {
  if (solo?.status !== "playing" || !solo.cur) return;
  const n = logic.kicks(solo).length;
  const id = `solo/${solo.startedAt}/${n}`;
  const c = solo.cur.commit || {};
  if (!c[CPU]) {
    const { taker } = logic.roles(solo, n);
    const v = cpuInput(taker === CPU ? "taker" : "keeper", logic.levelOf(n));
    const s = Math.random().toString(36).slice(2);
    cpuSecret = { id, v, s };
    soloDo({ type: "commit", h: logic.sealOf(v, s) }, CPU);
  }
  if (Object.keys(solo.cur?.commit || {}).length === 2 || Date.now() >= (solo.cur?.deadline || 0)) {
    const me = state.me.key;
    const mine = loadPending()[id];
    if (mine && solo.cur?.commit?.[me] && !solo.cur.reveal?.[me]) soloDo({ type: "reveal", v: mine.v, s: mine.s }, me);
    if (solo.cur && cpuSecret?.id === id && !solo.cur.reveal?.[CPU]) soloDo({ type: "reveal", v: cpuSecret.v, s: cpuSecret.s }, CPU);
  }
}
function newSolo() {
  const me = state.me.key;
  solo = { code: "solo", host: me, status: "lobby", players: { [me]: { name: state.me.name, t: 0 }, [CPU]: { name: t("computer"), t: 1 } } };
  soloDo({ type: "start" }, me);
  inp = null;
  soloStep();
  rerender();
}

export const lobbyExtra = () =>
  admins.canPlay?.(state.me.key) === false
    ? nothing
    : html`<div class="card solo-card">
        <div>
          <b>🤖 ${t("pkSoloTitle")}</b>
          <p class="hint">${t("pkSoloHint")}</p>
        </div>
        <button class="primary" @click=${() => (location.hash = "#/penalty/solo")}>${t("soloPlay")}</button>
      </div>`;

function soloView() {
  const back = html`<a href="#/penalty" class="back">${t("back")}</a>`;
  if (!solo) return back;
  const now = Date.now();
  const submit = (h) => {
    soloDo({ type: "commit", h }, state.me.key);
    soloStep();
  };
  const done = solo.status === "ended" && now - (logic.kicks(solo).at(-1)?.t || 0) >= logic.ANIM_MS;
  const g = logic.goals(solo);
  const [a, b] = logic.order(solo);
  return html`${back}
    ${playView(solo, state.me.key, now, soloName, submit)}
    ${done
      ? html`<div class="card center">
          <h2>${t("gameOver")}</h2>
          <p class="big">${solo.result.winner === CPU ? "🤖 " + t("pkCpuWins") : "🏆 " + t("pkYouWin")}</p>
          <p>${soloName(a)} <b>${g[a]}–${g[b]}</b> ${soloName(b)}</p>
          <button class="primary" @click=${newSolo}>🔁 ${t("pkNewGame")}</button>
        </div>`
      : nothing}`;
}

export const pages = {
  solo: {
    play: true, // a game, not an info page (admin-only accounts can't open it)
    enter() {
      newSolo();
      const timer = setInterval(() => {
        if (solo?.status === "playing" && solo.cur && Date.now() >= solo.cur.deadline) {
          soloStep();
          soloDo({ type: "tick" }, state.me.key);
          soloStep();
        }
        rerender();
      }, 250);
      return [() => clearInterval(timer)];
    },
    view: soloView,
  },
};
