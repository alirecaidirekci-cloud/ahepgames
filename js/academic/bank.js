// Academic question bank: built-in questions (data/academic/<subject>.json) plus questions
// friends add on the website (database: academic/questions), minus hidden ones (academic/hidden).
// Built-in file rows: [difficulty e|m|h, en question, en right, en wrong x3, tr question, tr right, tr wrong x3]
// A built-in question's id is "<subject>-<row number>", so add new rows at the end of a file
// (reports and hidden flags refer to these ids).
import { db } from "../db.js";
import { getLang } from "../i18n.js";
import { shuffle } from "../lib.js";

export const SUBJECTS = [
  ["business", "Business Administration", "İşletme"],
  ["trade", "International Trade & Logistics", "Uluslararası Ticaret ve Lojistik"],
  ["tourism", "Tourism Management", "Turizm İşletmeciliği"],
  ["communication", "Communication", "İletişim"],
  ["economics", "Economics", "İktisat"],
  ["statistics", "Statistics", "İstatistik"],
  ["econometrics", "Econometrics", "Ekonometri"],
];
export const subjectName = (key) => {
  const s = SUBJECTS.find((x) => x[0] === key);
  return s ? (getLang() === "tr" ? s[2] : s[1]) : key;
};
const DIFF = { e: "easy", m: "medium", h: "hard" };

let builtIn = null;

// All built-in questions as {id, s, diff, en: {q, a[4]}, tr: {q, a[4]}} with the right answer first.
export async function loadBuiltIn() {
  if (!builtIn) {
    const files = await Promise.all(SUBJECTS.map(([key]) => fetch(`data/academic/${key}.json`).then((r) => r.json())));
    builtIn = files.flatMap((rows, i) =>
      rows.map((r, n) => ({
        id: `${SUBJECTS[i][0]}-${n + 1}`,
        s: SUBJECTS[i][0],
        diff: DIFF[r[0]],
        en: { q: r[1], a: r.slice(2, 6) },
        tr: { q: r[6], a: r.slice(7, 11) },
      }))
    );
  }
  return builtIn;
}

// Built-in + added questions that are not hidden.
export async function loadAll() {
  // The database parts are optional: if they cannot be read (e.g. rules not updated yet), use built-in only.
  const optional = (path) => db.get(path).catch(() => null);
  const [base, added, hidden] = await Promise.all([loadBuiltIn(), optional("academic/questions"), optional("academic/hidden")]);
  const extra = Object.entries(added || {}).map(([id, q]) => ({ ...q, id: "c-" + id }));
  return [...base, ...extra].filter((q) => !hidden?.[q.id]);
}

export const countBySubject = (questions) =>
  Object.fromEntries(SUBJECTS.map(([key]) => [key, questions.filter((q) => q.s === key).length]));

// Picks `count` questions for each team from its own subjects, never repeating a question.
// Answer order is shuffled once so every player sees the same order in both languages.
export function buildQueues(questions, subjects, count) {
  const used = new Set();
  const queues = {};
  for (const team of ["A", "B"]) {
    const pool = shuffle(questions.filter((q) => subjects[team].includes(q.s) && !used.has(q.id)));
    queues[team] = pool.slice(0, count).map((q) => {
      used.add(q.id);
      const order = shuffle([0, 1, 2, 3]);
      const side = (x) => (x?.q ? { q: x.q, a: order.map((i) => x.a[i]) } : null);
      return { id: q.id, s: q.s, diff: q.diff, en: side(q.en), tr: side(q.tr), correct: order.indexOf(0) };
    });
  }
  return queues;
}

// Question text in the viewer's language, falling back to the other one.
export const localized = (q) => (getLang() === "tr" ? q.tr || q.en : q.en || q.tr);
