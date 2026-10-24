// Large footballer pool for Team & Nation Guess (data/pool.json, built by scripts/build_pool.py):
// thousands of players with nationalities and clubs, ordered from most to least famous.
import { getLang } from "../i18n.js";

let POOL = null;

export async function loadPool() {
  if (!POOL) {
    const raw = await (await fetch("data/pool.json")).json();
    const players = raw.players.map(([name, nats, clubs]) => ({ name, nats, clubs }));
    const count = {};
    for (const p of players) for (const id of [...p.clubs, ...p.nats]) count[id] = (count[id] || 0) + 1;
    POOL = { players, clubs: raw.clubs, countries: raw.countries, count };
  }
  return POOL;
}

export const clubName = (id) => POOL.clubs[id] || id;
export const countryName = (id) => POOL.countries[id]?.[getLang()] || POOL.countries[id]?.en || id;
export const clubIds = () => Object.keys(POOL.clubs);
export const countryIds = () => Object.keys(POOL.countries);
// How many pool players have played for a club / are from a country (used to sort the pick lists).
export const popularity = (id) => POOL.count[id] || 0;

// Players who fit both picks, most famous first.
export function matches(picks) {
  return POOL.players.filter((pl) => picks.every((p) => (p.kind === "club" ? pl.clubs.includes(p.id) : pl.nats.includes(p.id))));
}
