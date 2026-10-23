// Questions come from Open Trivia DB (free, no key). Each question: {q, answers[4], correct, cat}
import { shuffle } from "../lib.js";

export const CATEGORIES = [
  [9, "General Knowledge", "Genel Kültür"],
  [21, "Sports", "Spor"],
  [22, "Geography", "Coğrafya"],
  [23, "History", "Tarih"],
  [17, "Science & Nature", "Bilim ve Doğa"],
  [11, "Film", "Sinema"],
  [12, "Music", "Müzik"],
  [14, "Television", "Televizyon"],
  [15, "Video Games", "Video Oyunları"],
  [18, "Computers", "Bilgisayar"],
  [19, "Mathematics", "Matematik"],
  [20, "Mythology", "Mitoloji"],
  [10, "Books", "Kitaplar"],
  [25, "Art", "Sanat"],
  [27, "Animals", "Hayvanlar"],
  [28, "Vehicles", "Taşıtlar"],
  [24, "Politics", "Siyaset"],
  [26, "Celebrities", "Ünlüler"],
  [16, "Board Games", "Masa Oyunları"],
  [29, "Comics", "Çizgi Roman"],
  [31, "Anime & Manga", "Anime ve Manga"],
  [32, "Cartoons", "Çizgi Film"],
];

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
