// Usernames (lowercase) that can hide reported questions and delete added questions
// on the Academic Quiz question bank page.
export const ADMINS = ["puhuman"];

export const isAdmin = (me) => !!me && ADMINS.includes(me.key);

// Players who play normally but stay hidden: not in "Online now", the leaderboard, the medal table or
// the tournament teammate list, and shown to others under this alias in rooms, chat, invites,
// tournament teams and the question bank (they still see their own name in the header).
export const ALIASES = { bengu: "player1" };
export const publicName = (me) => ALIASES[me?.key] || me?.name;

// Usernames that never appear in other players' "Online now" list (they still see themselves).
export const HIDDEN_ONLINE = ["puhuman", ...Object.keys(ALIASES)];

// Admin-only accounts that never play: no rooms (not even watching), no solo games, no tournament
// teams, and not shown on the leaderboard or medal table.
export const NO_PLAY = ["puhuman"];
export const canPlay = (key) => !NO_PLAY.includes(key);

// Shown on the leaderboard and the medal table.
export const onBoards = (key) => canPlay(key) && !(key in ALIASES);
