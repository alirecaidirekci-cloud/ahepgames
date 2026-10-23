// Footballer dataset + the question pool. Every question is answered automatically
// from the stored attributes, so the picker cannot make mistakes or lie.
import { getLang } from "../i18n.js";

let DATA = null;
let QUESTIONS = null;

export async function loadData() {
  if (!DATA) {
    DATA = await (await fetch("data/players.json")).json();
    DATA.byId = Object.fromEntries(DATA.players.map((p) => [p.id, p]));
    QUESTIONS = buildQuestions(DATA);
    QUESTIONS.byId = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));
  }
  return DATA;
}

export const players = () => DATA.players;
export const playerById = (id) => DATA.byId[id];
export const questions = () => QUESTIONS;
export const questionById = (id) => QUESTIONS.byId[id];
export const countryName = (id) => DATA.countries[id]?.[getLang()] || DATA.countries[id]?.en || id;
export const leagueName = (id) => DATA.leagues[id]?.[getLang()] || DATA.leagues[id]?.en || id;
export const clubName = (id) => DATA.clubs[id] || id;

export const photoUrl = (p, width = 250) =>
  "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(p.img) + "?width=" + width;

export const POSITIONS = ["GK", "DF", "MF", "FW"];
const POS_TEXT = {
  GK: { en: "a goalkeeper", tr: "kaleci" },
  DF: { en: "a defender", tr: "defans oyuncusu" },
  MF: { en: "a midfielder", tr: "orta saha oyuncusu" },
  FW: { en: "a forward / winger", tr: "forvet / kanat oyuncusu" },
};
export const posLabel = (code) =>
  ({ GK: { en: "Goalkeeper", tr: "Kaleci" }, DF: { en: "Defender", tr: "Defans" }, MF: { en: "Midfielder", tr: "Orta saha" }, FW: { en: "Forward", tr: "Forvet" } })[code][getLang()];

const CONTINENTS = {
  EU: { en: "Europe", tr: "Avrupa" },
  SA: { en: "South America", tr: "Güney Amerika" },
  AF: { en: "Africa", tr: "Afrika" },
  NA: { en: "North / Central America", tr: "Kuzey / Orta Amerika" },
  AS: { en: "Asia", tr: "Asya" },
  OC: { en: "Oceania", tr: "Okyanusya" },
};

// Each question: {id, cat, text() -> string, test(player) -> bool}
function buildQuestions(data) {
  const qs = [];
  const add = (id, cat, en, tr, test) => qs.push({ id, cat, text: () => (getLang() === "tr" ? tr() : en()), test });
  const count = (fn) => data.players.filter(fn).length;

  for (const [c, n] of Object.entries(CONTINENTS)) {
    if (count((p) => p.cont === c)) add("cont:" + c, "nat", () => `Is he from ${n.en}?`, () => `${n.tr} kıtasından mı?`, (p) => p.cont === c);
  }
  const countries = Object.keys(data.countries).sort((a, b) => count((p) => p.nat === b) - count((p) => p.nat === a));
  for (const c of countries) {
    add("nat:" + c, "nat", () => `Is he from ${countryName(c)}?`, () => `${countryName(c)} vatandaşı mı?`, (p) => p.nat === c);
  }

  const leagues = Object.keys(data.leagues).sort((a, b) => count((p) => p.leagues.includes(b)) - count((p) => p.leagues.includes(a)));
  for (const l of leagues) {
    add("league:" + l, "league", () => `Has he played in the ${leagueName(l)}?`, () => `Oynadığı ligler arasında ${leagueName(l)} var mı?`, (p) => p.leagues.includes(l));
  }

  const clubCounts = {};
  for (const p of data.players) for (const c of p.clubs) clubCounts[c] = (clubCounts[c] || 0) + 1;
  const clubs = Object.keys(clubCounts)
    .filter((c) => clubCounts[c] >= 5)
    .sort((a, b) => clubCounts[b] - clubCounts[a]);
  for (const c of clubs) {
    add("club:" + c, "club", () => `Has he played for ${clubName(c)}?`, () => `${clubName(c)} takımında oynadı mı?`, (p) => p.clubs.includes(c));
  }

  for (const pos of POSITIONS) {
    add("pos:" + pos, "career", () => `Is he ${POS_TEXT[pos].en}?`, () => `${cap(POS_TEXT[pos].tr)} mı?`, (p) => p.pos.includes(pos));
  }
  add("active", "career", () => "Is he still playing professionally?", () => "Hâlâ profesyonel olarak oynuyor mu?", (p) => p.active);
  add("dead", "career", () => "Has he passed away?", () => "Hayatını kaybetti mi?", (p) => p.dead);
  for (const y of [1960, 1970, 1980, 1985, 1990, 1995, 2000]) {
    add("born<" + y, "career", () => `Was he born before ${y}?`, () => `${y} yılından önce mi doğdu?`, (p) => p.born < y);
  }
  add("clubs5", "career", () => "Has he played for 5 or more clubs?", () => "5 veya daha fazla kulüpte oynadı mı?", (p) => p.clubs.length >= 5);

  for (const h of [175, 180, 185, 190]) {
    add("h>=" + h, "look", () => `Is he ${h} cm or taller?`, () => `Boyu ${h} cm veya daha uzun mu?`, (p) => (p.height || 0) >= h);
  }
  const hair = {
    d: ["Does he have dark (black/brown) hair?", "Saçları koyu (siyah/kahverengi) mu?"],
    b: ["Does he have blond or light hair?", "Saçları sarı/açık renk mi?"],
    r: ["Does he have red/ginger hair?", "Saçları kızıl mı?"],
    g: ["Does he have grey/white hair?", "Saçları gri/beyaz mı?"],
    x: ["Is he bald or does he shave his head?", "Kel mi ya da saçlarını kazıtıyor mu?"],
  };
  for (const [k, [en, tr]] of Object.entries(hair)) add("hair:" + k, "look", () => en, () => tr, (p) => p.hair === k);
  add("beard", "look", () => "Does he usually have a beard?", () => "Genelde sakallı mı?", (p) => p.beard);
  const skin = {
    l: ["Does he have a light skin tone?", "Ten rengi açık mı?"],
    m: ["Does he have a medium/olive skin tone?", "Ten rengi buğday mı?"],
    d: ["Does he have a dark skin tone?", "Ten rengi koyu mu?"],
  };
  for (const [k, [en, tr]] of Object.entries(skin)) add("skin:" + k, "look", () => en, () => tr, (p) => p.skin === k);

  add("wc", "award", () => "Has he won the World Cup?", () => "Dünya Kupası kazandı mı?", (p) => p.wc);
  add("ballon", "award", () => "Has he won the Ballon d'Or?", () => "Ballon d'Or kazandı mı?", (p) => p.ballon);
  return qs;
}

const cap = (s) => s[0].toLocaleUpperCase("tr") + s.slice(1);

// Players still possible given the answered questions and wrong guesses.
export function candidates(log) {
  return DATA.players.filter((p) =>
    log.every((e) => (e.kind === "q" ? questionById(e.qid).test(p) === e.ans : e.ok || e.pid !== p.id))
  );
}
