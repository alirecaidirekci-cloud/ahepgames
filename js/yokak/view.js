// Screens for the YÖKAK Quiz: solo practice page (#/yokak/solo, played only in this browser)
// and multiplayer rooms (1v1 or team vs team). The game itself is Turkish only, so its texts
// live here instead of i18n.js; only the home card and room list texts are in i18n.js.
import { state, act, setUi, rerender, roomHeader } from "../app.js";
import { t, getLang } from "../i18n.js";
import { html, nothing, roomPlayers, shuffle, arr } from "../lib.js";
import * as logic from "./logic.js";

export const MAX_PLAYERS = logic.MAX_PLAYERS;
export const icon = "🏛️";
export const noScores = true;
export const QUESTION_COUNT = 230; // rows in data/yokak.json
export const reduce = logic.reduce;
export const info = () => ({ pool: QUESTION_COUNT, q: logic.QUESTIONS });

const CRITICAL_SHARE = 0.4; // at least 40% of each set are "Kritik" questions (pool README)
const DIFF_ICON = { Kolay: "🟢", Orta: "🟡", Zor: "🔴" };
const LETTERS = "ABCD";

// ---------- questions ----------
// data/yokak.json rows: [id, mainTopic, topic, importance 1-4, difficulty, question, [4 options],
//                        right option index, explanation, source, sourceUrl]
let bankPromise = null;
let byId = {};
function loadBank() {
  bankPromise ??= fetch("data/yokak.json")
    .then((r) => r.json())
    .then((rows) => {
      const list = rows.map(([id, main, topic, imp, diff, q, opts, c, expl, src, url]) => ({ id, main, topic, imp, diff, q, opts, c, expl, src, url }));
      byId = Object.fromEntries(list.map((q) => [q.id, q]));
      return list;
    })
    .catch((e) => {
      bankPromise = null;
      throw e;
    });
  return bankPromise;
}
export const prepare = () => loadBank().catch(() => {});

// A mixed set: 40% "Kritik" questions, the rest from all other questions, options shuffled.
// Returns [{id, o: option order, c: index of the right answer in that order}].
function pickSet(list, n = logic.QUESTIONS) {
  const crit = Math.ceil(n * CRITICAL_SHARE);
  const a = shuffle(list.filter((q) => q.imp === 1)).slice(0, crit);
  const b = shuffle(list.filter((q) => q.imp !== 1)).slice(0, n - a.length);
  return shuffle([...a, ...b]).map((q) => {
    const o = shuffle([0, 1, 2, 3]);
    return { id: q.id, o, c: o.indexOf(q.c) };
  });
}

// ---------- the "hoca" mascot ----------
// A short splash with a speech bubble ("N'aber hocalar" when entering the game, another one when a
// team game starts) and the same figure next to the question card while playing.
// After your own (or your team's) answer a second hoca reacts: happy when right, angry when wrong.
const SPLASH_MS = 2500;
const REACT_MS = 1800;
let splash = null; // {text, img, react, leaving}
function showSplash(text, img = "img/hoca.png", react = false) {
  const mine = (splash = { text, img, react, leaving: false });
  const ms = react ? REACT_MS : SPLASH_MS;
  rerender();
  setTimeout(() => splash === mine && ((mine.leaving = true), rerender()), ms);
  setTimeout(() => splash === mine && ((splash = null), rerender()), ms + 500);
}
const react = (right) =>
  right ? showSplash("Tebrikler hocam!", "img/hoca_happy.png", true) : showSplash("Nasıl, nasıl, nasıl!!", "img/hoca_angry.png", true);
// Greets once each time someone comes into the game from another part of the site.
let greeted = false;
window.addEventListener("hashchange", () => {
  if (!location.hash.startsWith("#/yokak")) greeted = false;
});

// Rendered by every screen of the game.
function splashView() {
  if (!greeted) {
    greeted = true;
    setTimeout(() => showSplash("N'aber hocalar!"));
  }
  return splash
    ? html`<div class="welcome-screen ${splash.react ? "yk-react" : ""} ${splash.leaving ? "leaving" : ""}" @click=${() => ((splash = null), rerender())}>
        <div class="welcome"><img class="mascot" src=${splash.img} alt="" /><div class="bubble">${splash.text}</div></div>
      </div>`
    : nothing;
}

// Question screens: the card(s) on the left, the figure on the right (above the card on phones).
const stage = (content) => html`<div class="yk-stage"><img class="yk-hoca" src="img/hoca.png" alt="" /><div class="yk-main">${content}</div></div>`;

