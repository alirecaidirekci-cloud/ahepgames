// Game rules for the Penalty Shootout (1v1 rooms; solo against the computer uses the same reducer
// locally). 5 kicks each, then sudden death; every kick is one level harder (faster markers and bars,
// smaller green zones), sudden death stays at level 5. No leaderboard points.
//
// Each kick: the taker sets an aim point and stops a power bar, the keeper sets a dive point and
// stops a reach bar, both at the same time. Inputs are sealed so nobody (not even a spectator
// reading the database) can see the other side's choice early: first a hash of the input + a secret
// salt is saved ("commit"), and only when both sides have committed do the browsers send the
// input itself ("reveal"), which must match the hash.
import { arr } from "../db.js";

export const MAX_PLAYERS = 2;
export const KICKS = 5; // per side before sudden death
export const LEVELS = 5;
export const KICK_MS = 30 * 1000; // to aim and shoot / dive
export const ANIM_MS = 4200; // the previous kick's animation, before the next one can be taken

// Goal size in metres; inputs are 0..1 across the goal (x: left post → right post, y: ground → bar).
export const GOAL_W = 7.32;
export const GOAL_H = 2.44;
export const BALL_R = 0.11;
const GREEN_C = 0.72; // centre of the green zone on the power / reach bars
const REACH = 1.45; // keeper's reach (m) around the dive point with a perfect reach bar

// Per level (index 0 = level 1): one full back-and-forth of the aim marker and of the bars (ms),
// and half the width of the green zone on the bars.
export const AIM_MS = [3000, 2500, 2000, 1600, 1300];
export const BAR_MS = [2000, 1700, 1400, 1150, 950];
export const GREEN_HALF = [0.14, 0.12, 0.1, 0.08, 0.06];
export const green = (level) => [GREEN_C - GREEN_HALF[level - 1], GREEN_C + GREEN_HALF[level - 1]];

// Small synchronous string hash (cyrb53) for the sealed inputs.
export function hash(str) {
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
export const sealOf = (v, salt) => hash(JSON.stringify([v.x, v.y, v.b]) + "|" + salt);

const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));
const valid = (v) => v && [v.x, v.y, v.b].every((n) => typeof n === "number" && n >= 0 && n <= 1);

// The two players in kick order: order[0] takes kick 0, 2, 4…
export const order = (room) => arr(room.order);
export const kicks = (room) => arr(room.kicks);
export const levelOf = (n) => Math.min(LEVELS, Math.floor(n / 2) + 1);
export function roles(room, n = kicks(room).length) {
  const [a, b] = order(room);
  return n % 2 === 0 ? { taker: a, keeper: b } : { taker: b, keeper: a };
}
export function goals(room) {
  const g = { [order(room)[0]]: 0, [order(room)[1]]: 0 };
  for (const k of kicks(room)) if (k.out === "goal") g[k.taker]++;
  return g;
}

// How far outside the green zone a bar was stopped (0 = inside).
function offGreen(b, level) {
  const [lo, hi] = green(level);
  return b < lo ? lo - b : b > hi ? b - hi : 0;
}

// The kick's result from both inputs: where the ball goes, how far the keeper reaches, and "goal",
// "save" or "miss". Missing inputs (time ran out): no shot = miss, no dive = the keeper stays put.
export function resolve(shot, dive, level) {
  if (!shot) return { out: "miss", bx: 0.5, by: 1.6, kx: 0.5, ky: 0.35, reach: 0, late: true };
  let X = shot.x * GOAL_W;
  let Y = shot.y * GOAL_H;
  const e = offGreen(shot.b, level);
  let bonus = 0;
  if (e > 0 && shot.b > GREEN_C) {
    // too strong: rises and drifts away from the middle
    Y += e * 6;
    X += Math.sign(X - GOAL_W / 2 || 1) * e * 5;
  } else if (e > 0) {
    // too weak: slower, lower and towards the middle, easier to reach
    X += (GOAL_W / 2 - X) * Math.min(0.6, e * 2.5);
    Y = Math.max(0.1, Y - e * 3);
    bonus = e * 2;
  }
  const kx = dive ? dive.x : 0.5;
  const ky = dive ? dive.y : 0.35;
  const reach = dive ? REACH * Math.max(0.35, 1 - offGreen(dive.b, level) * 3) + bonus : 0.5 + bonus;
  const r = { bx: X / GOAL_W, by: Y / GOAL_H, kx, ky, reach };
  if (X < -BALL_R || X > GOAL_W + BALL_R || Y > GOAL_H + BALL_R) return { ...r, out: "miss" };
  const d = Math.hypot(X - kx * GOAL_W, Y - ky * GOAL_H);
  return { ...r, out: d <= reach + BALL_R ? "save" : "goal" };
}

