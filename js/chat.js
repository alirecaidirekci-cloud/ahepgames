// Room chat for the football games: a box under the game screen (not a pop-up), in the lobby,
// during the game and on the results screen. Messages live in rooms/<game>/<code>/chat/<id>, so they
// are deleted together with the room. Players and spectators can write; spectators get a 👀 mark.
import { state } from "./app.js";
import { db } from "./db.js";
import { t } from "./i18n.js";
import { html, nothing, isSpectator } from "./lib.js";

export const MAX_LEN = 200;
const KEEP = 100; // older messages are removed
const QUICK = ["😂", "👏", "🔥", "😡", "⚽"];

const messages = (room) =>
  Object.entries(room?.chat || {})
    .map(([id, m]) => ({ id, ...m }))
    .sort((a, b) => a.t - b.t);

async function send(game, room, text) {
  text = String(text || "").trim().slice(0, MAX_LEN);
  if (!text || !state.me || state.room?.code !== room.code) return;
  const me = state.me;
  const id = db.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await db.set(`rooms/${game}/${room.code}/chat/${id}`, {
    k: me.key,
    n: me.name,
    text,
    t: db.now(),
    ...(isSpectator(room, me.key) ? { w: true } : {}),
  });
  const old = messages(state.room).slice(0, -KEEP);
  for (const m of old) db.set(`rooms/${game}/${room.code}/chat/${m.id}`, null);
}

// Keeps the list scrolled to the newest message when one arrives.
let lastCount = 0;
function stickToBottom(count) {
  if (count === lastCount) return;
  lastCount = count;
  requestAnimationFrame(() => {
    const el = document.querySelector(".chat-list");
    if (el) el.scrollTop = el.scrollHeight;
  });
}

const fmtClock = (ms) => {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
};

// hide(room, text) -> true while a message must stay hidden (Futbolcuyu Bul: it names the secret footballer).
export function chatBox(game, room, hide) {
  if (!room || !state.me) return nothing;
  const me = state.me.key;
  const list = messages(room);
  stickToBottom(list.length);
  const submit = (e) => {
    e.preventDefault();
    const input = e.target.elements.msg;
    send(game, room, input.value);
    input.value = "";
  };
  return html`<div class="card chat">
    <h3>💬 ${t("chatTitle")}</h3>
    <div class="chat-list">
      ${list.length
        ? list.map((m) => {
            const hidden = m.k !== me && hide?.(room, m.text);
            return html`<div class="chat-msg ${m.k === me ? "mine" : ""}">
              <small>${fmtClock(m.t)}</small>
              <b>${m.w ? "👀 " : ""}${m.n}</b>
              ${hidden ? html`<span class="chat-hidden">🙈 ${t("chatHidden")}</span>` : html`<span>${m.text}</span>`}
            </div>`;
          })
        : html`<p class="hint">${t("chatEmpty")}</p>`}
    </div>
    <div class="chat-quick">
      ${QUICK.map((e) => html`<button type="button" class="small" @click=${() => send(game, room, e)}>${e}</button>`)}
    </div>
    <form class="chat-form" @submit=${submit}>
      <input name="msg" maxlength=${MAX_LEN} autocomplete="off" placeholder=${t("chatPh")} />
      <button class="primary">${t("chatSend")}</button>
    </form>
  </div>`;
}
