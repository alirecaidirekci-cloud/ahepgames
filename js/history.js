// Each player's last finished game, for the "Meet the Players" cards.
// When a room reaches "ended", every player's own browser saves their summary in
// users/<me>/lastGame = {game, t, result: "win"|"loss"|"draw"|"judge", score, vs}.
// Only finished multiplayer games count (rooms are deleted afterwards, so this is the only record).
import { state } from "./app.js";
import { db } from "./db.js";

const names = (room, keys) => keys.map((k) => room.players?.[k]?.name || k).join(", ");
const outcome = (won, draw) => (draw ? "draw" : won ? "win" : "loss");

function teamGame(room, me) {
  const mine = room.players[me]?.team;
  if (!mine) return null;
  const other = mine === "A" ? "B" : "A";
  const winner = room.result?.winner ?? null;
  const vs = Object.keys(room.players).filter((k) => room.players[k].team === other);
  return { result: outcome(winner === mine, winner === null), score: `${room.scores?.[mine] || 0}–${room.scores?.[other] || 0}`, vs: names(room, vs) };
}

const SUMMARY = {
  trivia: teamGame,
  academic: teamGame,
  yokak: teamGame,
  auction(room, me) {
    const opp = Object.keys(room.players).find((k) => k !== me);
    const won = room.result?.won || {};
    const winner = room.result?.winner ?? null;
    return { result: outcome(winner === me, winner === null), score: `${won[me] || 0}–${won[opp] || 0}`, vs: names(room, [opp]) };
  },
  teamnation(room, me) {
    const players = Object.keys(room.scores || {});
    if (!players.includes(me)) return { result: "judge", score: "", vs: names(room, players) };
    const opp = players.find((k) => k !== me);
    return { result: outcome(room.result?.winner === me, false), score: `${room.scores[me] || 0}–${room.scores[opp] || 0}`, vs: names(room, [opp]) };
  },
  footballer(room, me) {
    const guessers = Object.keys(room.players).filter((k) => k !== room.picker);
    if (me === room.picker) return { result: outcome(!!room.result?.pickerWon, false), score: "", vs: names(room, guessers) };
    return { result: outcome(room.result?.winner === me, false), score: "", vs: names(room, [room.picker]) };
  },
};

const saved = new Set();
export function recordLastGame(game, room) {
  const me = state.me?.key;
  if (!room || room.status !== "ended" || !room.result || !room.players?.[me] || !SUMMARY[game]) return;
  const id = `${game}/${room.code}/${room.endedAt}`;
  if (saved.has(id)) return;
  saved.add(id);
  const s = SUMMARY[game](room, me);
  if (s) db.update(`users/${me}`, { lastGame: { game, t: room.endedAt || db.now(), ...s } });
}
