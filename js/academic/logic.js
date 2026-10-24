// Game rules for the Academic Quiz. Turns, steals, difficulty points and sudden death are the
// same as Team Trivia; the differences are:
//  - each team picks its own subjects (at least 3) and is asked questions from them on its turn
//  - there is no captain: the team's answer is decided by majority vote
import { arr } from "../db.js";
import * as trivia from "../trivia/logic.js";

export const MAX_PLAYERS = 12;
export const QUESTIONS = trivia.QUESTIONS;
export const PER_TEAM = (trivia.QUESTIONS + trivia.EXTRA_QUESTIONS) / 2;
export const MIN_SUBJECTS = 3;
export const OPTIONS = 4;
export const { members, activeTeam, questionPoints, firstTeam } = trivia;

// Current votes of the answering team and the decision they lead to.
// The answer is locked once an option has more than half of the team's votes or everyone has voted.
// On a tie, the option that reached the winning count first wins.
export function tally(room) {
  const voters = members(room, activeTeam(room));
  const current = {};
  const counts = Array(OPTIONS).fill(0);
  const reachedAt = Array.from({ length: OPTIONS }, () => ({}));
  for (const v of arr(room.votes).sort((a, b) => a.t - b.t)) {
    if (!voters.includes(v.k)) continue;
    if (current[v.k] !== undefined) counts[current[v.k]]--;
    current[v.k] = v.c;
    counts[v.c]++;
    reachedAt[v.c][counts[v.c]] ??= v.t;
  }
  const max = Math.max(...counts);
  const choice = max === 0 ? null : counts.map((n, c) => c).filter((c) => counts[c] === max).sort((a, b) => reachedAt[a][max] - reachedAt[b][max])[0];
  const voted = Object.keys(current).length;
  return { counts, current, choice, voted, total: voters.length, decided: max > voters.length / 2 || voted === voters.length };
}

export function reduce(room, a, me, now) {
  if (!room) return undefined;
  const isHost = room.host === me;
  const myTeam = room.players?.[me]?.team;
  const lobby = room.status === "lobby";
  const playing = room.status === "playing";
  switch (a.type) {
    case "setTeam":
      if (!lobby || !room.players?.[me] || !["A", "B"].includes(a.team)) return undefined;
      room.players[me].team = a.team;
      return room;
    case "toggleSubject": {
      if (!lobby || !myTeam) return undefined;
      const list = arr(room.subjects?.[myTeam]);
      room.subjects = { ...(room.subjects || {}), [myTeam]: list.includes(a.subject) ? list.filter((s) => s !== a.subject) : [...list, a.subject] };
      return room;
    }
    case "begin": {
      if (!lobby || !isHost) return undefined;
      if (members(room, "A").length < 2 || members(room, "B").length < 2) return undefined;
      if (Object.values(room.players).some((p) => !p.team)) return undefined;
      if (["A", "B"].some((t) => arr(room.subjects?.[t]).length < MIN_SUBJECTS)) return undefined;
      if (["A", "B"].some((t) => arr(a.queues?.[t]).length < QUESTIONS / 2)) return undefined;
      room.coin = Math.random() < 0.5 ? "A" : "B";
      // Question idx goes to the team whose turn it is, from that team's own queue.
      const len = Math.min(arr(a.queues.A).length, arr(a.queues.B).length) * 2;
      room.questions = Array.from({ length: len }, (_, i) => a.queues[firstTeam(room, i)][Math.floor(i / 2)]);
      room.status = "playing";
      room.phase = "coin";
      room.deadline = now + trivia.COIN_MS;
      room.scores = { A: 0, B: 0 };
      room.idx = 0;
      return room;
    }
    case "vote": {
      if (!playing || !["answer", "steal"].includes(room.phase) || myTeam !== activeTeam(room)) return undefined;
      if (!(a.choice >= 0 && a.choice < OPTIONS) || (room.phase === "steal" && a.choice === room.wrongChoice)) return undefined;
      room.votes = [...arr(room.votes), { k: me, c: a.choice, t: now }];
      const result = tally(room);
      return result.decided ? trivia.submitAnswer(room, result.choice, now) : room;
    }
    case "tick":
      if (!playing || now < room.deadline) return undefined;
      if (room.phase === "answer" || room.phase === "steal") return trivia.submitAnswer(room, tally(room).choice, now);
      return trivia.reduce(room, a, me, now);
    default:
      return undefined;
  }
}
