// Game rules for Team Trivia as a pure reducer (same contract as the footballer game).
export const MAX_PLAYERS = 12;
export const QUESTIONS = 20;
export const EXTRA_QUESTIONS = 6; // for sudden death on a tie
export const ANSWER_MS = 120 * 1000;
export const STEAL_MS = 30 * 1000;
export const COIN_MS = 3500;
export const REVEAL_MS = 5000;

export const other = (team) => (team === "A" ? "B" : "A");
export const members = (room, team) =>
  Object.entries(room.players || {})
    .filter(([, p]) => p.team === team)
    .sort((a, b) => a[1].t - b[1].t)
    .map(([k]) => k);
// Team that answers question idx first: the coin winner, then alternating.
export const firstTeam = (room, idx) => (idx % 2 === 0 ? room.coin : other(room.coin));
export const activeTeam = (room) => (room.phase === "steal" ? other(room.turn) : room.turn);

function fixCaptains(room) {
  room.captains = room.captains || {};
  for (const team of ["A", "B"]) {
    const m = members(room, team);
    if (!m.includes(room.captains[team])) room.captains[team] = m[0] || null;
  }
}

function startQuestion(room, idx, now) {
  room.idx = idx;
  room.turn = firstTeam(room, idx);
  room.phase = "answer";
  room.deadline = now + ANSWER_MS;
  room.suggest = null;
  room.wrongChoice = null;
  room.last = null;
  return room;
}

function reveal(room, now, last) {
  room.phase = "reveal";
  room.deadline = now + REVEAL_MS;
  room.last = last;
  room.suggest = null;
  if (last.team) room.scores[last.team] = (room.scores[last.team] || 0) + 1;
  return room;
}

function next(room, now) {
  const done = room.idx + 1;
  const { A, B } = room.scores;
  if ((done >= QUESTIONS && A !== B) || done >= room.questions.length) return finish(room, now);
  return startQuestion(room, done, now);
}

function finish(room, now) {
  room.status = "ended";
  room.endedAt = now;
  const { A = 0, B = 0 } = room.scores;
  const winner = A === B ? null : A > B ? "A" : "B";
  const points = {};
  for (const [k, p] of Object.entries(room.players)) {
    const score = room.scores[p.team] || 0;
    points[k] = score * 10 + (winner === null ? 25 : winner === p.team ? 50 : 0);
  }
  room.result = { winner, points };
  return room;
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
      fixCaptains(room);
      return room;
    case "beCaptain":
      if (!lobby || !myTeam) return undefined;
      room.captains = { ...(room.captains || {}), [myTeam]: me };
      return room;
    case "setCats":
      if (!lobby || !isHost) return undefined;
      room.cats = a.cats;
      return room;
    case "begin": {
      if (!lobby || !isHost) return undefined;
      if (members(room, "A").length < 2 || members(room, "B").length < 2) return undefined;
      if (Object.values(room.players).some((p) => !p.team)) return undefined;
      if (!a.questions || a.questions.length < QUESTIONS) return undefined;
      fixCaptains(room);
      room.questions = a.questions;
      room.status = "playing";
      room.coin = Math.random() < 0.5 ? "A" : "B";
      room.phase = "coin";
      room.deadline = now + COIN_MS;
      room.scores = { A: 0, B: 0 };
      room.idx = 0;
      return room;
    }
    case "suggest":
      if (!playing || !["answer", "steal"].includes(room.phase) || myTeam !== activeTeam(room)) return undefined;
      room.suggest = { ...(room.suggest || {}), [me]: a.choice };
      return room;
    case "answer": {
      if (!playing || !["answer", "steal"].includes(room.phase)) return undefined;
      const team = activeTeam(room);
      if (room.captains[team] !== me) return undefined;
      if (room.phase === "steal" && a.choice === room.wrongChoice) return undefined;
      const correct = a.choice === room.questions[room.idx].correct;
      if (correct) return reveal(room, now, { team, choice: a.choice, stolen: room.phase === "steal" });
      if (room.phase === "answer") {
        room.phase = "steal";
        room.wrongChoice = a.choice;
        room.deadline = now + STEAL_MS;
        room.suggest = null;
        return room;
      }
      return reveal(room, now, { team: null, choice: a.choice });
    }
    case "tick":
      if (!playing || now < room.deadline) return undefined;
      if (room.phase === "coin") return startQuestion(room, 0, now);
      if (room.phase === "answer") {
        room.phase = "steal";
        room.deadline = now + STEAL_MS;
        room.suggest = null;
        return room;
      }
      if (room.phase === "steal") return reveal(room, now, { team: null });
      if (room.phase === "reveal") return next(room, now);
      return undefined;
    default:
      return undefined;
  }
}
