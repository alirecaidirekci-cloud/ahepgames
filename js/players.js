// "Meet the Players" section on the home page: a group photo of the players' cut-outs (hover to see
// a name, tap a figure for a profile card with the bigger picture).
// Made from the "Meet Players" folder; images in img/players/.
import { rerender, state } from "./app.js";
import { db } from "./db.js";
import { t, getLang } from "./i18n.js";
import { html, nothing } from "./lib.js";
import { masking } from "./mask.js";
import { svg } from "https://cdn.jsdelivr.net/npm/lit-html@3.1.4/lit-html.js"; // SVG shapes need the svg tag

/* EDIT PLAYERS HERE
   name – shown on the photo and the card; user – their username on the site (the card shows the
   sentence they wrote and their last game). role / bio / facts – optional extra card text.
   row – "front" or "back" of the group photo; x – position from 0 (left) to 100 (right).
   hidden: true – left out of the photo and the card (its image is not on the site:
   copy it into img/players/ when bringing the player back). */
const ALL_PLAYERS = [
  { name: "Ali", user: "ali", photo: "ali", row: "back", x: 30, role: "", bio: "", facts: [] },
  { name: "Comandante", user: "comandante", photo: "bilal", row: "back", x: 70, role: "", bio: "", facts: [] },
  { name: "Cem Hoca", user: "", photo: "cem", row: "back", x: 50, role: "", bio: "", facts: [], hidden: true },
  { name: "Kemal", user: "kemal", photo: "kemal", row: "front", x: 20, role: "", bio: "", facts: [] },
  { name: "Simi", user: "simi", photo: "semih", row: "front", x: 40, role: "", bio: "", facts: [] },
  { name: "TT55", user: "tt55", photo: "tamer", row: "front", x: 60, role: "", bio: "", facts: [] },
  { name: "Zeynep", user: "zeynep", photo: "zeynep", row: "front", x: 80, role: "", bio: "", facts: [] },
];
const PEOPLE = ALL_PLAYERS.filter((p) => !p.hidden);
const img = (p) => `img/players/${p.photo}.webp`;

// The photo is 100 × 68 "scene units"; height = how tall a person is, floor = where their feet are.
const ROWS = { back: { height: 45, floor: 55 }, front: { height: 50, floor: 66 } };

