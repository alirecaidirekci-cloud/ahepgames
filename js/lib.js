// Shared helpers: templating (lit-html), rooms, scores, formatting.
export { html, render, nothing } from "https://cdn.jsdelivr.net/npm/lit-html@3.1.4/lit-html.js";
import { db, arr } from "./db.js";
import { getLang } from "./i18n.js";

export { arr };

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_MAX_AGE = 6 * 3600 * 1000;

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
      cur ? undefined : { code, host: me.key, status: "lobby", createdAt: now, players: { [me.key]: { name: me.name, t: now } }, ...extra }
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
    result = "ok";
    room.players = { ...(room.players || {}), [me.key]: { name: me.name, t: db.now(), ...extraFields } };
    return room;
  });
  return result;
}

export async function leaveRoom(game, code, me) {
  await db.tx(`rooms/${game}/${code}`, (room) => {
    if (!room) return undefined;
    if (room.status !== "lobby") return undefined; // games in progress keep their players
    delete room.players?.[me.key];
    const left = roomPlayers(room);
    if (!left.length) return null;
    if (room.host === me.key) room.host = left[0].key;
    return room;
  });
}

// Live list of lobby rooms for a game; also deletes stale rooms.
export function watchRooms(game, cb) {
  return db.on(`rooms/${game}`, (rooms) => {
    const now = db.now();
    const list = [];
    for (const [code, r] of Object.entries(rooms || {})) {
      if (!r || now - (r.createdAt || 0) > ROOM_MAX_AGE) {
        db.set(`rooms/${game}/${code}`, null);
        continue;
      }
      if (r.status === "lobby") list.push(r);
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