const trOnlyNote = () =>
  getLang() === "tr" ? nothing : html`<p class="card yk-note">🇹🇷 ${t("yokakTrOnly")}</p>`;

export const lobbyExtra = () => html`${splashView()} ${trOnlyNote()}
  <div class="card yk-solo">
    <div>
      <b>🧑‍🎓 Tek kişilik alıştırma</b>
      <p class="hint">${logic.QUESTIONS} soru, her cevaptan sonra açıklama. Puan tabloya yazılmaz.</p>
    </div>
    <button class="primary" @click=${() => (location.hash = "#/yokak/solo")}>Tek başına oyna</button>
  </div>
  <p class="hint">Ya da bir oda kur: 1v1 (her takımda 1 kişi) veya takım vs takım (her takımda 2–4 kişi).</p>`;

// Question card shared by solo and multiplayer.
// opts: {choiceOf(i) -> class names, onPick(i) or null, footer}
function questionCard(entry, n, total, { cls, onPick, message, reveal }) {
  const q = byId[entry.id];
  if (!q) return html`<div class="card"><p>Sorular yükleniyor…</p></div>`;
  return html`<div class="card question-card yk">
    <div class="row">
      <span class="pill">Soru ${n}/${total}</span>
      <span class="pill">${q.main}</span>
      <span class="pill diff">${DIFF_ICON[q.diff] || ""} ${q.diff}</span>
      ${q.imp === 1 ? html`<span class="pill yk-crit">⭐ Kritik</span>` : nothing}
    </div>
    <p class="question">${q.q}</p>
    ${message ? html`<p class="phase-msg">${message}</p>` : nothing}
    <div class="answers">
      ${entry.o.map(
        (orig, i) => html`<button class="answer ${cls(i)}" ?disabled=${!onPick} @click=${() => onPick?.(i)}>
          <span><b>${LETTERS[i]})</b> ${q.opts[orig]}</span>
        </button>`
      )}
    </div>
    ${reveal
      ? html`<div class="yk-expl">
          <p><b>Doğru cevap: ${LETTERS[entry.c]}) ${q.opts[entry.o[entry.c]]}</b></p>
          <p>💡 ${q.expl}</p>
          <p class="hint">📄 Kaynak: ${q.url ? html`<a href=${q.url} target="_blank" rel="noopener">${q.src}</a>` : q.src}</p>
        </div>`
      : nothing}
  </div>`;
}

// ---------- solo (#/yokak/solo) ----------

const solo = { set: null, idx: 0, picks: [], error: false };

async function newSolo() {
  solo.set = null;
  solo.error = false;
  rerender();
  try {
    solo.set = pickSet(await loadBank());
    solo.idx = 0;
    solo.picks = [];
  } catch {
    solo.error = true;
  }
  rerender();
}

function soloView() {
  const back = html`${splashView()}<a href="#/yokak" class="back">${t("back")}</a>`;
  if (solo.error) return html`${back}<p class="error">Sorular yüklenemedi. <button class="small" @click=${newSolo}>Tekrar dene</button></p>`;
  if (!solo.set) return html`${back}<p>Sorular yükleniyor…</p>`;
  const total = solo.set.length;
  const score = solo.picks.filter((p, i) => p === solo.set[i].c).length;
  if (solo.idx >= total) {
    const wrong = solo.set.filter((e, i) => solo.picks[i] !== e.c);
    return html`${back}
      <div class="card center">
        <h2>Alıştırma bitti</h2>
        <p class="big">${score >= 8 ? "🏆" : score >= 5 ? "👍" : "📚"} ${score}/${total} doğru</p>
        <button class="primary" @click=${newSolo}>🔁 Yeni ${total} soru</button>
      </div>
      ${wrong.length
        ? html`<h3>Tekrar gözden geçir (${wrong.length})</h3>
            ${wrong.map((e) => {
              const q = byId[e.id];
              return html`<div class="card yk-review">
                <p><b>${q.q}</b></p>
                <p class="yk-right">✅ ${q.opts[q.c]}</p>
                <p class="hint">💡 ${q.expl}</p>
              </div>`;
            })}`
        : nothing}`;
  }
  const entry = solo.set[solo.idx];
  const pick = solo.picks[solo.idx];
  const answered = pick !== undefined;
  const cls = (i) => (answered && i === entry.c ? "right" : answered && i === pick ? "wrong" : "");
  const message = !answered ? "" : pick === entry.c ? "✅ Doğru!" : "❌ Yanlış.";
  return html`${back}
    ${stage(html`<div class="scorebar"><span>🧑‍🎓 ${state.me.name}</span><b>${score}</b></div>
    ${questionCard(entry, solo.idx + 1, total, {
      cls,
      onPick: answered ? null : (i) => ((solo.picks[solo.idx] = i), react(i === entry.c)),
      message,
      reveal: answered,
    })}
    ${answered
      ? html`<div class="row end"><button class="primary" @click=${() => (solo.idx++, rerender(), scrollTo(0, 0))}>
          ${solo.idx + 1 >= total ? "Sonuçları gör" : "Sonraki soru →"}
        </button></div>`
      : nothing}`)}`;
}

