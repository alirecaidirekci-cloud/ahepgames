// Questions come from Open Trivia DB (free, no key). Each question: {q, answers[10], correct, cat}
import { shuffle } from "../lib.js";

// [id, English name, Turkish name, number of multiple-choice questions (counted October 2026)]
export const CATEGORIES = [
  [9, "General Knowledge", "Genel Kültür", 380],
  [21, "Sports", "Spor", 160],
  [22, "Geography", "Coğrafya", 320],
  [23, "History", "Tarih", 356],
  [17, "Science & Nature", "Bilim ve Doğa", 250],
  [11, "Film", "Sinema", 268],
  [12, "Music", "Müzik", 439],
  [14, "Television", "Televizyon", 173],
  [15, "Video Games", "Video Oyunları", 1018],
  [18, "Computers", "Bilgisayar", 149],
  [19, "Mathematics", "Matematik", 61],
  [20, "Mythology", "Mitoloji", 58],
  [10, "Books", "Kitaplar", 109],
  [25, "Art", "Sanat", 50],
  [27, "Animals", "Hayvanlar", 69],
  [28, "Vehicles", "Taşıtlar", 69],
  [24, "Politics", "Siyaset", 53],
  [26, "Celebrities", "Ünlüler", 48],
  [16, "Board Games", "Masa Oyunları", 66],
  [29, "Comics", "Çizgi Roman", 74],
  [31, "Anime & Manga", "Anime ve Manga", 177],
  [32, "Cartoons", "Çizgi Film", 97],
];

export const poolSize = (ids) => CATEGORIES.filter((c) => ids.includes(c[0])).reduce((sum, c) => sum + c[3], 0);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchCategory(cat, amount) {
  // The API allows one request per 5 seconds per IP and fails when a category has too few questions.
  for (let attempt = 0; attempt < 4 && amount > 0; attempt++) {
    const res = await fetch(`https://opentdb.com/api.php?amount=${amount}&category=${cat}&type=multiple&encode=url3986`);
    const body = await res.json();
    if (body.response_code === 0) return body.results;
    if (body.response_code === 1) amount = Math.floor(amount / 2);
    await sleep(5200);
  }
  return [];
}

export const OPTIONS = 10;

export async function loadQuestions(cats, total) {
  // Fetch extra questions: the unused ones still supply wrong answers for the others.
  const per = Math.min(50, Math.max(30, Math.ceil(total / cats.length) + 2));
  const d = decodeURIComponent;
  let all = [];
  for (let i = 0; i < cats.length; i++) {
    if (i > 0) await sleep(5200);
    const got = await fetchCategory(cats[i], per);
    all = all.concat(
      got.map((r) => ({ q: d(r.question), correct: d(r.correct_answer), wrong: r.incorrect_answers.map(d), cat: cats[i] }))
    );
  }
  all = shuffle(all);
  return all.slice(0, total).map((r) => {
    const answers = shuffle([r.correct, ...r.wrong, ...extraWrong(r, all, OPTIONS - 1 - r.wrong.length)]);
    return { q: r.q, answers, correct: answers.indexOf(r.correct), cat: r.cat };
  });
}

// Open Trivia DB gives 3 wrong answers; the rest are made up here.
// Numbers get nearby numbers; text answers borrow similar-looking answers from other questions.
function extraWrong(r, all, n) {
  const taken = new Set([r.correct, ...r.wrong].map((a) => a.toLowerCase()));
  const out = [];
  const add = (a) => {
    if (out.length < n && a && !taken.has(String(a).toLowerCase())) {
      taken.add(String(a).toLowerCase());
      out.push(String(a));
    }
  };
  if (/^-?\d+$/.test(r.correct)) {
    const v = Number(r.correct);
    const isYear = v >= 1000 && v <= 2100;
    for (let tries = 0; out.length < n && tries < 200; tries++) {
      const spread = isYear ? 15 : Math.max(3, Math.round(Math.abs(v) * 0.6));
      const c = v + Math.round((Math.random() * 2 - 1) * spread);
      if (c !== v && (v < 0 || c >= 0)) add(c);
    }
  }
  const shape = (a) => [/^-?\d+$/.test(a), a.split(/\s+/).length, a.length];
  const [num, words, len] = shape(r.correct);
  const score = (a) => {
    const [n2, w2, l2] = shape(a);
    return (n2 === num ? 0 : 100) + Math.abs(w2 - words) * 5 + Math.abs(l2 - len) / 3 + Math.random() * 6;
  };
  for (const pool of [all.filter((x) => x.cat === r.cat && x !== r), all.filter((x) => x !== r)]) {
    const candidates = pool.flatMap((x) => [x.correct, ...x.wrong]).map((a) => [score(a), a]);
    for (const [, a] of candidates.sort((x, y) => x[0] - y[0])) add(a);
  }
  return out;
}