// Is the shootout decided? After 5 each: someone can't catch up any more. Sudden death: after each
// pair of kicks, one side scored more.
function winnerOf(room) {
  const [a, b] = order(room);
  const n = kicks(room).length;
  const g = goals(room);
  const taken = (i) => Math.ceil((n - i) / 2); // kicks taken by order[i]
  if (n <= 2 * KICKS) {
    const left = (i) => Math.max(0, KICKS - taken(i));
    if (g[a] > g[b] + left(1)) return a;
    if (g[b] > g[a] + left(0)) return b;
    if (n < 2 * KICKS) return null;
  }
  if (n % 2 === 1) return null;
  return g[a] > g[b] ? a : g[b] > g[a] ? b : null;
}

function newKick(room, now) {
  room.cur = { deadline: now + (kicks(room).length ? ANIM_MS : 0) + KICK_MS };
}

function settle(room, now) {
  const n = kicks(room).length;
  const { taker, keeper } = roles(room, n);
  const rev = room.cur?.reveal || {};
  const level = levelOf(n);
  const res = resolve(rev[taker]?.v, rev[keeper]?.v, level);
  room.kicks = [...kicks(room), { taker, keeper, level, ...res, t: now }];
  const w = winnerOf(room);
  if (w) {
    room.status = "ended";
    room.endedAt = now;
    room.cur = null;
    room.result = { winner: w, goals: goals(room) };
  } else newKick(room, now);
  return room;
}

export function reduce(room, a, me, now) {
  if (!room) return undefined;
  const playing = room.status === "playing";
  const inGame = order(room).includes(me);
  switch (a.type) {
    case "start": {
      const keys = Object.entries(room.players || {}).sort((x, y) => x[1].t - y[1].t).map(([k]) => k);
      if (room.host !== me || room.status !== "lobby" || keys.length !== 2) return undefined;
      room.order = Math.random() < 0.5 ? keys : [keys[1], keys[0]]; // coin toss: who shoots first
      room.kicks = null;
      room.result = null;
      room.status = "playing";
      room.startedAt = now;
      newKick(room, now);
      return room;
    }
    case "commit": {
      if (!playing || !inGame || typeof a.h !== "string" || a.h.length > 20 || room.cur?.commit?.[me]) return undefined;
      room.cur = { ...room.cur, commit: { ...(room.cur?.commit || {}), [me]: a.h } };
      return room;
    }
    case "reveal": {
      const c = room.cur?.commit || {};
      if (!playing || !inGame || !c[me] || room.cur?.reveal?.[me]) return undefined;
      // only after both sides have committed (or the time is up), and it must match the seal
      if (Object.keys(c).length < 2 && now < room.cur.deadline) return undefined;
      const v = { x: clamp01(a.v?.x), y: clamp01(a.v?.y), b: clamp01(a.v?.b) };
      if (!valid(a.v) || sealOf(v, String(a.s)) !== c[me]) return undefined;
      room.cur = { ...room.cur, reveal: { ...(room.cur.reveal || {}), [me]: { v } } };
      return Object.keys(room.cur.reveal).length === 2 ? settle(room, now) : room;
    }
    case "tick": {
      // Time is up for this kick: whoever has not committed gets no input; a committed side that
      // has not revealed within 5 more seconds (left the page) counts as no input too.
      if (!playing || !room.cur || now < room.cur.deadline) return undefined;
      const c = room.cur.commit || {};
      const rev = room.cur.reveal || {};
      const waiting = Object.keys(c).some((k) => !rev[k]);
      if (waiting && now < room.cur.deadline + 5000) return undefined;
      return settle(room, now);
    }
    case "rematch":
      if (room.status !== "ended" || room.host !== me) return undefined;
      for (const k of ["order", "kicks", "cur", "result", "endedAt", "startedAt"]) room[k] = null;
      room.status = "lobby";
      return room;
    default:
      return undefined;
  }
}
