// Tournament pages: #/tournaments (list + medal table), #/tournaments/new, #/tournaments/<id>.
import { state, setUi, rerender } from "../app.js";
import { db } from "../db.js";
import { t, getLang } from "../i18n.js";
import { html, nothing, arr } from "../lib.js";
import { CATEGORIES } from "../trivia/questions.js";
import { SUBJECTS, subjectName } from "../academic/bank.js";
import * as L from "./logic.js";
import { maskMedals } from "../mask.js";
import * as admins from "../admins.js";
const canPlay = (key) => admins.canPlay?.(key) ?? true; // tolerant of an older cached admins.js
const onBoards = (key) => admins.onBoards?.(key) ?? canPlay(key);
const hidden = (key) => !!admins.isHiddenOnline?.(key);

const GAME_ICON = { trivia: "🧠", academic: "🎓" };
const MEDAL_ICON = { gold: "🥇", silver: "🥈", bronze: "🥉" };
const catName = (id) => {
  const c = CATEGORIES.find((c) => c[0] === id);
  return c ? (getLang() === "tr" ? c[2] : c[1]) : id;
};

// Live data for these pages (tournaments are also watched app-wide in state.tournaments).
const ts = { medals: {} };

export function enter(route) {
  const offs = [db.on("medals", (m) => ((ts.medals = maskMedals(m || {})), rerender()))];
  const id = route[1];
  // On a tournament page: move it along every 3 seconds and keep the countdown ticking.
  const timer = setInterval(() => {
    if (id && id !== "new") L.advance(id);
    rerender();
  }, 3000);
  offs.push(() => clearInterval(timer));
  return offs;
}

export function view(route) {
  const id = route[1];
  if (!id) return listPage();
  if (id === "new") return createPage();
  return detailPage(id);
}

// ---------- helpers ----------

