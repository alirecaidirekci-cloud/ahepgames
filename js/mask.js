// Players with "sees everyone hidden" (seesMasked, set on the admin console) see everyone else as
// random "playerN" names (people with an alias are shown by their alias).
// Only what their screen shows is masked: game code that saves data (scores, medals, tournament
// teams) keeps working with the real data, so masked names never reach the database.
// The numbers are random and new at every login / new visit (new tab or window); within one visit
// (also after a refresh) the same person keeps the same number. Kept in sessionStorage.
import { state } from "./app.js";
// Namespace import with fallback: a browser with an older cached admins.js keeps working.
import * as admins from "./admins.js";

export const masking = () => !!admins.seesMasked?.(state.me?.key);
const aliasOf = (key) => admins.aliasOf?.(key) || null;
const MAX = 99;
const STORE = "fg-mask-names";

let numbers = null; // key -> "playerN" for this visit
let owner = null; // whose numbers they are
function load() {
  if (numbers && owner === state.me?.key) return;
  owner = state.me?.key;
  numbers = {};
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE) || "null");
    if (saved?.me === owner) numbers = saved.numbers || {};
  } catch {}
}
function save() {
  try {
    sessionStorage.setItem(STORE, JSON.stringify({ me: owner, numbers }));
  } catch {}
}
// A new login starts with fresh random numbers.
export function resetMaskNames() {
  numbers = {};
  owner = state.me?.key;
  save();
}

const aliasesInUse = () => new Set(Object.values(admins.allPlayerSettings?.() || {}).map((s) => s?.alias).filter(Boolean));
function freshNumber() {
  const used = new Set([...aliasesInUse(), ...Object.values(numbers)]);
  const free = [];
  for (let n = 1; n <= MAX; n++) if (!used.has(`player${n}`)) free.push(`player${n}`);
  return free[Math.floor(Math.random() * free.length)] || `player${MAX + Object.keys(numbers).length + 1}`;
}

export function setUsers() {} // (numbers are handed out when a name is first shown)

// The name to show for <key>.
export function shownName(key, name) {
  if (!masking() || !key || key === state.me?.key) return name;
  if (aliasOf(key)) return aliasOf(key);
  load();
  let n = numbers[key];
  if (!n || aliasesInUse().has(n)) {
    // first time this visit, or a hidden player's new alias took this number: pick another
    n = numbers[key] = freshNumber();
    save();
  }
  return n;
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
