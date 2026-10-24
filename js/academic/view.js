// Screens for the Academic Quiz and its question bank page.
import { state, act, setUi, rerender, roomHeader } from "../app.js";
import { db } from "../db.js";
import { t } from "../i18n.js";
import { html, nothing, fmtTime, fmtNum, roomPlayers, awardOnce, arr } from "../lib.js";
import { isAdmin } from "../admins.js";
import * as logic from "./logic.js";
import { SUBJECTS, subjectName, loadAll, loadBuiltIn, countBySubject, buildQueues, localized } from "./bank.js";
import { teamLabel, renameField, autoStart, tournamentLobby, backLink } from "../tournament/match.js";

export const MAX_PLAYERS = logic.MAX_PLAYERS;
export const icon = "🎓";
export const BUILT_IN_COUNT = 420; // rows in data/academic/*.json
export const reduce = logic.reduce;
export const needsTick = (room, now) => room.status === "playing" && now >= room.deadline;
export const newRoomFields = () => ({ subjects: { A: [], B: [] } });
export const info = () => ({ pool: fmtNum(BUILT_IN_COUNT), subjects: SUBJECTS.length, min: logic.MIN_SUBJECTS, q: logic.QUESTIONS });

let bank = null; // all usable questions, loaded when a room or the bank page opens
export async function prepare() {
  bank = await loadAll();
}

export function onRoom(room, code) {
  if (room?.status === "ended" && !room.scored) {
    const awards = {};
    for (const p of roomPlayers(room)) {
      awards[p.key] = { name: p.name, pts: room.result.points[p.key] || 0, win: room.result.winner === p.team };
    }
    awardOnce("academic", code, awards);
  }
}

export const lobbyExtra = () => html`<p><a href="#/academic/bank">📚 ${t("bankLink")}</a></p>`;

const teamName = (team) => teamLabel(state.room, team);

// Picks each team's questions from its own subjects and starts (10 per match in tournaments).
async function startGame(room) {
  bank = await loadAll();
  const subjects = { A: arr(room.subjects?.A), B: arr(room.subjects?.B) };
  const queues = buildQueues(bank, subjects, logic.perTeam(room));
  if (!(await act({ type: "begin", queues }))) throw new Error("not started");
}

export function view() {
  const room = state.room;
  return html`${roomHeader("academic")}
    ${room.status === "lobby" ? lobby() : room.status === "playing" ? playing() : ended()}`;
}

// ---------- lobby ----------

