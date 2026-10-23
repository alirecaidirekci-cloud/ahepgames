// Questions come from Open Trivia DB (free, no key). Each question: {q, answers[4], correct, cat}
import { shuffle } from "../lib.js";

// [id, English name, Turkish name, number of 4-option questions (counted October 2026)]
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

export async function loadQuestions(cats, total) {
  const per = Math.ceil(total / cats.length) + 2;
  let all = [];
  for (let i = 0; i < cats.length; i++) {
    if (i > 0) await sleep(5200);
    all = all.concat((await fetchCategory(cats[i], Math.min(50, per))).map((r) => ({ ...r, catId: cats[i] })));
  }
  const d = decodeURIComponent;
  return shuffle(all)
    .slice(0, total)
    .map((r) => {
      const answers = shuffle([r.correct_answer, ...r.incorrect_answers].map(d));
      return { q: d(r.question), answers, correct: answers.indexOf(d(r.correct_answer)), cat: r.catId };
    });
}