export const fmtDate = (ms) =>
  new Date(ms).toLocaleString(getLang() === "tr" ? "tr-TR" : "en-GB", { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export function fmtCountdown(ms) {
  if (ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return t("cdDays", { d, h });
  if (h) return t("cdHours", { h, m });
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

const statusPill = (tour) => html`<span class="pill t-${tour.status}">${t("tStatus_" + tour.status)}</span>`;
const allTournaments = () => Object.values(state.tournaments || {}).sort((a, b) => a.startAt - b.startAt);
const teamName = (tour, id) => tour.teams?.[id]?.name || "?";

export function medalRows() {
  return Object.entries(ts.medals)
    .filter(([key]) => onBoards(key))
    .map(([key, m]) => ({ key, name: m.name || key, gold: m.gold || 0, silver: m.silver || 0, bronze: m.bronze || 0 }))
    .sort((a, b) => b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || a.name.localeCompare(b.name));
}

export function medalTable() {
  const rows = medalRows();
  if (!rows.length) return html`<p class="hint">${t("noMedals")}</p>`;
  return html`<table class="board medal-board">
    <thead><tr><th>#</th><th>${t("player")}</th><th>🥇</th><th>🥈</th><th>🥉</th></tr></thead>
    <tbody>
      ${rows.map(
        (r, i) => html`<tr class=${r.key === state.me.key ? "mine" : ""}>
          <td>${i + 1}</td><td>${r.name}</td><td>${r.gold}</td><td>${r.silver}</td><td>${r.bronze}</td>
        </tr>`
      )}
    </tbody>
  </table>`;
}

// ---------- list ----------

function card(tour) {
  return html`<a class="card t-card" href="#/tournaments/${tour.id}">
    <div class="row spread">
      <b>${GAME_ICON[tour.game]} ${tour.title}</b>
      ${statusPill(tour)}
    </div>
    <span class="hint">${t(tour.game)} · ${fmtDate(tour.startAt)}</span>
    <span class="hint">${t("teamsCount", { n: L.activeTeams(tour), max: tour.maxTeams })} · ${t("organizer")}: ${tour.organizerName}</span>
  </a>`;
}

function listPage() {
  const list = allTournaments();
  const open = list.filter((x) => x.status === "registration");
  const live = list.filter((x) => x.status === "running");
  const done = list.filter((x) => x.status === "finished").reverse().slice(0, 10);
  return html`
    <a href="#/" class="back">${t("back")}</a>
    <div class="row spread">
      <h2>🏆 ${t("tournaments")}</h2>
      <a class="button primary" href="#/tournaments/new">＋ ${t("createTournament")}</a>
    </div>
    <p class="hint">${t("tournamentsIntro")}</p>
    ${live.length ? html`<h3>🔴 ${t("tStatus_running")}</h3><div class="t-list">${live.map(card)}</div>` : nothing}
    <h3>📝 ${t("tStatus_registration")}</h3>
    ${open.length ? html`<div class="t-list">${open.map(card)}</div>` : html`<p class="hint">${t("noOpenTournaments")}</p>`}
    ${done.length ? html`<h3>✅ ${t("tStatus_finished")}</h3><div class="t-list">${done.map(card)}</div>` : nothing}
    <h2>🏅 ${t("medalTable")}</h2>
    ${medalTable()}
  `;
}

// ---------- create ----------

function createPage() {
  const ui = state.ui;
  const game = ui.tGame || "trivia";
  const cats = ui.tCats || [9, 21];
  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const startAt = new Date(`${f.get("date")}T${f.get("time")}`).getTime();
    const title = String(f.get("title") || "").trim();
    if (!title) return setUi({ tError: t("tNeedTitle") });
    if (!(startAt > db.now() + 60 * 1000)) return setUi({ tError: t("tNeedFuture") });
    if (game === "trivia" && !cats.length) return setUi({ tError: t("pickSubjects") });
    const id = await L.createTournament(state.me, { title: title.slice(0, 40), game, startAt, maxTeams: Number(f.get("maxTeams")), cats });
    location.hash = `#/tournaments/${id}`;
  };
  const toggle = (id) => setUi({ tCats: cats.includes(id) ? cats.filter((c) => c !== id) : [...cats, id] });
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return html`<a href="#/tournaments" class="back">${t("back")}</a>
    <form class="card t-form" @submit=${submit}>
      <h2>＋ ${t("createTournament")}</h2>
      <label>${t("tTitle")}<input name="title" maxlength="40" placeholder=${t("tTitlePh")} /></label>
      <label>${t("tGame")}
        <select @change=${(e) => setUi({ tGame: e.target.value })}>
          ${L.QUIZ_GAMES.map((g) => html`<option value=${g} ?selected=${g === game}>${GAME_ICON[g]} ${t(g)}</option>`)}
        </select>
      </label>
      <div class="row">
        <label>${t("tDate")}<input name="date" type="date" required .value=${`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`} /></label>
        <label>${t("tTime")}<input name="time" type="time" required value="20:00" /></label>
        <label>${t("tMaxTeams")}
          <select name="maxTeams">${[4, 8, 16].map((n) => html`<option value=${n} ?selected=${n === 8}>${n}</option>`)}</select>
        </label>
      </div>
      ${game === "trivia"
        ? html`<div>
            <b>${t("subjects")}</b>
            <div class="chips">${CATEGORIES.map(([id]) => html`<button type="button" class=${cats.includes(id) ? "chip on" : "chip"} @click=${() => toggle(id)}>${catName(id)}</button>`)}</div>
          </div>`
        : html`<p class="hint">${t("tAcademicNote")}</p>`}
      <p class="hint">${t("tRulesShort", { q: L.ROUND_QUESTIONS, fq: L.FINAL_QUESTIONS, min: L.MIN_TEAM, max: L.MAX_TEAM })}</p>
      ${ui.tError ? html`<p class="error">${ui.tError}</p>` : nothing}
      <button class="primary">${t("createTournament")}</button>
    </form>`;
}

// ---------- detail ----------

function detailPage(id) {
  const tour = state.tournaments?.[id];
  if (!tour) return html`<a href="#/tournaments" class="back">${t("back")}</a><p>${state.tournaments ? t("tNotFound") : "…"}</p>`;
  const me = state.me.key;
  const isOrg = tour.organizer === me;
  const left = tour.startAt - db.now();
  const myTeamId = L.teamOf(tour, me);
  const myTeam = myTeamId && tour.teams[myTeamId];
  const confirm = (text, yes) => setUi({ confirm: { text, yes } });

  let top;
  if (tour.status === "registration")
    top = html`<p class="t-countdown">⏳ ${t("startsIn")} <b>${fmtCountdown(left)}</b></p><p class="hint">${t("regOpenUntilStart")}</p>`;
  else if (tour.status === "cancelled") top = html`<p class="error">${t(tour.cancelReason === "notEnoughTeams" ? "tCancelledTeams" : "tCancelled")}</p>`;
  else if (tour.status === "finished") top = podium(tour);
  else top = nothing;

  return html`
    <a href="#/tournaments" class="back">${t("back")}</a>
    <div class="card">
      <div class="row spread"><h2>${GAME_ICON[tour.game]} ${tour.title}</h2>${statusPill(tour)}</div>
      <p class="hint">${t(tour.game)} · 📅 ${fmtDate(tour.startAt)} · ${t("organizer")}: ${tour.organizerName} ·
        ${t("teamsCount", { n: L.activeTeams(tour), max: tour.maxTeams })}</p>
      ${tour.game === "trivia" && arr(tour.cats).length ? html`<p class="hint">${t("subjects")}: ${arr(tour.cats).map(catName).join(", ")}</p>` : nothing}
      ${top}
      ${isOrg && tour.status !== "running"
        ? html`<button class="small" @click=${() => confirm(t("tDeleteConfirm"), async () => (await L.deleteTournament(id, state.me), (location.hash = "#/tournaments")))}>🗑️ ${t("tDelete")}</button>`
        : nothing}
    </div>
    ${tour.status === "running" || tour.status === "finished" ? bracket(tour) : nothing}
    ${tour.status === "registration" ? registration(tour, myTeamId, myTeam) : nothing}
    ${teamsList(tour, isOrg)}
  `;
}

function podium(tour) {
  const line = (kind, ids) =>
    arr(ids)
      .filter(Boolean)
      .map(
        (teamId) => html`<div class="podium-row ${kind}">
          <span class="medal">${MEDAL_ICON[kind]}</span>
          <b>${teamName(tour, teamId)}</b>
          <small>${L.confirmedMembers(tour.teams[teamId]).map((k) => tour.teams[teamId].members[k].name).join(", ")}</small>
        </div>`
      );
  return html`<div class="podium">${line("gold", [tour.champion])} ${line("silver", [tour.runnerUp])} ${line("bronze", tour.bronze)}</div>`;
}

function bracket(tour) {
  const me = state.me.key;
  return html`<div class="card">
    <h3>🗂️ ${t("bracket")}</h3>
    <div class="bracket">
      ${arr(tour.rounds).map(
        (round, r) => html`<div class="b-round">
          <h4>${t("round_" + L.roundName(tour, r), { n: r + 1 })}</h4>
          ${arr(round).map((m, i) => {
            const side = (id) =>
              html`<div class="b-team ${m.winner && m.winner === id ? "win" : m.winner ? "lose" : ""}">
                <span>${id ? teamName(tour, id) : t("bye")}</span>
                ${m.score && id ? html`<b>${id === m.a ? m.score.A : m.score.B}</b>` : nothing}
              </div>`;
            const live = m.room && !m.winner;
            const inMatch = [m.a, m.b].some((id) => id && tour.teams[id]?.members?.[me]?.confirmed);
            return html`<div class="b-match">
              ${side(m.a)} ${m.bye ? html`<div class="b-team bye"><span>${t("bye")}</span></div>` : side(m.b)}
              ${m.walkover ? html`<small class="hint">${t("walkover")}</small>` : nothing}
              ${live ? html`<a class="button small ${inMatch ? "primary" : ""}" href="#/${tour.game}/${m.room}">${inMatch ? t("goToMatch") : "👀 " + t("watch")}</a>` : nothing}
            </div>`;
          })}
        </div>`
      )}
    </div>
  </div>`;
}

function registration(tour, myTeamId, myTeam) {
  const me = state.me;
  // Someone added me to their team and I haven't answered yet.
  if (myTeam && !myTeam.members[me.key].confirmed)
    return html`<div class="card t-invite">
      <p>📨 ${t("addedToTeam", { name: myTeam.members[myTeam.captain]?.name, team: myTeam.name })}</p>
      <div class="row">
        <button class="primary" @click=${() => L.answerTeamInvite(tour.id, myTeamId, me, true)}>${t("confirmSpot")}</button>
        <button @click=${() => L.answerTeamInvite(tour.id, myTeamId, me, false)}>${t("declineSpot")}</button>
      </div>
    </div>`;
  if (myTeam) return nothing;
  if (!canPlay(state.me.key)) return html`<p class="hint">🛡️ ${t("adminNoPlay")}</p>`;
  if (L.activeTeams(tour) >= tour.maxTeams) return html`<p class="hint">${t("tFull")}</p>`;
  return registerForm(tour);
}

function registerForm(tour) {
  const ui = state.ui;
  const picked = ui.rMembers || [];
  const subjects = ui.rSubjects || [];
  const q = (ui.rSearch || "").toLocaleLowerCase();
  const taken = (k) => !!L.teamOf(tour, k);
  const candidates = Object.entries(state.users || {})
    .map(([key, u]) => ({ key, name: u.name || key }))
    .filter((u) => u.key !== state.me.key && canPlay(u.key) && !hidden(u.key) && !picked.some((p) => p.key === u.key) && !taken(u.key))
    .filter((u) => !q || u.name.toLocaleLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 12);
  const submit = async (e) => {
    e.preventDefault();
    const name = new FormData(e.target).get("teamName").trim();
    if (!name) return setUi({ rError: t("needTeamName") });
    if (picked.length + 1 < L.MIN_TEAM) return setUi({ rError: t("needTeammates", { n: L.MIN_TEAM - 1 }) });
    if (tour.game === "academic" && subjects.length < 3) return setUi({ rError: t("needSubjects", { n: 3 }) });
    // real names for the team list (the screen may show aliases to a hidden player)
    const members = picked.map((p) => ({ ...p, name: state.usersRaw?.[p.key]?.name || p.name }));
    const res = await L.registerTeam(tour.id, state.me, { name, members, subjects });
    setUi({ rError: res === "ok" ? "" : t("reg_" + res), rMembers: [], rSubjects: [] });
  };
  return html`<form class="card t-form" @submit=${submit}>
    <h3>✍️ ${t("registerTeam")}</h3>
    <label>${t("teamNameLabel")}<input name="teamName" maxlength="20" placeholder=${t("teamNamePh")} /></label>
    <div>
      <b>${t("teammates")}</b> <small class="hint">(${t("teammatesHint", { max: L.MAX_TEAM - 1 })})</small>
      <div class="chips">
        <span class="chip on">${state.me.name} (${t("you")})</span>
        ${picked.map((p) => html`<button type="button" class="chip on" @click=${() => setUi({ rMembers: picked.filter((x) => x.key !== p.key) })}>${p.name} ✕</button>`)}
      </div>
      ${picked.length < L.MAX_TEAM - 1
        ? html`<input placeholder=${t("searchPlayers")} .value=${ui.rSearch || ""} @input=${(e) => setUi({ rSearch: e.target.value })} />
            <div class="chips">
              ${candidates.map((u) => html`<button type="button" class="chip" @click=${() => setUi({ rMembers: [...picked, u], rSearch: "" })}>＋ ${u.name}</button>`)}
            </div>`
        : nothing}
    </div>
    ${tour.game === "academic"
      ? html`<div>
          <b>${t("tSubjectsAcademic")}</b>
          <div class="chips">
            ${SUBJECTS.map(
              ([key]) => html`<button type="button" class=${subjects.includes(key) ? "chip on" : "chip"}
                @click=${() => setUi({ rSubjects: subjects.includes(key) ? subjects.filter((s) => s !== key) : [...subjects, key] })}>${subjectName(key)}</button>`
            )}
          </div>
        </div>`
      : nothing}
    <p class="hint">${t("registerHint")}</p>
    ${ui.rError ? html`<p class="error">${ui.rError}</p>` : nothing}
    <button class="primary">${t("registerTeam")}</button>
  </form>`;
}

function teamsList(tour, isOrg) {
  const me = state.me.key;
  const teams = Object.entries(tour.teams || {}).sort((a, b) => a[1].createdAt - b[1].createdAt);
  if (!teams.length) return html`<div class="card"><h3>👥 ${t("teams")}</h3><p class="hint">${t("noTeamsYet")}</p></div>`;
  const reg = tour.status === "registration";
  return html`<div class="card">
    <h3>👥 ${t("teams")}</h3>
    <div class="t-teams">
      ${teams.map(([id, team]) => {
        const isCaptain = team.captain === me;
        const ok = L.confirmedMembers(team).length >= L.MIN_TEAM;
        return html`<div class="t-team ${team.status}">
          <div class="row spread">
            <b>${team.name}</b>
            <span class="pill t-${team.status}">${t("teamStatus_" + team.status)}</span>
          </div>
          <ul>
            ${Object.entries(team.members || {}).map(
              ([k, m]) => html`<li>${m.confirmed ? "✅" : "⏳"} ${m.name}${k === team.captain ? " ©️" : ""}</li>`
            )}
          </ul>
          ${tour.game === "academic" && arr(team.subjects).length ? html`<small class="hint">${arr(team.subjects).map(subjectName).join(", ")}</small>` : nothing}
          ${reg && !ok ? html`<small class="hint">${t("waitingConfirm", { n: L.MIN_TEAM })}</small>` : nothing}
          ${reg
            ? html`<div class="row">
                ${isOrg && team.status !== "approved" ? html`<button class="small primary" @click=${() => L.setTeamStatus(tour.id, id, state.me, "approved")}>✓ ${t("approve")}</button>` : nothing}
                ${isOrg && team.status !== "rejected" ? html`<button class="small" @click=${() => L.setTeamStatus(tour.id, id, state.me, "rejected")}>✕ ${t("reject")}</button>` : nothing}
                ${isCaptain
                  ? html`<button class="small" @click=${() => {
                      const name = prompt(t("teamNameLabel"), team.name);
                      if (name) L.renameTeam(tour.id, id, state.me, name);
                    }}>✏️ ${t("rename")}</button>`
                  : nothing}
                ${isCaptain || isOrg
                  ? html`<button class="small" @click=${() => setUi({ confirm: { text: t("withdrawConfirm", { team: team.name }), yes: () => L.withdrawTeam(tour.id, id, state.me) } })}>🗑️ ${t("withdraw")}</button>`
                  : nothing}
              </div>`
            : nothing}
        </div>`;
      })}
    </div>
  </div>`;
}

// ---------- home page pieces ----------

// Notices for me: team spots to confirm, my tournaments starting within 24 hours, my live matches.
export function homeNotices() {
  const me = state.me.key;
  const items = [];
  for (const tour of allTournaments()) {
    const teamId = L.teamOf(tour, me);
    if (!teamId) continue;
    const team = tour.teams[teamId];
    if (tour.status === "registration" && !team.members[me].confirmed)
      items.push(html`<a class="notice" href="#/tournaments/${tour.id}">📨 ${t("noticeConfirm", { team: team.name, title: tour.title })}</a>`);
    else if (tour.status === "registration" && tour.startAt - db.now() < 24 * 3600 * 1000)
      items.push(html`<a class="notice" href="#/tournaments/${tour.id}">⏳ ${t("noticeSoon", { title: tour.title, time: fmtCountdown(tour.startAt - db.now()) })}</a>`);
    else if (tour.status === "running") {
      const round = arr(tour.rounds[arr(tour.rounds).length - 1]);
      const m = round.find((x) => !x.winner && x.room && (x.a === teamId || x.b === teamId));
      if (m) items.push(html`<a class="notice live" href="#/${tour.game}/${m.room}">🔴 ${t("noticeMatch", { title: tour.title })}</a>`);
    }
  }
  return items.length ? html`<div class="notices">${items}</div>` : nothing;
}

export function homeCard() {
  const list = allTournaments();
  const open = list.filter((x) => x.status === "registration").length;
  const live = list.filter((x) => x.status === "running").length;
  return html`<a class="card game" href="#/tournaments">
    <div class="game-icon">🏆</div>
    <h3>${t("tournaments")}</h3>
    <p>${t("tournamentsDesc")}</p>
    <p class="info">${t("tournamentsInfo", { open, live })}</p>
  </a>`;
}

export const hasMedals = () => Object.keys(ts.medals).length > 0;
export function watchMedals() {
  return db.on("medals", (m) => ((ts.medals = maskMedals(m || {})), rerender()));
}
