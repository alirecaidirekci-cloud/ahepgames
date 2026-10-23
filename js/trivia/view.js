// Screens for Team Trivia.
import { state, act, setUi, roomHeader } from "../app.js";
import { db } from "../db.js";
import { t, getLang } from "../i18n.js";
import { html, nothing, fmtTime, roomPlayers, awardOnce } from "../lib.js";
import * as logic from "./logic.js";
import { CATEGORIES, loadQuestions } from "./questions.js";

export const MAX_PLAYERS = logic.MAX_PLAYERS;
export const reduce = logic.reduce;
export const needsTick = (room, now) => room.status === "playing" && now >= room.deadline;
export const newRoomFields = () => ({ cats: [9, 21] });
export const info = () => ({ q: logic.QUESTIONS, cats: CATEGORIES.length, min: logic.ANSWER_MS / 60000, minTeam: 2 });

export function onRoom(room, code) {
  if (room?.status === "ended" && !room.scored) {
    const awards = {};
    for (const p of roomPlayers(room)) {
      awards[p.key] = { name: p.name, pts: room.result.points[p.key] || 0, win: room.result.winner === p.team };
    }
    awardOnce("trivia", code, awards);
  }
}

const teamName = (team) => t(team === "A" ? "teamA" : "teamB");
const catName = (id) => {
  const c = CATEGORIES.find((c) => c[0] === id);
  return c ? (getLang() === "tr" ? c[2] : c[1]) : id;
};

export function view() {
  const room = state.room;
  return html`${roomHeader("trivia")}
    ${room.status === "lobby" ? lobby() : room.status === "playing" ? playing() : ended()}`;
}

// ---------- lobby ----------

function lobby() {
  const room = state.room;
  const me = state.me.key;
  const isHost = room.host === me;
  const ps = roomPlayers(room);
  const cats = room.cats || [];
  const teamsOk = logic.members(room, "A").length >= 2 && logic.members(room, "B").length >= 2 && ps.every((p) => p.team);
  const begin = async () => {
    setUi({ loading: true, loadError: false });
    try {
      const questions = await loadQuestions(cats, logic.QUESTIONS + logic.EXTRA_QUESTIONS);
      if (questions.length < logic.QUESTIONS) throw new Error("not enough");
      await act({ type: "begin", questions });
      setUi({ loading: false });
    } catch {
      setUi({ loading: false, loadError: true });
    }
  };
  const toggleCat = (id) => act({ type: "setCats", cats: cats.includes(id) ? cats.filter((c) => c !== id) : [...cats, id] });
  const unassigned = ps.filter((p) => !p.team);
  return html`
    <div class="teams">
      ${["A", "B"].map((team) => {
        const m = ps.filter((p) => p.team === team);
        const mine = room.players[me]?.team === team;
        return html`<div class="card team team-${team}">
          <h3>${teamName(team)} (${m.length})</h3>
          <ul class="players">
            ${m.map(
              (p) => html`<li>
                ${p.name} ${p.key === me ? html`<small>(${t("you")})</small>` : nothing}
                ${room.captains?.[team] === p.key ? html`<span class="pill gold">©️ ${t("captain")}</span>` : nothing}
              </li>`
            )}
          </ul>
          ${mine
            ? room.captains?.[team] !== me
              ? html`<button class="small" @click=${() => act({ type: "beCaptain" })}>${t("beCaptain")}</button>`
              : nothing
            : html`<button @click=${() => act({ type: "setTeam", team })}>${t("joinTeam")}</button>`}
        </div>`;
      })}
    </div>
    ${unassigned.length ? html`<p class="hint">⏳ ${unassigned.map((p) => p.name).join(", ")}</p>` : nothing}
    <div class="card">
      <h3>${t("subjects")}</h3>
      <div class="chips">
        ${CATEGORIES.map(
          ([id]) => html`<button class=${cats.includes(id) ? "chip on" : "chip"} ?disabled=${!isHost} @click=${() => toggleCat(id)}>
            ${catName(id)}
          </button>`
        )}
      </div>
      ${t("triviaLangNote") ? html`<p class="hint">${t("triviaLangNote")}</p>` : nothing}
    </div>
    ${isHost
      ? html`<button class="primary" ?disabled=${!teamsOk || !cats.length || state.ui.loading} @click=${begin}>
            ${state.ui.loading ? t("loadingQ") : t("start")}
          </button>
          ${!teamsOk ? html`<p class="hint">${t("needTeams")}</p>` : !cats.length ? html`<p class="hint">${t("pickSubjects")}</p>` : nothing}
          ${state.ui.loadError ? html`<p class="error">${t("loadFail")}</p>` : nothing}`
      : html`<p class="hint">${t("waitingHost")}</p>`}
  `;
}

