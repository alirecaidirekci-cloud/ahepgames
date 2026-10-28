// Usernames (lowercase) that can hide reported questions and delete added questions
// on the Academic Quiz question bank page, approve sign-ups and use the admin console (#/admin).
export const ADMINS = ["puhuman"];

export const isAdmin = (me) => !!me && ADMINS.includes(me.key);

// Admin-only accounts that never play: no rooms (not even watching), no solo games, no tournament
// teams, never in "Online now", and not shown on the leaderboard or medal table.
export const NO_PLAY = ["puhuman"];
export const canPlay = (key) => !NO_PLAY.includes(key);

// ---------- per-player settings (set by the admin on the console, #/admin) ----------
// Stored in settings/players/<key>; app.js loads them before anything is shown:
//   hidden     – not in "Online now", the leaderboard, the medal table or the tournament teammate list
//   alias      – "player1", "player2"…: the name others see in rooms, chat, invites, tournaments
//   seesMasked – sees everyone else as player2, player3… (mask.js)
//   noMeet     – doesn't see "Meet the Players" or "Ben geldim"
//   noWelcome  – no mascot welcome screen after logging in
let PS = {};
export const setPlayerSettings = (v) => (PS = v || {});
export const allPlayerSettings = () => PS;
export const playerSettings = (key) => PS[key] || {};

export const aliasOf = (key) => PS[key]?.alias || null;
export const publicName = (me) => aliasOf(me?.key) || me?.name;
export const isHiddenOnline = (key) => NO_PLAY.includes(key) || !!PS[key]?.hidden;
export const onBoards = (key) => canPlay(key) && !PS[key]?.hidden;
export const seesMasked = (key) => !!PS[key]?.seesMasked;
export const seesMeet = (key) => !PS[key]?.noMeet;
export const showsWelcome = (key) => !PS[key]?.noWelcome;

// A random free "playerN" (1–99) for <key>: used when the admin switches an alias on, and again at
// every login / new visit of that player (app.js), so the same person isn't always "player1".
export const ALIAS_MAX = 99;
export function randomAlias(key) {
  const used = new Set(Object.entries(PS).filter(([k, s]) => k !== key && s?.alias).map(([, s]) => s.alias));
  const free = [];
  const current = PS[key]?.alias; // never the same as last time
  for (let n = 1; n <= ALIAS_MAX; n++) if (!used.has(`player${n}`) && `player${n}` !== current) free.push(`player${n}`);
  return free[Math.floor(Math.random() * free.length)] || `player${ALIAS_MAX + 1 + Object.keys(PS).length}`;
}
export const nextAlias = () => randomAlias(null); // kept for older callers
