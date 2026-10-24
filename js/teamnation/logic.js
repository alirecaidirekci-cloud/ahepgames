// Game rules for Team & Nation Guess: two players each pick a club or a nation (at least one club),
// then race to say a footballer who fits both picks. A game admin (third person) awards the point.
// First to WIN_SCORE wins. A club or nation can be picked only once per game.
import { arr } from "../db.js";

export const MAX_PLAYERS = 6;
export const WIN_SCORE = 3;
export const GUESS_MS = 60 * 1000;
export const RESULT_MS = 4000;
export const WIN_POINTS = 100;

export const contestants = (room) =>
  Object.entries(room.roles || {})
    .filter(([, r]) => r === "player")
    .map(([k]) => k)
    .sort((a, b) => (room.players[a]?.t || 0) - (room.players[b]?.t || 0));
export const adminOf = (room) => Object.entries(room.roles || {}).find(([, r]) => r === "admin")?.[0] || null;
export const other = (room, key) => contestants(room).find((k) => k !== key);
// Who picks first in round n (1-based): the coin winner, then alternating.
export const firstPicker = (room, n) => (n % 2 === 1 ? room.coin : other(room, room.coin));
// Who has to pick next in the current round, or null when both have picked.
export function nextPicker(room) {
  const picks = arr(room.round?.picks);
  if (picks.length >= 2) return null;
  const first = firstPicker(room, room.round.n);
  return picks.length === 0 ? first : other(room, first);
}

function newRound(room, n, now) {
  room.round = { n, phase: "pick", picks: [] };
  room.deadline = null;
  return room;
}

function endRound(room, now, winner, reason, answer) {
  const round = room.round;
  room.log = [...arr(room.log), { n: round.n, picks: arr(round.picks), winner: winner || null, reason, answer: answer || null }];
  if (winner) room.scores[winner] = (room.scores[winner] || 0) + 1;
  room.round = { ...round, phase: "result", winner: winner || null, reason, answer: answer || null };
  room.deadline = now + RESULT_MS;
  if (winner && room.scores[winner] >= WIN_SCORE) {
    room.status = "ended";
    room.endedAt = now;
    room.result = { winner, points: Object.fromEntries(contestants(room).map((k) => [k, k === winner ? WIN_POINTS : 0])) };
  }
  return room;
}

export function reduce(room, a, me, now) {
  if (!room) return undefined;
  const isHost = room.host === me;
  const lobby = room.status === "lobby";
  const playing = room.status === "playing";
  const isAdmin = adminOf(room) === me;
  switch (a.type) {
    case "setRole": {
      if (!lobby || !isHost || !room.players?.[a.key] || !["admin", "player", null].includes(a.role)) return undefined;
      const roles = { ...(room.roles || {}) };
      if (a.role === "admin") for (const k of Object.keys(roles)) if (roles[k] === "admin") delete roles[k];
      if (a.role === "player" && contestants({ ...room, roles }).length >= 2 && roles[a.key] !== "player") return undefined;
      if (a.role) roles[a.key] = a.role;
      else delete roles[a.key];
      room.roles = roles;
      return room;
    }
    case "start": {
      if (!lobby || !isHost) return undefined;
      // Players who left the room lose their role.
      for (const k of Object.keys(room.roles || {})) if (!room.players[k]) delete room.roles[k];
      const ps = contestants(room);
      if (ps.length !== 2 || !adminOf(room)) return undefined;
      room.status = "playing";
      room.coin = ps[Math.random() < 0.5 ? 0 : 1];
      room.scores = { [ps[0]]: 0, [ps[1]]: 0 };
      room.used = {};
      room.log = [];
      return newRound(room, 1, now);
    }
    case "pick": {
      if (!playing || room.round.phase !== "pick" || nextPicker(room) !== me) return undefined;
      if (!["club", "nation"].includes(a.kind) || !a.id || room.used?.[a.id]) return undefined;
      const picks = arr(room.round.picks);
      if (picks.length === 1 && picks[0].kind === "nation" && a.kind === "nation") return undefined; // at least one club
      room.round.picks = [...picks, { by: me, kind: a.kind, id: a.id }];
      room.used = { ...(room.used || {}), [a.id]: true };
      if (room.round.picks.length === 2) {
        room.round.phase = "guess";
        room.deadline = now + GUESS_MS;
      }
      return room;
    }
    case "award":
      if (!playing || room.round.phase !== "guess" || !isAdmin || !contestants(room).includes(a.key)) return undefined;
      return endRound(room, now, a.key, "correct", a.answer);
    case "noValid":
      if (!playing || room.round.phase !== "guess" || !isAdmin) return undefined;
      return endRound(room, now, null, "novalid");
    case "tick":
      if (!playing || !room.deadline || now < room.deadline) return undefined;
      if (room.round.phase === "guess") return endRound(room, now, null, "timeout");
      if (room.round.phase === "result") return newRound(room, room.round.n + 1, now);
      return undefined;
    default:
      return undefined;
  }
}
