// Knockout tournaments for the quiz games (Team Trivia and Academic Quiz).
//
// tournaments/<id> = {
//   id, title, game, organizer, organizerName, startAt, maxTeams, cats (trivia), createdAt,
//   status: "registration" | "running" | "finished" | "cancelled",
//   teams: { <teamId>: { name, captain, status: "pending"|"approved"|"rejected", subjects (academic),
//                        members: { <user>: { name, confirmed } } } },
//   rounds: [ [ { a, b, winner, walkover, room, openedAt, score } ] ],   // filled at the start
//   champion, runnerUp, bronze: [teamIds], medalsGiven
// }
// medals/<user> = { name, gold, silver, bronze }
//
// There is no server: every open browser runs advance() every few seconds. All changes go
// through transactions with guards, so it doesn't matter which browser does a step.
import { db, arr } from "../db.js";
import { shuffle } from "../lib.js";
// Namespace import with fallback: a browser with an older cached admins.js keeps working.
import * as admins from "../admins.js";
const publicName = (me) => admins.publicName?.(me) ?? me.name;

export const QUIZ_GAMES = ["trivia", "academic"];
export const MIN_TEAM = 2;
export const MAX_TEAM = 4;
export const ROUND_QUESTIONS = 10;
export const FINAL_QUESTIONS = 20;
export const AUTO_START_MS = 3 * 60 * 1000; // start with ≥2 per team after 3 minutes
export const NOSHOW_MS = 10 * 60 * 1000; // a team with <2 players after 10 minutes loses
export const MEDAL_KINDS = ["gold", "silver", "bronze"];

const ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newId = (n = 5) => Array.from({ length: n }, () => ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]).join("");
export const tPath = (id) => `tournaments/${id}`;
export const matchCode = (tid, r, i) => `${tid}${r + 1}${String.fromCharCode(65 + i)}`;

export const confirmedMembers = (team) =>
  Object.entries(team?.members || {})
    .filter(([, m]) => m.confirmed)
    .map(([k]) => k);
export const teamPlays = (team) => team?.status === "approved" && confirmedMembers(team).length >= MIN_TEAM;
export const teamOf = (t, userKey) => Object.entries(t.teams || {}).find(([, tm]) => tm.status !== "rejected" && tm.members?.[userKey])?.[0];
export const activeTeams = (t) => Object.values(t.teams || {}).filter((tm) => tm.status !== "rejected").length;

// ---------- organizer & teams ----------

export async function createTournament(me, f) {
  for (let i = 0; i < 5; i++) {
    const id = newId();
    const r = await db.tx(tPath(id), (cur) =>
      cur
        ? undefined
        : {
            id, title: f.title, game: f.game, organizer: me.key, organizerName: publicName(me), startAt: f.startAt,
            maxTeams: f.maxTeams, cats: f.game === "trivia" ? f.cats : null, createdAt: db.now(), status: "registration",
          }
    );
    if (r.committed) return id;
  }
  throw new Error("could not create tournament");
}

// Returns "ok", "closed", "full" or "taken" (someone is already in another team).
export async function registerTeam(tid, me, { name, members, subjects }) {
  let result = "closed";
  await db.tx(tPath(tid), (t) => {
    if (!t || t.status !== "registration" || db.now() >= t.startAt) return undefined;
    if (activeTeams(t) >= t.maxTeams) return ((result = "full"), undefined);
    if ([me.key, ...members.map((m) => m.key)].some((k) => teamOf(t, k))) return ((result = "taken"), undefined);
    const team = {
      name: name.trim().slice(0, 20), captain: me.key, status: "pending", createdAt: db.now(),
      subjects: t.game === "academic" ? subjects : null,
      members: { [me.key]: { name: publicName(me), confirmed: true } },
    };
    for (const m of members) team.members[m.key] = { name: m.name, confirmed: false };
    t.teams = { ...(t.teams || {}), [newId(6)]: team };
    result = "ok";
    return t;
  });
  return result;
}

const editTeam = (tid, teamId, fn) =>
  db.tx(tPath(tid), (t) => {
    const team = t?.teams?.[teamId];
    if (!team || t.status !== "registration") return undefined;
    return fn(t, team) === false ? undefined : t;
  });

