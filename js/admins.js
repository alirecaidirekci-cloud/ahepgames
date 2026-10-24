// Usernames (lowercase) that can hide reported questions and delete added questions
// on the Academic Quiz question bank page.
export const ADMINS = ["puhuman"];

export const isAdmin = (me) => !!me && ADMINS.includes(me.key);
