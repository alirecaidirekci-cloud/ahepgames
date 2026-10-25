// Usernames (lowercase) that can hide reported questions and delete added questions
// on the Academic Quiz question bank page.
export const ADMINS = ["puhuman"];

export const isAdmin = (me) => !!me && ADMINS.includes(me.key);

// Usernames that never appear in other players' "Online now" list (they still see themselves).
export const HIDDEN_ONLINE = ["puhuman"];

// Admin-only accounts that never play: no rooms (not even watching), no solo games, no tournament
// teams, and not shown on the leaderboard or medal table.
export const NO_PLAY = ["puhuman"];
export const canPlay = (key) => !NO_PLAY.includes(key);