// A teammate accepts or declines their spot.
export const answerTeamInvite = (tid, teamId, me, yes) =>
  editTeam(tid, teamId, (t, team) => {
    if (!team.members?.[me.key]) return false;
    if (yes) team.members[me.key].confirmed = true;
    else delete team.members[me.key];
  });

export const renameTeam = (tid, teamId, me, name) =>
  editTeam(tid, teamId, (t, team) => {
    if (team.captain !== me.key || !name.trim()) return false;
    team.name = name.trim().slice(0, 20);
  });

// Organizer: approve / reject; captain or organizer: withdraw (delete) the team.
export const setTeamStatus = (tid, teamId, me, status) =>
  editTeam(tid, teamId, (t, team) => {
    if (t.organizer !== me.key) return false;
    team.status = status;
  });

export const withdrawTeam = (tid, teamId, me) =>
  editTeam(tid, teamId, (t, team) => {
    if (t.organizer !== me.key && team.captain !== me.key) return false;
    delete t.teams[teamId];
  });

export const deleteTournament = (tid, me) => db.tx(tPath(tid), (t) => (t && t.organizer === me.key ? null : undefined));

// ---------- running the tournament ----------

// Round 1 with byes: with n teams and a bracket of size 2^k, (2^k - n) teams get a free pass.
function firstRound(teamIds) {
  let size = 1;
  while (size < teamIds.length) size *= 2;
  const ids = shuffle(teamIds);
  const byes = size - ids.length;
  const round = [];
  for (let i = 0; i < size / 2; i++) round.push(i < byes ? { a: ids.pop(), winner: null, bye: true } : { a: ids.pop(), b: ids.pop() });
  for (const m of round) if (m.bye) m.winner = m.a;
  return shuffle(round);
}

export const roundName = (t, r) => {
  const n = arr(t.rounds?.[r]).length;
  return n === 1 ? "final" : n === 2 ? "semi" : n === 4 ? "quarter" : "round";
};

function matchRoom(t, r, i, m) {
  const teamA = t.teams[m.a];
  const teamB = t.teams[m.b];
  const now = db.now();
  const isFinal = arr(t.rounds[r]).length === 1;
  return {
    code: matchCode(t.id, r, i), host: teamA.captain, status: "lobby", createdAt: now, updatedAt: now,
    roster: { A: confirmedMembers(teamA), B: confirmedMembers(teamB) },
    rosterNames: Object.fromEntries([...Object.entries(teamA.members), ...Object.entries(teamB.members)].map(([k, v]) => [k, v.name])),
    captains: { A: teamA.captain, B: teamB.captain },
    teamNames: { A: teamA.name, B: teamB.name },
    tournament: { id: t.id, title: t.title, round: r, idx: i, final: isFinal },
    qCount: isFinal ? FINAL_QUESTIONS : ROUND_QUESTIONS,
    cats: t.game === "trivia" ? t.cats : null,
    subjects: t.game === "academic" ? { A: arr(teamA.subjects), B: arr(teamB.subjects) } : null,
  };
}

const present = (room, team) => Object.values(room?.players || {}).filter((p) => p.team === team).length;

async function giveMedals(t) {
  const r = await db.tx(`${tPath(t.id)}/medalsGiven`, (v) => (v ? undefined : true));
  if (!r.committed) return;
  const award = async (teamId, kind) => {
    for (const k of confirmedMembers(t.teams[teamId])) {
      const name = t.teams[teamId].members[k].name;
      await db.tx(`medals/${k}`, (cur) => ({ ...(cur || {}), name, [kind]: (cur?.[kind] || 0) + 1 }));
    }
  };
  if (t.champion) await award(t.champion, "gold");
  if (t.runnerUp) await award(t.runnerUp, "silver");
  for (const b of arr(t.bronze)) await award(b, "bronze");
}

