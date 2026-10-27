// Shared helpers: templating (lit-html), rooms, scores, formatting.
export { html, render, nothing } from "https://cdn.jsdelivr.net/npm/lit-html@3.1.4/lit-html.js";
import { db, arr } from "./db.js";
import { getLang } from "./i18n.js";
// Namespace import with fallback: a browser with an older cached admins.js keeps working.
import * as admins from "./admins.js";
const publicName = (me) => admins.publicName?.(me) ?? me.name;

export { arr };

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// Rooms are deleted automatically when they are finished or abandoned.
const ROOM_MAX_AGE = 6 * 3600 * 1000; // any room
const ROOM_IDLE_MS = 45 * 60 * 1000; // no action for 45 minutes
const ENDED_KEEP_MS = 3 * 60 * 1000; // results stay visible for 3 minutes

export function isStaleRoom(r, now) {
  if (!r || typeof r !== "object") return true;
  if (now - (r.createdAt || 0) > ROOM_MAX_AGE) return true;
  if (now - (r.updatedAt || r.createdAt || 0) > ROOM_IDLE_MS) return true;
  return r.status === "ended" && now - (r.endedAt || r.updatedAt || 0) > ENDED_KEEP_MS;
}

export const closeRoom = (game, code) => db.set(`rooms/${game}/${code}`, null);

// Deletes stale rooms of the given games (run when someone opens the home page).
export async function cleanupRooms(games) {
  const now = db.now();
  for (const game of games) {
    const rooms = await db.get(`rooms/${game}`).catch(() => null);
    for (const [code, r] of Object.entries(rooms || {})) if (isStaleRoom(r, now)) closeRoom(game, code);
  }
}

export const nameKey = (name) => name.trim().toLowerCase();
export const validName = (name) => /^[\p{L}\p{N}_]{3,16}$/u.test(name.trim());

export function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

export const fmtNum = (n) => n.toLocaleString(getLang() === "tr" ? "tr-TR" : "en-US");

export function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Players of a room sorted by join time: [{key, name, ...}]
export const roomPlayers = (room) =>
  Object.entries(room?.players || {})
    .map(([key, p]) => ({ key, ...p }))
    .sort((a, b) => a.t - b.t);

export async function createRoom(game, me, extra = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
    const now = db.now();
    const r = await db.tx(`rooms/${game}/${code}`, (cur) =>
      cur ? undefined : { code, host: me.key, status: "lobby", createdAt: now, updatedAt: now, players: { [me.key]: { name: publicName(me), t: now } }, ...extra }
    );
    if (r.committed) return code;
  }
  throw new Error("could not create room");
}

// Returns "ok", "notfound" or "full".
export async function joinRoom(game, code, me, maxPlayers, extraFields = {}) {
  let result = "notfound";
  await db.tx(`rooms/${game}/${code}`, (room) => {
    if (!room) return undefined;
    if (room.players?.[me.key]) {
      result = "ok";
      return undefined;
    }
    if (room.status !== "lobby") return undefined;
    if (Object.keys(room.players || {}).length >= maxPlayers) {
      result = "full";
      return undefined;
    }
    // Tournament match: only the two registered teams can play, each in their own team.
    if (room.roster) {
      const team = ["A", "B"].find((tm) => arr(room.roster[tm]).includes(me.key));
      if (!team) {
        result = "full";
        return undefined;
      }
      extraFields = { ...extraFields, team };
    }
    result = "ok";
    room.players = { ...(room.players || {}), [me.key]: { name: publicName(me), t: db.now(), ...extraFields } };
    if (room.spectators) delete room.spectators[me.key];
    room.updatedAt = db.now();
    return room;
  });
  return result;
}

// Watch a room without playing (allowed at any time). Returns "ok" or "notfound".
export async function spectateRoom(game, code, me) {
  let result = "notfound";
  await db.tx(`rooms/${game}/${code}`, (room) => {
    if (!room) return undefined;
    result = "ok";
    if (room.players?.[me.key] || room.spectators?.[me.key]) return undefined;
    room.spectators = { ...(room.spectators || {}), [me.key]: { name: publicName(me), t: db.now() } };
    return room;
  });
  return result;
}

export const isSpectator = (room, key) => !room?.players?.[key];

export async function leaveRoom(game, code, me) {
  await db.tx(`rooms/${game}/${code}`, (room) => {
    if (!room) return undefined;
    if (room.spectators?.[me.key]) {
      delete room.spectators[me.key];
      return room;
    }
    if (room.status === "playing") return undefined; // games in progress keep their players
    delete room.players?.[me.key];
    const left = roomPlayers(room);
    if (!left.length) return null; // last player gone: the room is deleted
    room.updatedAt = db.now();
    if (room.host === me.key) room.host = left[0].key;
    return room;
  });
}

// Live list of rooms that are waiting or being played; also deletes stale rooms.
export function watchRooms(game, cb) {
  return db.on(`rooms/${game}`, (rooms) => {
    const now = db.now();
    const list = [];
    for (const [code, r] of Object.entries(rooms || {})) {
      if (isStaleRoom(r, now)) {
        closeRoom(game, code);
        continue;
      }
      if (r.status === "lobby" || r.status === "playing") list.push(r);
    }
    cb(list.sort((a, b) => b.createdAt - a.createdAt));
  });
}

// Adds points once per finished room. awards: {key: {name, pts, win}}
export async function awardOnce(game, code, awards) {
  const r = await db.tx(`rooms/${game}/${code}/scored`, (v) => (v ? undefined : true));
  if (!r.committed) return;
  await Promise.all(
    Object.entries(awards).map(([key, a]) =>
      db.tx(`scores/${key}/${game}`, (cur) => ({
        name: a.name,
        points: (cur?.points || 0) + a.pts,
        played: (cur?.played || 0) + 1,
        wins: (cur?.wins || 0) + (a.win ? 1 : 0),
      }))
    )
  );
}
