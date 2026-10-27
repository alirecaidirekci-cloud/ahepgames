// Hidden players (admins.js ALIASES) see everyone else as "player2", "player3"…
// Only what their screen shows is masked: game code that saves data (scores, medals, tournament
// teams) keeps working with the real data, so masked names never reach the database.
// Numbers follow sign-up order, so the same person keeps the same number between visits.
import { state } from "./app.js";
// Namespace import with fallback: a browser with an older cached admins.js keeps working.
import * as admins from "./admins.js";

export const masking = () => !!admins.ALIASES?.[state.me?.key];

let numbers = {}; // key -> "playerN"
export function setUsers(raw) {
  const aliases = admins.ALIASES || {};
  const others = Object.entries(raw || {})
    .filter(([k]) => k !== state.me?.key && !aliases[k])
    .sort((a, b) => (a[1].createdAt || Infinity) - (b[1].createdAt || Infinity) || a[0].localeCompare(b[0]));
  numbers = {};
  // player1 is taken by the first hidden player; the others start at player2
  others.forEach(([k], i) => (numbers[k] = `player${i + 2}`));
}

// The name to show for <key> (falls back to the next free number for people not in users/).
export function shownName(key, name) {
  if (!masking() || !key || key === state.me?.key) return name;
  if (admins.ALIASES?.[key]) return admins.ALIASES[key];
  numbers[key] ??= `player${Object.keys(numbers).length + 2}`;
  return numbers[key];
}

const clone = (v) => (v ? structuredClone(v) : v);
const renameIn = (obj, field = "name") => {
  for (const [k, v] of Object.entries(obj || {})) if (v && typeof v === "object" && field in v) v[field] = shownName(k, v[field]);
};

export function maskUsers(users) {
  setUsers(users);
  if (!masking()) return users;
  const u = clone(users) || {};
  renameIn(u);
  return u;
}

export function maskRoom(room) {
  if (!masking() || !room) return room;
  const r = clone(room);
  renameIn(r.players);
  renameIn(r.spectators);
  for (const m of Object.values(r.chat || {})) if (m) m.n = shownName(m.k, m.n);
  return r;
}

export function maskScores(scores) {
  if (!masking() || !scores) return scores;
  const s = clone(scores);
  for (const [k, games] of Object.entries(s)) for (const g of Object.values(games || {})) if (g && "name" in g) g.name = shownName(k, g.name);
  return s;
}

export function maskMedals(medals) {
  if (!masking() || !medals) return medals;
  const m = clone(medals);
  renameIn(m);
  return m;
}

export function maskTournaments(all) {
  if (!masking() || !all) return all;
  const ts = clone(all);
  for (const tour of Object.values(ts)) {
    if (!tour) continue;
    tour.organizerName = shownName(tour.organizer, tour.organizerName);
    for (const team of Object.values(tour.teams || {})) renameIn(team?.members);
  }
  return ts;
}

export function maskInvite(inv) {
  if (!masking() || !inv || String(inv.fromName || "").startsWith("🏆")) return inv;
  return { ...inv, fromName: shownName(inv.from, inv.fromName) };
}