// One step of the tournament; safe to call from any browser at any time.
export async function advance(tid) {
  const now = db.now();
  let t = await db.get(tPath(tid));
  if (!t) return;

  // 1. Start time: build the bracket from approved teams.
  if (t.status === "registration" && now >= t.startAt) {
    await db.tx(tPath(tid), (cur) => {
      if (!cur || cur.status !== "registration") return undefined;
      const ids = Object.entries(cur.teams || {}).filter(([, tm]) => teamPlays(tm)).map(([id]) => id);
      if (ids.length < 2) {
        cur.status = "cancelled";
        cur.cancelReason = "notEnoughTeams";
        return cur;
      }
      for (const [, tm] of Object.entries(cur.teams)) if (tm.status === "pending") tm.status = "rejected";
      cur.rounds = [firstRound(ids)];
      cur.status = "running";
      return cur;
    });
    t = await db.get(tPath(tid));
  }
  if (t?.status !== "running") return;

  const r = arr(t.rounds).length - 1;
  const round = arr(t.rounds[r]);
  for (let i = 0; i < round.length; i++) {
    const m = round[i];
    if (m.winner) continue;
    const code = matchCode(tid, r, i);
    const roomPath = `rooms/${t.game}/${code}`;
    if (!m.room) {
      // 2. Open the match room and invite both teams.
      const made = await db.tx(roomPath, (cur) => (cur ? undefined : matchRoom(t, r, i, m)));
      await db.tx(`${tPath(tid)}/rounds/${r}/${i}`, (cur) => (cur && !cur.room ? { ...cur, room: code, openedAt: now } : undefined));
      if (made.committed) {
        const room = made.value;
        for (const k of [...room.roster.A, ...room.roster.B]) {
          db.update(`users/${k}`, { invite: { from: t.organizer, fromName: "🏆 " + t.title, game: t.game, code, t: now } });
        }
      }
      continue;
    }
    const room = await db.get(roomPath);
    let winner = null;
    let walkover = false;
    if (room?.status === "ended") {
      // 3. Finished match: A/B result -> team id (a draw is decided by a coin flip).
      const w = room.result?.winner || (Math.random() < 0.5 ? "A" : "B");
      winner = w === "A" ? m.a : m.b;
    } else if ((!room || room.status === "lobby") && now - (m.openedAt || now) > NOSHOW_MS) {
      // 4. No-show: a team with fewer than 2 players after 10 minutes loses.
      const pa = present(room, "A");
      const pb = present(room, "B");
      if (pa >= MIN_TEAM && pb >= MIN_TEAM) continue; // both are there: the match will start
      winner = pa > pb ? m.a : pb > pa ? m.b : Math.random() < 0.5 ? m.a : m.b;
      walkover = true;
      if (room) db.set(roomPath, null);
    }
    if (winner) {
      await db.tx(`${tPath(tid)}/rounds/${r}/${i}`, (cur) =>
        cur && !cur.winner ? { ...cur, winner, walkover, score: room?.scores || null } : undefined
      );
    }
  }

  // 5. Round complete: next round, or the end with medals.
  t = await db.get(tPath(tid));
  const last = arr(t.rounds[arr(t.rounds).length - 1]);
  if (!last.every((m) => m.winner)) return;
  await db.tx(tPath(tid), (cur) => {
    if (!cur || cur.status !== "running" || arr(cur.rounds).length !== arr(t.rounds).length) return undefined;
    const rounds = arr(cur.rounds);
    const lastRound = arr(rounds[rounds.length - 1]);
    if (lastRound.length === 1) {
      const fin = lastRound[0];
      cur.status = "finished";
      cur.finishedAt = db.now();
      cur.champion = fin.winner;
      cur.runnerUp = fin.a === fin.winner ? fin.b : fin.a;
      const semis = rounds.length >= 2 ? arr(rounds[rounds.length - 2]) : [];
      cur.bronze = semis.filter((m) => m.b).map((m) => (m.a === m.winner ? m.b : m.a));
      return cur;
    }
    const next = [];
    for (let i = 0; i < lastRound.length; i += 2) next.push({ a: lastRound[i].winner, b: lastRound[i + 1].winner });
    cur.rounds = [...rounds, next];
    return cur;
  });
  t = await db.get(tPath(tid));
  if (t?.status === "finished") await giveMedals(t);
}

// Called regularly by every open browser: moves along tournaments that are due or running.
let running = false;
export async function runDue() {
  if (running) return;
  running = true;
  try {
    const all = await db.get("tournaments").catch(() => null);
    const now = db.now();
    for (const t of Object.values(all || {})) {
      if ((t.status === "registration" && now >= t.startAt) || t.status === "running") await advance(t.id);
    }
  } finally {
    running = false;
  }
}