export const pages = {
  solo: {
    enter() {
      newSolo();
      return [];
    },
    view: soloView,
  },
};

// ---------- multiplayer rooms ----------

const teamName = (room, team) => room?.teamNames?.[team] || (team === "A" ? "Mavi Takım" : "Kırmızı Takım");
// In 1v1 a side is shown by its player's name.
function sideName(room, team) {
  const m = logic.members(room, team);
  return m.length === 1 && logic.isDuel(room) ? room.players[m[0]].name : teamName(room, team);
}

// New players are put into the smaller team automatically (they can still switch in the lobby).
const assigning = new Set();
// "All the department heads are here": shown to everyone in the room when a team game starts.
const teamSplashShown = new Set();
const reacted = new Set(); // questions my side already got a reaction for
export function onRoom(room) {
  const me = state.me?.key;
  const myTeam = room?.players?.[me]?.team;
  if (room?.status === "playing" && myTeam) {
    const entry = room.questions[room.idx];
    const mine = arr(room.tries).find((x) => x.team === myTeam);
    const key = room.code + "/" + room.idx + "/" + entry.id;
    if (mine && !reacted.has(key)) {
      reacted.add(key);
      react(mine.c === entry.c);
    }
  }
  if (room?.status === "playing" && room.idx === 0 && room.phase === "question" && !logic.isDuel(room)) {
    const key = room.code + "/" + room.questions?.[0]?.id;
    if (!teamSplashShown.has(key)) {
      teamSplashShown.add(key);
      showSplash("Ooo bütün bölüm başkanları toplanmış!");
    }
  }
  if (!room || room.status !== "lobby" || !room.players?.[me] || room.players[me].team) return;
  if (assigning.has(room.code)) return;
  assigning.add(room.code);
  const team = logic.members(room, "A").length <= logic.members(room, "B").length ? "A" : "B";
  act({ type: "setTeam", team }).finally(() => setTimeout(() => assigning.delete(room.code), 2000));
}

export function view() {
  const room = state.room;
  return html`${splashView()} ${roomHeader("yokak")} ${trOnlyNote()}
    ${room.status === "lobby" ? lobby() : room.status === "playing" ? playing() : ended()}`;
}

function lobby() {
  const room = state.room;
  const me = state.me.key;
  const ps = roomPlayers(room);
  const ok = logic.sizesOk(room);
  const mode = !ok ? null : logic.isDuel(room) ? "1v1" : "Takım vs Takım";
  const begin = async () => {
    setUi({ loading: true, loadError: false });
    try {
      const set = pickSet(await loadBank());
      if (!(await act({ type: "begin", questions: set }))) throw new Error("not started");
      setUi({ loading: false });
    } catch {
      setUi({ loading: false, loadError: true });
    }
  };
  const rename = (e) => (e.preventDefault(), act({ type: "setTeamName", name: new FormData(e.target).get("tn") }));
  return html`
    <div class="teams">
      ${["A", "B"].map((team) => {
        const m = ps.filter((p) => p.team === team);
        const mine = room.players[me]?.team === team;
        return html`<div class="card team team-${team}">
          <h3>${teamName(room, team)} (${m.length}/${logic.MAX_TEAM})</h3>
          <ul class="players">
            ${m.map((p) => html`<li>${p.name} ${p.key === me ? html`<small>(sen)</small>` : nothing}</li>`)}
          </ul>
          ${mine
            ? html`<form class="row rename-team" @submit=${rename}>
                <input name="tn" maxlength="20" placeholder="Takım adı" .value=${room.teamNames?.[team] || ""} />
                <button class="small">✏️ Değiştir</button>
              </form>`
            : room.players[me] && m.length < logic.MAX_TEAM
              ? html`<button @click=${() => act({ type: "setTeam", team })}>Bu takıma geç</button>`
              : nothing}
        </div>`;
      })}
    </div>
    <div class="card">
      <p class="hint">
        ${logic.QUESTIONS} soru, süre yok. İki taraf aynı soruyu aynı anda görür. Her tarafın soru başına tek hakkı
        vardır (takımda herhangi bir üye cevaplayabilir). İlk doğru cevaplayan 1 puan alır; yanlış cevaplayan o soruda
        bekler. Her sorudan sonra doğru cevap ve açıklama gösterilir. Puanlar genel tabloya yazılmaz.
      </p>
      <p class="hint">${mode ? html`Mod: <b>${mode}</b>` : "1v1 için her takımda 1 kişi, takım oyunu için her takımda 2–4 kişi olmalı."}</p>
    </div>
    ${room.host === me
      ? html`<button class="primary" ?disabled=${!ok || state.ui.loading} @click=${begin}>${state.ui.loading ? "Sorular yükleniyor…" : "Oyunu başlat"}</button>
          ${state.ui.loadError ? html`<p class="error">Sorular yüklenemedi, tekrar dene.</p>` : nothing}`
      : html`<p class="hint">Kurucunun başlatması bekleniyor…</p>`}
  `;
}

