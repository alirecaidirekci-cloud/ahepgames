// Game rules for Transfer Auction: two players, €20 each, five positions in order.
// For each position one footballer is shown and a second one stays hidden. Players bid on the shown
// one in an open auction (whole euros, at least €1, the timer restarts on every bid). The highest
// bidder pays and gets the shown footballer; the other player gets the hidden one for free.
// Each auction opens with an automatic €1 bid by the opener (alternating per position).
// If only one player has money left, they get the shown footballer for €1.
// When the transfer window closes, everyone in the room (both players and all spectators) votes, per
// position, whose footballer is better. A position goes to the side with more votes (equal = nobody);
// the side with more positions wins. Votes can be changed until the vote closes: after VOTE_MS, or
// as soon as everyone in the room has voted for all five positions. No leaderboard points.
export const MAX_PLAYERS = 2;
export const VOTE_MS = 90 * 1000;
export const BUDGET = 20;
export const BID_MS = 10 * 1000;
export const REVEAL_MS = 6000;
export const COIN_MS = 3000;
export const POSITIONS = ["GK", "DF", "MF", "W", "ST"];

export const bidders = (room) =>
  Object.entries(room.players || {})
    .sort((a, b) => a[1].t - b[1].t)
    .map(([k]) => k);
export const opponent = (room, key) => bidders(room).find((k) => k !== key);
// Opener of position i: the coin winner, then alternating.
export const openerOf = (room, i) => (i % 2 === 0 ? room.coin : opponent(room, room.coin));

function assign(room, now, winner, price) {
  const pos = POSITIONS[room.idx];
  const [shown, hidden] = room.pairs[pos];
  const loser = opponent(room, winner);
  room.squads = room.squads || {}; // the database drops the empty object set at start
  room.budgets[winner] -= price;
  room.squads[winner] = { ...(room.squads[winner] || {}), [pos]: { id: shown, price } };
  room.squads[loser] = { ...(room.squads[loser] || {}), [pos]: { id: hidden, price: 0 } };
  room.phase = "reveal";
  room.last = { winner, price, pos };
  room.deadline = now + REVEAL_MS;
  return room;
}

function startPosition(room, idx, now) {
  room.idx = idx;
  room.bid = null;
  const opener = openerOf(room, idx);
  const rival = opponent(room, opener);
  const canBid = (k) => room.budgets[k] >= 1;
  if (canBid(opener) && canBid(rival)) {
    room.phase = "bid";
    room.bid = { by: opener, amount: 1 };
    room.deadline = now + BID_MS;
    return room;
  }
  if (canBid(opener) || canBid(rival)) return assign(room, now, canBid(opener) ? opener : rival, 1);
  // Nobody has money left: a coin flip decides who gets the shown footballer, for free.
  return assign(room, now, Math.random() < 0.5 ? opener : rival, 0);
}

// Everyone who may vote: both players and the spectators currently in the room.
export const voters = (room) => [...bidders(room), ...Object.keys(room.spectators || {})];

// Per position: votes for each side and the side that won it (null on a tie).
export function tally(room) {
  const [a, b] = bidders(room);
  const positions = {};
  const won = { [a]: 0, [b]: 0 };
  for (const pos of POSITIONS) {
    const counts = { [a]: 0, [b]: 0 };
    for (const v of Object.values(room.votes || {})) if (v?.[pos] === a || v?.[pos] === b) counts[v[pos]]++;
    const winner = counts[a] > counts[b] ? a : counts[b] > counts[a] ? b : null;
    if (winner) won[winner]++;
    positions[pos] = { counts, winner };
  }
  return { positions, won, winner: won[a] > won[b] ? a : won[b] > won[a] ? b : null };
}

function closeVote(room, now) {
  room.result = tally(room);
  room.status = "ended";
  room.phase = null;
  room.endedAt = now;
  return room;
}

const validPairs = (pairs) => pairs && POSITIONS.every((p) => pairs[p] && pairs[p].length === 2);

function begin(room, pairs, now) {
  const ks = bidders(room);
  room.pairs = pairs;
  room.status = "playing";
  room.coin = ks[Math.random() < 0.5 ? 0 : 1];
  room.budgets = { [ks[0]]: BUDGET, [ks[1]]: BUDGET };
  room.squads = {};
  room.phase = "coin";
  room.idx = 0;
  room.bid = null;
  room.last = null;
  room.endedAt = null;
  room.votes = null;
  room.result = null;
  room.deadline = now + COIN_MS;
  return room;
}

export function reduce(room, a, me, now) {
  if (!room) return undefined;
  const playing = room.status === "playing";
  switch (a.type) {
    case "start": {
      if (room.status !== "lobby" || room.host !== me || bidders(room).length !== 2 || !validPairs(a.pairs)) return undefined;
      return begin(room, a.pairs, now);
    }
    case "replay": {
      // Either player can start a new auction in the same room with new footballers.
      // If the other player has left, the room goes back to the lobby to wait for a new opponent.
      if (room.status !== "ended" || !room.players?.[me]) return undefined;
      if (bidders(room).length === 2 && validPairs(a.pairs)) return begin(room, a.pairs, now);
      room.status = "lobby";
      room.host = me;
      for (const k of ["pairs", "coin", "budgets", "squads", "phase", "idx", "bid", "last", "deadline", "endedAt", "votes", "result"]) room[k] = null;
      return room;
    }
    case "raise": {
      if (!playing || room.phase !== "bid" || !room.players?.[me] || room.bid?.by === me) return undefined;
      const amount = Math.floor(a.amount);
      if (!(amount > (room.bid?.amount || 0)) || amount > room.budgets[me]) return undefined;
      room.bid = { by: me, amount };
      room.deadline = now + BID_MS;
      return room;
    }
    case "vote": {
      // a.pos: position, a.side: the player whose footballer is better
      if (!playing || room.phase !== "vote" || !voters(room).includes(me)) return undefined;
      if (!POSITIONS.includes(a.pos) || !bidders(room).includes(a.side)) return undefined;
      room.votes = { ...(room.votes || {}), [me]: { ...(room.votes?.[me] || {}), [a.pos]: a.side } };
      const done = (k) => POSITIONS.every((pos) => room.votes[k]?.[pos]);
      return voters(room).every(done) ? closeVote(room, now) : room;
    }
    case "tick":
      if (!playing || now < room.deadline) return undefined;
      if (room.phase === "coin") return startPosition(room, 0, now);
      if (room.phase === "bid") return assign(room, now, room.bid.by, room.bid.amount);
      if (room.phase === "reveal") {
        if (room.idx + 1 < POSITIONS.length) return startPosition(room, room.idx + 1, now);
        room.phase = "vote";
        room.deadline = now + VOTE_MS;
        return room;
      }
      if (room.phase === "vote") return closeVote(room, now);
      return undefined;
    default:
      return undefined;
  }
}