function lobby() {
  const room = state.room;
  if (room.tournament) {
    autoStart(room, () => startGame(room));
    return tournamentLobby(room);
  }
  const me = state.me.key;
  const isHost = room.host === me;
  const ps = roomPlayers(room);
  const counts = countBySubject(bank || []);
  const subjectsOf = (team) => arr(room.subjects?.[team]);
  const teamsOk = logic.members(room, "A").length >= 2 && logic.members(room, "B").length >= 2 && ps.every((p) => p.team);
  const subjectsOk = ["A", "B"].every((team) => subjectsOf(team).length >= logic.MIN_SUBJECTS);
  const begin = async () => {
    setUi({ loading: true, loadError: false });
    try {
      await startGame(room);
      setUi({ loading: false });
    } catch {
      setUi({ loading: false, loadError: true });
    }
  };
  const unassigned = ps.filter((p) => !p.team);
  return html`
    <div class="teams">
      ${["A", "B"].map((team) => {
        const m = ps.filter((p) => p.team === team);
        const mine = room.players[me]?.team === team;
        const chosen = subjectsOf(team);
        return html`<div class="card team team-${team}">
          <h3>${teamName(team)} (${m.length})</h3>
          <ul class="players">
            ${m.map((p) => html`<li>${p.name} ${p.key === me ? html`<small>(${t("you")})</small>` : nothing}</li>`)}
          </ul>
          ${renameField(room, team)}
          ${mine || !room.players[me] ? nothing : html`<button @click=${() => act({ type: "setTeam", team })}>${t("joinTeam")}</button>`}
          <h4>${t("teamSubjects", { n: chosen.length, min: logic.MIN_SUBJECTS })}</h4>
          <div class="chips">
            ${SUBJECTS.map(
              ([key]) => html`<button class=${chosen.includes(key) ? "chip on" : "chip"} ?disabled=${!mine} @click=${() => act({ type: "toggleSubject", subject: key })}>
                ${subjectName(key)} <small>${counts[key] || ""}</small>
              </button>`
            )}
          </div>
        </div>`;
      })}
    </div>
    ${unassigned.length ? html`<p class="hint">⏳ ${unassigned.map((p) => p.name).join(", ")}</p>` : nothing}
    <div class="card">
      <p class="hint">${t("academicRules")}</p>
      <p class="hint">${t("diffRule")}</p>
    </div>
    ${isHost
      ? html`<button class="primary" ?disabled=${!teamsOk || !subjectsOk || state.ui.loading} @click=${begin}>
            ${state.ui.loading ? t("loadingQ") : t("start")}
          </button>
          ${!teamsOk ? html`<p class="hint">${t("needTeams")}</p>` : !subjectsOk ? html`<p class="hint">${t("needSubjects", { n: logic.MIN_SUBJECTS })}</p>` : nothing}
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

const DIFF_ICON = { easy: "🟢", medium: "🟡", hard: "🔴" };

function playing() {
  const room = state.room;
  const me = state.me.key;
  const left = room.deadline - db.now();
  if (room.phase === "coin") {
    const flipping = left > 1500;
    return html`${scoreBar()}
      <div class="card center">
        <div class="coin ${flipping ? "flip" : ""}">${flipping ? "🪙" : room.coin === "A" ? "🔵" : "🔴"}</div>
        <p class="big">${flipping ? t("coinFlip") : t("coinWinner", { team: teamName(room.coin) })}</p>
      </div>`;
  }
  const q = room.questions[room.idx];
  const text = localized(q);
  const active = logic.activeTeam(room);
  const onMyTeam = room.players[me]?.team === active;
  const answering = room.phase === "answer" || room.phase === "steal";
  const votes = answering ? logic.tally(room) : null;
  const voters = {};
  if (votes) for (const [k, c] of Object.entries(votes.current)) (voters[c] = voters[c] || []).push(room.players[k]?.name);
  const n = room.idx + 1;
  const total = room.qCount || logic.QUESTIONS;
  const title = n > total ? t("suddenDeath", { i: n - total }) : t("question", { i: n, n: total });

  let message;
  if (room.phase === "answer") message = onMyTeam ? t("turnOf", { team: teamName(active) }) : t("waitTeam", { team: teamName(active) });
  else if (room.phase === "steal") message = t("stealOf", { team: teamName(active) });
  else {
    const l = room.last || {};
    const vars = { team: teamName(l.team), n: l.pts || 1 };
    message = l.team ? (l.stolen ? t("stoleIt", vars) : t("gotIt", vars)) : t("nobodyGot");
  }
  const reported = state.ui.reported?.[q.id];
  const report = () =>
    setUi({
      confirm: {
        text: t("reportConfirm"),
        yes: async () => {
          await db.set(`academic/reports/${q.id}/${me}`, { name: state.me.name, t: db.now() });
          setUi({ reported: { ...(state.ui.reported || {}), [q.id]: true } });
        },
      },
    });

  return html`${scoreBar()}
    <div class="card question-card team-border-${active}">
      <div class="row spread">
        <span class="row">
          <span class="pill">${title} · ${subjectName(q.s)}</span>
          <span class="pill diff diff-${q.diff}">${DIFF_ICON[q.diff]} ${t("diff_" + q.diff)} · ${t("ptsShort", { n: logic.questionPoints(q) })}</span>
        </span>
        ${answering ? html`<span class="timer ${left < 15000 ? "urgent" : ""}">⏱ ${fmtTime(left)}</span>` : nothing}
      </div>
      <p class="question">${text.q}</p>
      <p class="phase-msg team-${active}">${message}</p>
      <div class="answers">
        ${text.a.map((a, i) => {
          const lockedOut = room.phase === "steal" && room.wrongChoice === i;
          const cls = [
            "answer",
            room.phase === "reveal" && i === q.correct ? "right" : "",
            (room.phase === "reveal" && room.last?.choice === i && i !== q.correct) || lockedOut ? "wrong" : "",
            votes && votes.current[me] === i ? "my-vote" : "",
          ].join(" ");
          return html`<button class=${cls} ?disabled=${!answering || !onMyTeam || lockedOut} @click=${() => act({ type: "vote", choice: i })}>
            <span>${a}</span>
            ${onMyTeam && voters[i] ? html`<small class="sugg">🗳️ ${voters[i].length} · ${voters[i].join(", ")}</small>` : nothing}
          </button>`;
        })}
      </div>
      ${answering && onMyTeam ? html`<p class="hint">${t("voteHint")} ${t("votesCount", { v: votes.voted, n: votes.total })}</p>` : nothing}
      ${room.phase === "reveal" ? html`<p>${t("rightAnswer", { a: text.a[q.correct] })}</p>` : nothing}
      <div class="row end">
        <button class="small" ?disabled=${reported} @click=${report}>${reported ? t("reported") : "🚩 " + t("report")}</button>
      </div>
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
      ${backLink(room, "academic")}
    </div>`;
}

// ---------- question bank page (#/academic/bank) ----------

const bankState = { builtIn: [], added: {}, hidden: {}, reports: {} };

export const pages = {
  bank: {
    enter() {
      loadBuiltIn().then((b) => ((bankState.builtIn = b), rerender()));
      return [
        db.on("academic/questions", (v) => ((bankState.added = v || {}), rerender())),
        db.on("academic/hidden", (v) => ((bankState.hidden = v || {}), rerender())),
        db.on("academic/reports", (v) => ((bankState.reports = v || {}), rerender())),
      ];
    },
    view: bankView,
  },
};

function bankView() {
  const me = state.me;
  const admin = isAdmin(me);
  const added = Object.entries(bankState.added).map(([id, q]) => ({ ...q, id: "c-" + id, rawId: id }));
  const all = [...bankState.builtIn, ...added];
  const byId = Object.fromEntries(all.map((q) => [q.id, q]));
  const usable = all.filter((q) => !bankState.hidden[q.id]);
  const counts = countBySubject(usable);
  const reported = Object.entries(bankState.reports).map(([id, r]) => ({ id, q: byId[id], names: Object.values(r).map((x) => x.name) }));
  const hiddenIds = Object.keys(bankState.hidden);

  const qText = (q) => (q ? localized(q).q : "?");
  const answers = (q) => (q ? localized(q).a : []);

  return html`
    <a href="#/academic" class="back">${t("back")}</a>
    <h2>📚 ${t("bankTitle")}</h2>
    <p class="hint">${t("bankIntro")}</p>
    <table class="board">
      <thead><tr><th>${t("department")}</th><th>${t("questionsWord")}</th></tr></thead>
      <tbody>
        ${SUBJECTS.map(([key]) => html`<tr><td>${subjectName(key)}</td><td>${counts[key]}</td></tr>`)}
        <tr><td><b>${t("total")}</b></td><td><b>${usable.length}</b></td></tr>
      </tbody>
    </table>

    ${addForm()}

    <div class="card">
      <h3>🚩 ${t("reportedTitle")} (${reported.length})</h3>
      ${reported.length
        ? reported.map(
            (r) => html`<div class="bank-item">
              <p><b>${qText(r.q)}</b> <span class="pill">${r.q ? subjectName(r.q.s) : r.id}</span>
                ${bankState.hidden[r.id] ? html`<span class="pill">${t("hiddenTag")}</span>` : nothing}</p>
              <p class="hint">✅ ${answers(r.q)[0] || ""} · ${t("reportedBy", { names: r.names.join(", ") })}</p>
              ${admin
                ? html`<div class="row">
                    ${bankState.hidden[r.id]
                      ? html`<button class="small" @click=${() => db.set(`academic/hidden/${r.id}`, null)}>${t("unhide")}</button>`
                      : html`<button class="small" @click=${() => db.set(`academic/hidden/${r.id}`, true)}>${t("hide")}</button>`}
                    <button class="small" @click=${() => db.set(`academic/reports/${r.id}`, null)}>${t("clearReports")}</button>
                  </div>`
                : nothing}
            </div>`
          )
        : html`<p class="hint">${t("noReports")}</p>`}
    </div>

    <div class="card">
      <h3>➕ ${t("addedTitle")} (${added.length})</h3>
      ${added.length
        ? added
            .sort((a, b) => b.t - a.t)
            .map(
              (q) => html`<div class="bank-item">
                <p><b>${qText(q)}</b> <span class="pill">${subjectName(q.s)}</span> <span class="pill">${t("diff_" + q.diff)}</span></p>
                <p class="hint">✅ ${answers(q)[0]} · ❌ ${answers(q).slice(1).join(" · ")} · ${t("addedBy", { name: q.byName })}</p>
                ${admin || q.by === me.key
                  ? html`<button class="small" @click=${() => setUi({ confirm: { text: t("deleteConfirm"), yes: () => db.set(`academic/questions/${q.rawId}`, null) } })}>
                      🗑️ ${t("deleteQ")}
                    </button>`
                  : nothing}
              </div>`
            )
        : html`<p class="hint">${t("noAdded")}</p>`}
    </div>

    ${admin && hiddenIds.length
      ? html`<div class="card">
          <h3>🙈 ${t("hiddenTitle")} (${hiddenIds.length})</h3>
          ${hiddenIds.map(
            (id) => html`<div class="bank-item row spread">
              <span>${qText(byId[id])}</span>
              <button class="small" @click=${() => db.set(`academic/hidden/${id}`, null)}>${t("unhide")}</button>
            </div>`
          )}
        </div>`
      : nothing}
    ${admin ? nothing : html`<p class="hint">${t("adminNote")}</p>`}
  `;
}

function addForm() {
  const ui = state.ui;
  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const side = (lang) => {
      const q = f.get(lang + "q").trim();
      const a = [0, 1, 2, 3].map((i) => f.get(lang + "a" + i).trim());
      return q && a.every(Boolean) ? { q, a } : null;
    };
    const en = side("en");
    const tr = side("tr");
    if (!en && !tr) return setUi({ addError: t("fillOneLanguage"), added: false });
    const id = db.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await db.set(`academic/questions/${id}`, { s: f.get("s"), diff: f.get("diff"), en, tr, by: state.me.key, byName: state.me.name, t: db.now() });
    e.target.reset();
    setUi({ addError: "", added: true });
  };
  const fields = (lang, label) => html`<fieldset>
    <legend>${label}</legend>
    <textarea name="${lang}q" rows="2" placeholder=${t("questionWord")}></textarea>
    <input name="${lang}a0" placeholder="✅ ${t("rightAnswer", { a: "" })}" />
    ${[1, 2, 3].map((i) => html`<input name="${lang}a${i}" placeholder="❌ ${t("wrongAnswer")} ${i}" />`)}
  </fieldset>`;
  return html`<form class="card add-form" @submit=${submit}>
    <h3>✍️ ${t("addTitle")}</h3>
    <div class="row">
      <select name="s">${SUBJECTS.map(([key]) => html`<option value=${key}>${subjectName(key)}</option>`)}</select>
      <select name="diff">
        ${["easy", "medium", "hard"].map((d) => html`<option value=${d}>${t("diff_" + d)}</option>`)}
      </select>
    </div>
    <div class="two-cols">${fields("tr", "Türkçe")} ${fields("en", "English")}</div>
    <p class="hint">${t("fillOneLanguage")}</p>
    ${ui.addError ? html`<p class="error">${ui.addError}</p>` : nothing}
    ${ui.added ? html`<p class="yes">✓ ${t("addedOk")}</p>` : nothing}
    <button class="primary">${t("save")}</button>
  </form>`;
}