// Click areas traced from the cut-out images (aspect = width / height of the image).
const SILHOUETTES = {"ali":{"aspect":0.395,"poly":[[0.3114,0.028],[0.2228,0.057],[0.1899,0.085],[0.1722,0.114],[0.1747,0.142],[0.1797,0.171],[0.1519,0.199],[0.1367,0.228],[0.162,0.256],[0.2,0.285],[0.2456,0.313],[0.2911,0.342],[0.2456,0.371],[0.1949,0.399],[0.1367,0.428],[0.1063,0.456],[0.081,0.485],[0.0506,0.513],[0.0203,0.542],[0.0076,0.57],[0.0253,0.599],[0.1924,0.627],[0.1975,0.656],[0.2101,0.685],[0.2127,0.713],[0.2152,0.742],[0.2203,0.77],[0.2203,0.799],[0.2405,0.827],[0.2278,0.856],[0.2557,0.884],[0.2557,0.913],[0.1544,0.941],[0.1671,0.97],[0.8987,0.97],[0.8658,0.941],[0.8633,0.913],[0.8582,0.884],[0.8759,0.856],[0.8532,0.827],[0.8456,0.799],[0.8405,0.77],[0.8304,0.742],[0.838,0.713],[0.8506,0.685],[0.919,0.656],[0.9468,0.627],[0.9747,0.599],[0.9899,0.57],[0.9873,0.542],[0.9696,0.513],[0.9468,0.485],[0.919,0.456],[0.8937,0.428],[0.8405,0.399],[0.8152,0.371],[0.7747,0.342],[0.8278,0.313],[0.8532,0.285],[0.8354,0.256],[0.8633,0.228],[0.8532,0.199],[0.8228,0.171],[0.8253,0.142],[0.8253,0.114],[0.8203,0.085],[0.7671,0.057],[0.7063,0.028]]},"bilal":{"aspect":0.34,"poly":[[0.2971,0.028],[0.2,0.057],[0.15,0.085],[0.1176,0.114],[0.1118,0.142],[0.1235,0.171],[0.1324,0.199],[0.1118,0.228],[0.1265,0.256],[0.1441,0.285],[0.1676,0.313],[0.2382,0.342],[0.2853,0.371],[0.3824,0.399],[0.2529,0.428],[0.1412,0.456],[0.1,0.485],[0.0676,0.513],[0.0353,0.542],[0.0265,0.57],[0.05,0.599],[0.0588,0.627],[0.0765,0.656],[0.1059,0.685],[0.1265,0.713],[0.1206,0.742],[0.1559,0.77],[0.2853,0.799],[0.2735,0.827],[0.2588,0.856],[0.2559,0.884],[0.2294,0.913],[0.2324,0.941],[0.1676,0.97],[0.9853,0.97],[0.8853,0.941],[0.8118,0.913],[0.7971,0.884],[0.8029,0.856],[0.8206,0.827],[0.8235,0.799],[0.8324,0.77],[0.8412,0.742],[0.8647,0.713],[0.8971,0.685],[0.9265,0.656],[0.9471,0.627],[0.9471,0.599],[0.9471,0.57],[0.95,0.542],[0.9206,0.513],[0.8941,0.485],[0.8559,0.456],[0.7265,0.428],[0.7235,0.399],[0.8147,0.371],[0.8647,0.342],[0.8824,0.313],[0.9559,0.285],[0.9735,0.256],[0.9882,0.228],[0.9471,0.199],[0.9529,0.171],[0.9618,0.142],[0.9647,0.114],[0.9235,0.085],[0.8824,0.057],[0.7765,0.028]]},"cem":{"aspect":0.342,"poly":[[0.2895,0.028],[0.1871,0.057],[0.1316,0.085],[0.1053,0.114],[0.0965,0.142],[0.0994,0.171],[0.0322,0.199],[0.0468,0.228],[0.0789,0.256],[0.1725,0.285],[0.193,0.313],[0.2398,0.342],[0.3246,0.371],[0.2749,0.399],[0.1199,0.428],[0.076,0.456],[0.0497,0.485],[0.0175,0.513],[0.0292,0.542],[0.0146,0.57],[0.0146,0.599],[0.0263,0.627],[0.0497,0.656],[0.0789,0.685],[0.0848,0.713],[0.0877,0.742],[0.152,0.77],[0.2544,0.799],[0.2427,0.827],[0.2222,0.856],[0.2222,0.884],[0.1959,0.913],[0.193,0.941],[0.1316,0.97],[0.9737,0.97],[0.8801,0.941],[0.8012,0.913],[0.7807,0.884],[0.7836,0.856],[0.7982,0.827],[0.8041,0.799],[0.8129,0.77],[0.8216,0.742],[0.8421,0.713],[0.8713,0.685],[0.9006,0.656],[0.924,0.627],[0.9357,0.599],[0.9211,0.57],[0.9035,0.542],[0.9181,0.513],[0.8889,0.485],[0.8655,0.456],[0.8129,0.428],[0.6579,0.399],[0.7485,0.371],[0.8158,0.342],[0.8509,0.313],[0.9123,0.285],[0.9503,0.256],[0.9825,0.228],[0.9883,0.199],[0.9386,0.171],[0.9386,0.142],[0.9298,0.114],[0.9035,0.085],[0.8509,0.057],[0.7456,0.028]]},"kemal":{"aspect":0.341,"poly":[[0.2727,0.028],[0.1818,0.057],[0.1232,0.085],[0.0968,0.114],[0.088,0.142],[0.0938,0.171],[0.1056,0.199],[0.0587,0.228],[0.0733,0.256],[0.1056,0.285],[0.1584,0.313],[0.1994,0.342],[0.2551,0.371],[0.3314,0.399],[0.2111,0.428],[0.1085,0.456],[0.0821,0.485],[0.0616,0.513],[0.0411,0.542],[0.0235,0.57],[0.0088,0.599],[0.0176,0.627],[0.0352,0.656],[0.0645,0.685],[0.0997,0.713],[0.0968,0.742],[0.1349,0.77],[0.261,0.799],[0.2522,0.827],[0.2317,0.856],[0.2287,0.884],[0.2053,0.913],[0.2053,0.941],[0.1408,0.97],[0.9648,0.97],[0.8798,0.941],[0.7947,0.913],[0.7742,0.884],[0.7801,0.856],[0.7947,0.827],[0.7977,0.799],[0.9413,0.77],[0.9824,0.742],[0.9824,0.713],[0.9736,0.685],[0.9736,0.656],[0.9531,0.627],[0.9443,0.599],[0.9296,0.57],[0.9003,0.542],[0.8856,0.513],[0.871,0.485],[0.8475,0.456],[0.7419,0.428],[0.6979,0.399],[0.7859,0.371],[0.8446,0.342],[0.868,0.313],[0.9355,0.285],[0.9619,0.256],[0.9765,0.228],[0.9208,0.199],[0.9355,0.171],[0.9326,0.142],[0.9238,0.114],[0.9003,0.085],[0.8475,0.057],[0.7537,0.028]]},"semih":{"aspect":0.339,"poly":[[0.2802,0.028],[0.1829,0.057],[0.1327,0.085],[0.1003,0.114],[0.0885,0.142],[0.0914,0.171],[0.1032,0.199],[0.0531,0.228],[0.0678,0.256],[0.1003,0.285],[0.1504,0.313],[0.1888,0.342],[0.2448,0.371],[0.3333,0.399],[0.1917,0.428],[0.1062,0.456],[0.0796,0.485],[0.0619,0.513],[0.0413,0.542],[0.0236,0.57],[0.0088,0.599],[0.0177,0.627],[0.0354,0.656],[0.0619,0.685],[0.1003,0.713],[0.0973,0.742],[0.1386,0.77],[0.2625,0.799],[0.2537,0.827],[0.236,0.856],[0.233,0.884],[0.2065,0.913],[0.2094,0.941],[0.1445,0.97],[0.9735,0.97],[0.8732,0.941],[0.7994,0.913],[0.7817,0.884],[0.7876,0.856],[0.8053,0.827],[0.8083,0.799],[0.8171,0.77],[0.826,0.742],[0.8466,0.713],[0.8938,0.685],[0.9263,0.656],[0.9469,0.627],[0.9558,0.599],[0.944,0.57],[0.9174,0.542],[0.8997,0.513],[0.882,0.485],[0.8555,0.456],[0.7522,0.428],[0.7286,0.399],[0.8142,0.371],[0.8673,0.342],[0.8909,0.313],[0.9528,0.285],[0.9764,0.256],[0.9912,0.228],[0.9351,0.199],[0.944,0.171],[0.9469,0.142],[0.9322,0.114],[0.9027,0.085],[0.8525,0.057],[0.7581,0.028]]},"tamer":{"aspect":0.382,"poly":[[0.267,0.028],[0.2147,0.057],[0.1728,0.085],[0.1545,0.114],[0.1518,0.142],[0.1204,0.171],[0.1204,0.199],[0.1361,0.228],[0.1728,0.256],[0.1885,0.285],[0.2199,0.313],[0.288,0.342],[0.2304,0.371],[0.1283,0.399],[0.0916,0.428],[0.0681,0.456],[0.0393,0.485],[0.0131,0.513],[0.0471,0.542],[0.0262,0.57],[0.0183,0.599],[0.0183,0.627],[0.0209,0.656],[0.0079,0.685],[0.0209,0.713],[0.0916,0.742],[0.1754,0.77],[0.1806,0.799],[0.212,0.827],[0.199,0.856],[0.2251,0.884],[0.2225,0.913],[0.1204,0.941],[0.1361,0.97],[0.9058,0.97],[0.8717,0.941],[0.8665,0.913],[0.8665,0.884],[0.8796,0.856],[0.8586,0.827],[0.8639,0.799],[0.8639,0.77],[0.8403,0.742],[0.8403,0.713],[0.8403,0.685],[0.8665,0.656],[0.9136,0.627],[0.9476,0.599],[0.9712,0.57],[0.9764,0.542],[0.966,0.513],[0.9738,0.485],[0.9398,0.456],[0.9058,0.428],[0.8691,0.399],[0.7723,0.371],[0.6728,0.342],[0.7304,0.313],[0.7618,0.285],[0.7749,0.256],[0.7827,0.228],[0.801,0.199],[0.7827,0.171],[0.7853,0.142],[0.7827,0.114],[0.7696,0.085],[0.7487,0.057],[0.6911,0.028]]},"zeynep":{"aspect":0.397,"poly":[[0.3073,0.028],[0.2166,0.057],[0.1637,0.085],[0.1259,0.114],[0.1008,0.142],[0.0806,0.171],[0.068,0.199],[0.0554,0.228],[0.0428,0.256],[0.0252,0.285],[0.0126,0.313],[0.0076,0.342],[0.0176,0.371],[0.0453,0.399],[0.0781,0.428],[0.0957,0.456],[0.0831,0.485],[0.0453,0.513],[0.1436,0.542],[0.136,0.57],[0.1259,0.599],[0.1259,0.627],[0.1385,0.656],[0.1537,0.685],[0.1562,0.713],[0.1511,0.742],[0.1889,0.77],[0.199,0.799],[0.1839,0.827],[0.2997,0.856],[0.2997,0.884],[0.2947,0.913],[0.2443,0.941],[0.1914,0.97],[0.8942,0.97],[0.8312,0.941],[0.738,0.913],[0.7154,0.884],[0.7254,0.856],[0.8161,0.827],[0.8463,0.799],[0.8237,0.77],[0.806,0.742],[0.8111,0.713],[0.801,0.685],[0.8262,0.656],[0.8615,0.627],[0.8816,0.599],[0.8715,0.57],[0.8463,0.542],[0.8539,0.513],[0.9219,0.485],[0.8866,0.456],[0.8892,0.428],[0.9118,0.399],[0.9446,0.371],[0.9723,0.342],[0.9874,0.313],[0.9924,0.285],[0.9874,0.256],[0.9748,0.228],[0.9547,0.199],[0.9345,0.171],[0.9169,0.142],[0.8942,0.114],[0.8615,0.085],[0.8161,0.057],[0.6977,0.028]]}};

