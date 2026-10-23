// Game rules for "Guess the Footballer" as a pure reducer: reduce(room, action, me, now) -> new room
// or undefined when the action is not allowed. Runs inside a database transaction.
import { arr } from "../db.js";
import { questionById } from "./data.js";

export const FOOTBALLER_COUNT = 500; // size of data/players.json
export const MAX_PLAYERS = 6;
export const TOTAL_QUESTIONS = 10;
export const TOTAL_GUESSES = 6;
export const ROUND_MS = 10 * 60 * 1000;

// Even split; the remainder is shared and needs everyone's agreement.
export function quota(total, guessers) {
  const base = Math.floor(total / guessers);
  return { base, shared: total - base * guessers };
}

export function usage(room, me) {
  const log = arr(room.log);
  const n = arr(room.guessers).length || 1;
  const q = quota(TOTAL_QUESTIONS, n);
  const g = quota(TOTAL_GUESSES, n);
  const mine = (kind) => log.filter((e) => e.kind === kind && e.by === me && !e.shared).length;
  const shared = (kind) => log.filter((e) => e.kind === kind && e.shared).length;
  return {
    myQ: q.base - mine("q"),
    myG: g.base - mine("g"),
    sharedQ: q.shared - shared("q"),
    sharedG: g.shared - shared("g"),
    usedQ: log.filter((e) => e.kind === "q").length,
    usedG: log.filter((e) => e.kind === "g").length,
  };
}

export function pot(room, endTime) {
  const log = arr(room.log);
  const q = log.filter((e) => e.kind === "q").length;
  const w = log.filter((e) => e.kind === "g" && !e.ok).length;
  const m = Math.floor((endTime - room.startedAt) / 60000);
  return { pot: Math.max(100, 1000 - 50 * q - 50 * w - 30 * m), q, w, m };
}

export const PICKER_WIN_POINTS = 500;

function finish(room, now, winner, reason) {
  room.status = "ended";
  room.endedAt = now;
  room.proposal = null;
  const guessers = arr(room.guessers);
  const points = {};
  if (winner) {
    const { pot: total } = pot(room, now);
    const others = guessers.filter((g) => g !== winner);
    points[winner] = Math.round(total * 0.7);
    for (const o of others) points[o] = Math.round((total * 0.3) / others.length);
    points[room.picker] = 0;
  } else {
    points[room.picker] = PICKER_WIN_POINTS;
    for (const g of guessers) points[g] = 0;
  }
  room.result = { winner: winner || room.picker, pickerWon: !winner, reason, points };
  return room;
}

function doAsk(room, me, qid, shared, now, data) {
  const q = questionById(qid);
  if (!q || arr(room.log).some((e) => e.kind === "q" && e.qid === qid)) return undefined;
  room.log = [...arr(room.log), { kind: "q", by: me, qid, ans: q.test(data.playerById(room.secret)), shared, t: now }];
  return room;
}

function doGuess(room, me, pid, shared, now) {
  const ok = pid === room.secret;
  room.log = [...arr(room.log), { kind: "g", by: me, pid, ok, shared, t: now }];
  if (ok) return finish(room, now, me, "guessed");
  if (usage(room, me).usedG >= TOTAL_GUESSES) return finish(room, now, null, "outOfGuesses");
  return room;
}

export function reduce(room, a, me, now, data) {
  if (!room) return undefined;
  const isHost = room.host === me;
  const guessers = arr(room.guessers);
  const playing = room.status === "playing";
  const isGuesser = guessers.includes(me);
  switch (a.type) {
    case "setPicker":
      if (!isHost || room.status !== "lobby" || !room.players?.[a.key]) return undefined;
      room.picker = a.key;
      return room;
    case "start": {
      const keys = Object.entries(room.players || {}).sort((x, y) => x[1].t - y[1].t).map(([k]) => k);
      if (!isHost || room.status !== "lobby" || keys.length < 2) return undefined;
      if (!keys.includes(room.picker)) room.picker = room.host;
      room.guessers = keys.filter((k) => k !== room.picker);
      room.status = "picking";
      room.log = [];
      return room;
    }
    case "pick":
      if (room.status !== "picking" || room.picker !== me || !data.playerById(a.pid)) return undefined;
      room.secret = a.pid;
      room.status = "playing";
      room.startedAt = now;
      room.deadline = now + ROUND_MS;
      return room;
    case "ask": {
      if (!playing || !isGuesser || usage(room, me).myQ <= 0) return undefined;
      return doAsk(room, me, a.qid, false, now, data);
    }
    case "guess": {
      if (!playing || !isGuesser || usage(room, me).myG <= 0) return undefined;
      if (arr(room.log).some((e) => e.kind === "g" && e.pid === a.pid)) return undefined;
      return doGuess(room, me, a.pid, false, now);
    }
    case "propose": {
      const u = usage(room, me);
      if (!playing || !isGuesser || room.proposal) return undefined;
      if (a.kind === "q" && (u.myQ > 0 || u.sharedQ <= 0)) return undefined;
      if (a.kind === "g" && (u.myG > 0 || u.sharedG <= 0)) return undefined;
      room.proposal = { kind: a.kind, by: me, value: a.value, votes: { [me]: true }, t: now };
      return room;
    }
    case "vote": {
      const p = room.proposal;
      if (!playing || !p || !isGuesser) return undefined;
      if (!a.yes) {
        room.proposal = null;
        return room;
      }
      p.votes = { ...(p.votes || {}), [me]: true };
      if (!guessers.every((g) => p.votes[g])) return room;
      room.proposal = null;
      return p.kind === "q" ? doAsk(room, p.by, p.value, true, now, data) : doGuess(room, p.by, p.value, true, now);
    }
    case "cancelProposal":
      if (!room.proposal || room.proposal.by !== me) return undefined;
      room.proposal = null;
      return room;
    case "tick":
      if (playing && now >= room.deadline) return finish(room, now, null, "timeout");
      return undefined;
    default:
      return undefined;
  }
}
