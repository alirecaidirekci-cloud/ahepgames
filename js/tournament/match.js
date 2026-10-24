// Pieces shared by the quiz games for tournament matches (and team names in general).
import { state, act } from "../app.js";
import { db } from "../db.js";
import { t } from "../i18n.js";
import { html, nothing, arr, fmtTime } from "../lib.js";
import * as L from "./logic.js";

// A team's name: the tournament / custom name, or "Team Blue" / "Team Red".
export const teamLabel = (room, team) => room?.teamNames?.[team] || t(team === "A" ? "teamA" : "teamB");

// Inline "rename your team" field for members of that team in a normal (non-tournament) lobby.
export function renameField(room, team) {
  if (room.tournament || room.players?.[state.me.key]?.team !== team) return nothing;
  const save = (e) => {
    e.preventDefault();
    act({ type: "setTeamName", name: new FormData(e.target).get("tn") });
  };
  return html`<form class="row rename-team" @submit=${save}>
    <input name="tn" maxlength="20" placeholder=${t("teamNamePh")} .value=${room.teamNames?.[team] || ""} />
    <button class="small">✏️ ${t("rename")}</button>
  </form>`;
}

const sortedPlayers = (room) => Object.entries(room.players || {}).sort((a, b) => a[1].t - b[1].t);
const present = (room, team) => sortedPlayers(room).filter(([, p]) => p.team === team).length;

// Tournament matches start by themselves: when everyone is in, or after 3 minutes if both teams
// have at least 2 players. The earliest present player's browser loads the questions and starts.
let starting = null;
export function autoStart(room, startFn) {
  if (!room?.tournament || room.status !== "lobby" || starting === room.code) return;
  const pa = present(room, "A");
  const pb = present(room, "B");
  if (pa < L.MIN_TEAM || pb < L.MIN_TEAM) return;
  const everyone = pa === arr(room.roster?.A).length && pb === arr(room.roster?.B).length;
  if (!everyone && db.now() - room.createdAt < L.AUTO_START_MS) return;
  if (sortedPlayers(room)[0]?.[0] !== state.me.key) return;
  starting = room.code;
  (async () => {
    try {
      if (await act({ type: "claimStart" })) await startFn();
    } finally {
      setTimeout(() => (starting = null), 5000);
    }
  })();
}

export function tournamentLobby(room) {
  const me = state.me.key;
  const now = db.now();
  const startIn = room.createdAt + L.AUTO_START_MS - now;
  const noShowIn = room.createdAt + L.NOSHOW_MS - now;
  let status;
  if (room.starter) status = t("tStarting");
  else if (present(room, "A") >= L.MIN_TEAM && present(room, "B") >= L.MIN_TEAM) status = t("tStartsWhen", { time: fmtTime(Math.max(0, startIn)) });
  else status = t("tWaitingMin", { n: L.MIN_TEAM, time: fmtTime(Math.max(0, noShowIn)) });
  return html`<div class="card t-match">
    <p class="big center">🏆 ${room.tournament.title} · ${t(room.tournament.final ? "round_final" : "tMatch")}</p>
    <p class="hint center">${t("tMatchRules", { q: room.qCount })}</p>
    <div class="teams">
      ${["A", "B"].map(
        (team) => html`<div class="card team team-${team}">
          <h3>${teamLabel(room, team)}</h3>
          <ul class="players">
            ${arr(room.roster?.[team]).map(
              (k) => html`<li>${room.players?.[k] ? "✅" : "⏳"} ${room.rosterNames?.[k] || k}${k === me ? ` (${t("you")})` : ""}${room.captains?.[team] === k ? " ©️" : ""}</li>`
            )}
          </ul>
        </div>`
      )}
    </div>
    <p class="big center">${status}</p>
    <p class="center"><a href="#/tournaments/${room.tournament.id}">🗂️ ${t("bracket")}</a></p>
  </div>`;
}

// End-of-game link: back to the tournament bracket instead of the room list.
export const backLink = (room, game) =>
  room.tournament
    ? html`<a class="button primary" href="#/tournaments/${room.tournament.id}">🏆 ${t("backToTournament")}</a>`
    : html`<a class="button primary" href="#/${game}">${t("playAgain")}</a>`;