// Positions in scene units; the back row is drawn first so the front row stands in front of it.
const placed = PEOPLE.map((p, i) => {
  const sil = SILHOUETTES[p.photo];
  const row = ROWS[p.row];
  const w = sil.aspect * row.height;
  return { p, i, sil, left: p.x - w / 2, top: row.floor - row.height, w, h: row.height, floor: row.floor };
}).sort((a, b) => (a.p.row === "front") - (b.p.row === "front") || a.p.x - b.p.x);

// ---------- "Ben geldim" ----------
// When a player of this photo logs in, or opens the site after being away for a while, everyone
// else on the home page sees their caricature with a "Ben geldim!" bubble for a few seconds.
// users/<key>/arrived = time of the arrival; seenAt = last time the site was open (see app.js).
const AWAY_MS = 10 * 60 * 1000;
const FRESH_MS = 30 * 1000; // arrivals older than this are not announced any more
const SHOW_MS = 5000;
const checked = new Set();
export const arrivalChecked = (key) => checked.has(key);

export async function checkArrival(key) {
  if (checked.has(key)) return;
  const member = PEOPLE.some((p) => p.user === key);
  await db.tx(`users/${key}`, (cur) => {
    if (!cur) return undefined;
    const now = db.now();
    if (member && (!cur.seenAt || now - cur.seenAt > AWAY_MS)) cur.arrived = now;
    cur.seenAt = now;
    return cur;
  }).catch(() => {});
  checked.add(key);
}