function scoreBar(room) {
  return html`<div class="scorebar">
    <span class="team-A">${sideName(room, "A")} <b>${room.scores?.A || 0}</b></span>
    <span>—</span>
    <span class="team-B"><b>${room.scores?.B || 0}</b> ${sideName(room, "B")}</span>
  </div>`;
}

function playing() {
  const room = state.room;
  const me = state.me.key;
  const myTeam = room.players?.[me]?.team;
  const entry = room.questions[room.idx];
  const tries = arr(room.tries);
  const reveal = room.phase === "reveal";
  const mine = tries.find((x) => x.team === myTeam);
  const cls = (i) => {
    if (reveal) return i === entry.c ? "right" : tries.some((x) => x.c === i) ? "wrong" : "";
    return mine?.c === i ? "wrong" : ""; // only my own side's wrong answer is shown before the reveal
  };
  const duel = logic.isDuel(room);
  const who = (k, team) => (duel ? room.players[k]?.name : `${room.players[k]?.name} (${sideName(room, team)})`);
  const wrongNote = tries.map((x) => html`<div>❌ ${who(x.k, x.team)} yanlış cevapladı.</div>`);
  let message;
  if (reveal) {
    const l = room.last || {};
    message = l.team ? html`✅ <span class="team-${l.team}">${who(l.k, l.team)}</span> doğru bildi! +1 puan` : "Kimse bilemedi.";
  } else if (!myTeam) message = html`${wrongNote}`;
  else if (mine) message = html`${wrongNote}<div>Rakibin cevabı bekleniyor…</div>`;
  else message = html`${wrongNote}<div>İlk doğru cevaplayan puanı alır!</div>`;
  const last = room.idx + 1 >= room.questions.length;
  return stage(html`${scoreBar(room)}
    ${questionCard(entry, room.idx + 1, room.questions.length, {
      cls,
      onPick: room.phase === "question" && myTeam && !mine ? (i) => act({ type: "answer", choice: i }) : null,
      message,
      reveal,
    })}
    ${reveal && myTeam
      ? html`<div class="row end"><button class="primary" @click=${() => act({ type: "next" })}>${last ? "Sonuçları gör" : "Sonraki soru →"}</button></div>`
      : nothing}`);
}

function ended() {
  const room = state.room;
  const w = room.result?.winner;
  const hist = arr(room.history);
  const correct = {};
  for (const h of hist) if (h.k && h.k !== "-") correct[h.k] = (correct[h.k] || 0) + 1;
  return html`${scoreBar(room)}
    <div class="card center">
      <h2>Oyun bitti</h2>
      <p class="big">${w ? `🏆 ${sideName(room, w)} kazandı!` : "🤝 Berabere!"}</p>
      <table class="board">
        ${roomPlayers(room).map(
          (p) => html`<tr class=${p.key === state.me.key ? "mine" : ""}>
            <td class="team-${p.team}">${p.name}</td><td><b>${correct[p.key] || 0} doğru</b></td>
          </tr>`
        )}
      </table>
      <div class="row center">
        ${room.host === state.me.key ? html`<button class="primary" @click=${() => act({ type: "rematch" })}>🔁 Tekrar oyna</button>` : nothing}
        <button @click=${() => (location.hash = "#/yokak")}>${t("back")}</button>
      </div>
    </div>`;
}
