// Game rules for the YÖKAK Quiz (multiplayer: 1v1 or team vs team; solo is played locally).
// Both sides see the same question at the same time. Each side (a player in 1v1, a team in team
// mode) has one try per question: any member may answer for the team. The first correct answer
// wins the point; a wrong answer locks that side out of the question. No timer, no leaderboard.
import { arr } from "../db.js";

export const MAX_PLAYERS = 8;
export const QUESTIONS = 10;
export const MAX_TEAM = 4;
export const OPTIONS = 4;
const TEAM_NAME_MAX = 20;

export const members = (room, team) =>
  Object.entries(room.players || {})
    .filter(([, p]) => p.team === team)
    .sort((a, b) => a[1].t - b[1].t)
    .map(([k]) => k);

// 1v1: one player per side. Team mode: 2-4 players per side.
export function sizesOk(room) {
  const a = members(room, "A").length;
  const b = members(room, "B").length;
  if (Object.values(room.players || {}).some((p) => !p.team)) return false;
  return (a === 1 && b === 1) || (a >= 2 && b >= 2 && a <= MAX_TEAM && b <= MAX_TEAM);
}
export const isDuel = (room) => members(room, "A").length === 1 && members(room, "B").length === 1;

function finish(room, now) {
  const { A = 0, B = 0 } = room.scores || {};
  room.status = "ended";
  room.endedAt = now;
  room.result = { winner: A > B ? "A" : B > A ? "B" : null };
  return room;
}

export function reduce(room, a, me, now) {
  if (!room) return undefined;
  const myTeam = room.players?.[me]?.team;
  const lobby = room.status === "lobby";
  const playing = room.status === "playing";
  switch (a.type) {
    case "setTeam":
      if (!lobby || !room.players?.[me] || !["A", "B"].includes(a.team)) return undefined;
      if (myTeam !== a.team && members(room, a.team).length >= MAX_TEAM) return undefined;
      room.players[me].team = a.team;
      return room;
    case "setTeamName": {
      if (!lobby || !myTeam) return undefined;
      const name = String(a.name || "").trim().slice(0, TEAM_NAME_MAX);
      room.teamNames = { ...(room.teamNames || {}), [myTeam]: name || null };
      return room;
    }
    case "setRole":
      // the role the questions are picked for (view.js ROLES; "" = mixed, all questions)
      if (!lobby || room.host !== me || typeof a.role !== "string" || a.role.length > 1) return undefined;
      room.role = a.role || null;
      return room;
    case "begin": {
      // a.questions: [{id, o: option order, c: index of the right answer in that order}]
      if (!lobby || room.host !== me || !sizesOk(room)) return undefined;
      const qs = arr(a.questions);
      if (qs.length !== QUESTIONS || qs.some((q) => !q?.id || arr(q.o).length !== OPTIONS || !(q.c >= 0 && q.c < OPTIONS))) return undefined;
      room.questions = qs;
      room.status = "playing";
      room.phase = "question";
      room.idx = 0;
      room.scores = { A: 0, B: 0 };
      room.tries = null;
      room.last = null;
      room.history = null;
      return room;
    }
    case "answer": {
      if (!playing || room.phase !== "question" || !myTeam) return undefined;
      if (!(a.choice >= 0 && a.choice < OPTIONS)) return undefined;
      const tries = arr(room.tries);
      if (tries.some((x) => x.team === myTeam)) return undefined;
      const right = a.choice === room.questions[room.idx].c;
      room.tries = [...tries, { team: myTeam, k: me, c: a.choice, t: now }];
      if (right) {
        room.scores = { ...room.scores, [myTeam]: (room.scores?.[myTeam] || 0) + 1 };
        room.last = { team: myTeam, k: me };
      } else if (room.tries.length < 2) {
        return room; // the other side may still answer
      } else {
        room.last = { team: null };
      }
      room.phase = "reveal";
      room.history = [...arr(room.history), { team: room.last.team || "-", k: room.last.k || "-" }];
      return room;
    }
    case "next":
      if (!playing || room.phase !== "reveal" || !myTeam) return undefined;
      if (room.idx + 1 >= room.questions.length) return finish(room, now);
      room.idx++;
      room.phase = "question";
      room.tries = null;
      room.last = null;
      return room;
    case "rematch":
      // Back to the lobby with the same players and teams; the host starts again with new questions.
      if (room.status !== "ended" || room.host !== me) return undefined;
      room.status = "lobby";
      for (const k of ["questions", "phase", "idx", "scores", "tries", "last", "history", "result", "endedAt"]) room[k] = null;
      return room;
    default:
      return undefined;
  }
}