const announced = new Map(); // "<user>/<arrived>" -> time it stops showing
export function arrivals() {
  if (masking()) return nothing; // hidden players don't see real faces and names
  const now = db.now();
  const me = state.me?.key;
  for (const p of PEOPLE) {
    const at = state.users?.[p.user]?.arrived;
    const id = `${p.user}/${at}`;
    if (!at || p.user === me || announced.has(id) || now - at > FRESH_MS) continue;
    announced.set(id, now + SHOW_MS);
    setTimeout(rerender, SHOW_MS + 50);
  }
  const showing = PEOPLE.flatMap((p) => {
    const at = state.users?.[p.user]?.arrived;
    const until = announced.get(`${p.user}/${at}`);
    return until && until > now ? [{ p, leaving: until - now < 600 }] : [];
  });
  if (showing.some((s) => s.leaving)) setTimeout(rerender, 650);
  return showing.length
    ? html`<div class="mp-arrivals">
        ${showing.map(
          ({ p, leaving }) => html`<div class="mp-arrival ${leaving ? "leaving" : ""}">
            <img src=${img(p)} alt=${p.name} />
            <div class="bubble">${t("benGeldim")}<small>${p.name}</small></div>
          </div>`
        )}
      </div>`
    : nothing;
}

let hot = null; // index being hovered
let open = null; // index shown on the card

// Hover only touches classes, so the whole page doesn't redraw on every mouse move.
function setHot(i) {
  hot = i;
  document.querySelectorAll(".mp-fig").forEach((el) => el.classList.toggle("hot", Number(el.dataset.i) === i));
  const tag = document.querySelector(".mp-tag");
  if (!tag) return;
  const f = placed.find((x) => x.i === i);
  tag.classList.toggle("on", !!f);
  if (f) {
    tag.textContent = f.p.name;
    tag.style.left = `${f.left + f.w / 2}%`;
    tag.style.top = `${(Math.max(f.top - 0.5, 6) / 68) * 100}%`;
  }
}

const show = (i) => ((open = (i + PEOPLE.length) % PEOPLE.length), (hot = null), rerender());
const close = () => ((open = null), rerender());