// ---------- playing ----------

function scoreBar() {
  const room = state.room;
  return html`<div class="scorebar">
    <span class="team-A">${teamName("A")} <b>${room.scores?.A || 0}</b></span>
    <span>—</span>
    <span class="team-B"><b>${room.scores?.B || 0}</b> ${teamName("B")}</span>
  </div>`;
}

function playing() {
  const room = state.room;
  const me = state.me.key;
  const left = room.deadline - db.now();
  if (room.phase === "coin") {
    const flipping = left > 1500;
    return html`${scoreBar()}
      <div class="card center">
        <div class="coin ${flipping ? "flip" : "coin-" + room.coin}">${flipping ? "🪙" : room.coin === "A" ? "🔵" : "🔴"}</div>
        <p class="big">${flipping ? t("coinFlip") : t("coinWinner", { team: teamName(room.coin) })}</p>
      </div>`;
  }
  const q = room.questions[room.idx];
  const active = logic.activeTeam(room);
  const myTeam = room.players[me]?.team;
  const isCaptain = room.captains[active] === me;
  const onMyTeam = myTeam === active;
  const answering = room.phase === "answer" || room.phase === "steal";
  const suggestions = {};
  for (const [k, c] of Object.entries(room.suggest || {})) (suggestions[c] = suggestions[c] || []).push(room.players[k]?.name);
  const n = room.idx + 1;
  const title = n > logic.QUESTIONS ? t("suddenDeath", { i: n - logic.QUESTIONS }) : t("question", { i: n, n: logic.QUESTIONS });

  const click = (i) => {
    if (!answering || !onMyTeam) return;
    if (isCaptain) setUi({ confirm: { text: q.answers[i], yes: () => act({ type: "answer", choice: i }) } });
    else act({ type: "suggest", choice: i });
  };

  let message;
  if (room.phase === "answer") message = onMyTeam ? t("turnOf", { team: teamName(active) }) : t("waitTeam", { team: teamName(active) });
  else if (room.phase === "steal") message = t("stealOf", { team: teamName(active) });
  else {
    const l = room.last || {};
    message = l.team ? (l.stolen ? t("stoleIt", { team: teamName(l.team) }) : t("gotIt", { team: teamName(l.team) })) : t("nobodyGot");
  }

  return html`${scoreBar()}
    <div class="card question-card team-border-${active}">
      <div class="row spread">
        <span class="pill">${title} · ${catName(q.cat)}</span>
        ${answering ? html`<span class="timer ${left < 15000 ? "urgent" : ""}">⏱ ${fmtTime(left)}</span>` : nothing}
      </div>
      <p class="question">${q.q}</p>
      <p class="phase-msg team-${active}">${message}</p>
      <div class="answers">
        ${q.answers.map((a, i) => {
          const cls = [
            "answer",
            room.phase === "reveal" && i === q.correct ? "right" : "",
            (room.phase === "reveal" && room.last?.choice === i && i !== q.correct) || (room.phase === "steal" && room.wrongChoice === i) ? "wrong" : "",
          ].join(" ");
          return html`<button class=${cls} ?disabled=${!answering || !onMyTeam || (room.phase === "steal" && room.wrongChoice === i)} @click=${() => click(i)}>
            <span>${a}</span>
            ${onMyTeam && suggestions[i] ? html`<small class="sugg">💡 ${suggestions[i].join(", ")}</small>` : nothing}
          </button>`;
        })}
      </div>
      ${answering && onMyTeam ? html`<p class="hint">${t("captainAnswers")} ${t("captain")}: <b>${room.players[room.captains[active]]?.name}</b></p>` : nothing}
      ${room.phase === "reveal" ? html`<p>${t("rightAnswer", { a: q.answers[q.correct] })}</p>` : nothing}
    </div>`;
}

// ---------- ended ----------

function ended() {
  const room = state.room;
  const w = room.result.winner;
  return html`${scoreBar()}
    <div class="card center">
      <h2>${t("gameOver")}</h2>
      <p class="big">${w ? "🏆 " + t("teamWins", { team: teamName(w) }) : "🤝 " + t("draw")}</p>
      <table class="board">
        ${roomPlayers(room).map(
          (p) => html`<tr class=${p.key === state.me.key ? "mine" : ""}>
            <td class="team-${p.team}">${p.name}</td><td><b>${t("pointsWon", { n: room.result.points[p.key] || 0 })}</b></td>
          </tr>`
        )}
      </table>
      <a class="button primary" href="#/trivia">${t("playAgain")}</a>
    </div>`;
}