window.addEventListener("keydown", (e) => {
  if (open === null) return;
  if (e.key === "Escape") close();
  if (e.key === "ArrowLeft") show(open - 1);
  if (e.key === "ArrowRight") show(open + 1);
});

const MOTTO_MAX = 120;
const RESULT = { win: "resWin", loss: "resLoss", draw: "resDraw", judge: "resJudge" };
const fmtDay = (ms) => new Date(ms).toLocaleDateString(getLang() === "tr" ? "tr-TR" : "en-GB", { day: "numeric", month: "long" });

// The player's own sentence (editable on their own card) and their last finished game.
function about(p) {
  const u = state.users?.[p.user] || {};
  const mine = !!p.user && state.me?.key === p.user;
  const save = (e) => {
    e.preventDefault();
    const motto = String(new FormData(e.target).get("motto") || "").trim().slice(0, MOTTO_MAX);
    db.update(`users/${p.user}`, { motto: motto || null });
  };
  const g = u.lastGame;
  return html`
    ${u.motto ? html`<p class="mp-motto">“${u.motto}”</p>` : mine ? nothing : html`<p class="hint">${t("noMotto")}</p>`}
    ${mine
      ? html`<form class="mp-motto-form" @submit=${save}>
          <input name="motto" maxlength=${MOTTO_MAX} placeholder=${t("mottoPh")} .value=${u.motto || ""} />
          <button class="small primary">✏️ ${t("mottoSave")}</button>
        </form>`
      : nothing}
    ${g
      ? html`<ul class="mp-last">
          <li><span>🎮 ${t("lastGame")}</span><b>${t(g.game)}</b><small>${fmtDay(g.t)}</small></li>
          <li><span>📊 ${t("lastResult")}</span><b>${t(RESULT[g.result] || "resDraw")}${g.score ? " " + g.score : ""}</b></li>
          <li><span>🆚 ${t("lastOpponent")}</span><b>${g.vs || "—"}</b></li>
        </ul>`
      : html`<p class="hint">${t("noLastGame")}</p>`}`;
}

function card() {
  if (open === null) return nothing;
  const p = PEOPLE[open];
  return html`<div class="overlay mp-overlay" @click=${close}>
    <div class="mp-card" @click=${(e) => e.stopPropagation()}>
      <div class="mp-pic"><img src=${img(p)} alt=${p.name} /></div>
      <div class="mp-body">
        <button class="mp-icon mp-close" aria-label=${t("close")} @click=${close}>✕</button>
        ${p.role ? html`<span class="mp-role">${p.role}</span>` : nothing}
        <h2>${p.name}</h2>
        ${about(p)}
        ${p.bio ? html`<p>${p.bio}</p>` : nothing}
        ${p.facts?.length ? html`<ul class="mp-facts">${p.facts.map((f) => html`<li>${f}</li>`)}</ul>` : nothing}
        <div class="mp-nav">
          <button class="mp-icon" aria-label=${t("prevPlayer")} @click=${() => show(open - 1)}>←</button>
          <button class="mp-icon" aria-label=${t("nextPlayer")} @click=${() => show(open + 1)}>→</button>
          <span>${open + 1} / ${PEOPLE.length}</span>
        </div>
      </div>
    </div>
  </div>`;
}

export function meetPlayers() {
  if (masking()) return nothing; // hidden players don't see real faces and names
  return html`<h2>👋 ${t("meetPlayers")}</h2>
    <div class="mp">
      <div class="mp-scene">
        ${placed.map(
          (f, n) => html`<div class="mp-fig ${hot === f.i ? "hot" : ""}" data-i=${f.i}
            style="--n:${n}; left:${f.left}%; bottom:${((68 - f.floor) / 68) * 100}%; width:${f.w}%;">
            <span class="mp-floor"></span><img src=${img(f.p)} alt=${f.p.name} draggable="false" />
          </div>`
        )}
        <svg class="mp-hits" viewBox="0 0 100 68" preserveAspectRatio="none" aria-hidden="true">
          ${placed.map(
            (f) => svg`<polygon
              points=${f.sil.poly.map(([x, y]) => `${(f.left + x * f.w).toFixed(2)},${(f.top + y * f.h).toFixed(2)}`).join(" ")}
              @mouseenter=${() => setHot(f.i)} @mouseleave=${() => setHot(null)} @click=${() => show(f.i)}></polygon>`
          )}
        </svg>
        <div class="mp-tag"></div>
      </div>
    </div>
    ${card()}`;
}
