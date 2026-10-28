// Admin console (#/admin, only for admins.js ADMINS): sign-up approvals, every user's last visit, and
// per-player switches (hidden, alias, sees everyone hidden, Meet the Players, welcome screen) stored
// in settings/players/<key> (see admins.js), plus password reset and deleting a user.
// Always shows real names (state.usersRaw), even though admins never see masked names anyway.
import { state, setUi, whereText } from "./app.js";
import { db } from "./db.js";
import { t, getLang } from "./i18n.js";
import { html, nothing } from "./lib.js";
import * as admins from "./admins.js";

const ONLINE_MS = 75 * 1000; // same as app.js
const users = () => state.usersRaw || state.users || {};
const lastSeen = (u) => Math.max(u.lastActive || 0, u.seenAt || 0, u.lastSeen || 0);
const isOnline = (u) => !!u.lastActive && db.now() - u.lastActive < ONLINE_MS;
const fmtDate = (ms) =>
  new Date(ms).toLocaleString(getLang() === "tr" ? "tr-TR" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function ago(ms) {
  const min = Math.floor((db.now() - ms) / 60000);
  if (min < 1) return t("agoNow");
  if (min < 60) return t("agoMin", { n: min });
  if (min < 24 * 60) return t("agoHour", { n: Math.floor(min / 60) });
  return t("agoDay", { n: Math.floor(min / 1440) });
}

export const pendingSignups = () =>
  Object.entries(users())
    .filter(([, u]) => u?.pending)
    .map(([key, u]) => ({ key, ...u }))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

// [switch, label key] — "on" means the switch is ticked on the console
const SWITCHES = [
  ["hidden", "swHidden"],
  ["alias", "swAlias"],
  ["seesMasked", "swMasked"],
  ["meet", "swMeet"],
  ["welcome", "swWelcome"],
];
function isOn(ps, sw) {
  if (sw === "alias") return !!ps.alias;
  if (sw === "meet") return !ps.noMeet;
  if (sw === "welcome") return !ps.noWelcome;
  return !!ps[sw];
}
function toggle(key, sw, on) {
  const patch =
    sw === "alias" ? { alias: on ? admins.nextAlias() : null }
    : sw === "meet" ? { noMeet: on ? null : true }
    : sw === "welcome" ? { noWelcome: on ? null : true }
    : { [sw]: on || null };
  return db.update(`settings/players/${key}`, patch);
}

const confirm = (text, yes) => setUi({ confirm: { text, yes } });

function pendingSection() {
  const list = pendingSignups();
  const approve = (key) => db.update(`users/${key}`, { pending: null });
  const reject = (u) => confirm(t("signupRejectConfirm", { name: u.name }), () => db.set(`users/${u.key}`, null));
  return html`<h3>🆕 ${t("signupsTitle")} (${list.length})</h3>
    ${list.length
      ? html`<div class="room-list">
          ${list.map(
            (u) => html`<div class="card room-item">
              <b>${u.name}</b><span class="hint">${u.createdAt ? fmtDate(u.createdAt) : ""}</span>
              <button class="small primary" @click=${() => approve(u.key)}>✅ ${t("approve")}</button>
              <button class="small" @click=${() => reject(u)}>✖ ${t("reject")}</button>
            </div>`
          )}
        </div>`
      : html`<p class="hint">${t("noSignups")}</p>`}`;
}

function userCard(u) {
  const ps = admins.playerSettings(u.key);
  const admin = admins.ADMINS.includes(u.key);
  const seen = lastSeen(u);
  const resetPw = () => confirm(t("resetPwConfirm", { name: u.name }), () => db.update(`users/${u.key}`, { pw: null }));
  const remove = () =>
    confirm(t("deleteUserConfirm", { name: u.name }), async () => {
      for (const path of [`users/${u.key}`, `scores/${u.key}`, `medals/${u.key}`, `settings/players/${u.key}`]) await db.set(path, null);
    });
  return html`<div class="card adm-user ${isOnline(u) ? "online" : ""}">
    <div class="adm-head">
      <b>${u.name}</b>
      ${ps.alias ? html`<span class="pill">🎭 ${ps.alias}</span>` : nothing}
      ${admin ? html`<span class="pill">🛡️ ${t("adminSelf")}</span>` : nothing}
      <span class="adm-seen">
        ${isOnline(u)
          ? html`<b class="adm-on">🟢 ${t("onlineShortNow")}</b> · ${whereText(u.where)}`
          : seen
            ? html`${t("lastSeenAgo", { ago: ago(seen) })} · <small>${fmtDate(seen)}</small>`
            : t("neverSeen")}
      </span>
    </div>
    <small class="hint">${u.createdAt ? t("signedUp", { date: fmtDate(u.createdAt) }) : ""}</small>
    ${admin
      ? nothing
      : html`<div class="adm-switches">
            ${SWITCHES.map(
              ([sw, label]) => html`<label class="adm-sw ${isOn(ps, sw) ? "on" : ""}">
                <input type="checkbox" .checked=${isOn(ps, sw)} @change=${(e) => toggle(u.key, sw, e.target.checked)} />
                ${t(label)}
              </label>`
            )}
          </div>
          <div class="row adm-actions">
            <button class="small" ?disabled=${!u.pw} @click=${resetPw}>🔑 ${u.pw ? t("resetPw") : t("noPw")}</button>
            <button class="small danger" @click=${remove}>🗑️ ${t("deleteUser")}</button>
          </div>`}
  </div>`;
}

export function view() {
  if (!admins.isAdmin(state.me)) return html`<p>404 · <a href="#/">${t("back")}</a></p>`;
  const list = Object.entries(users())
    .filter(([, u]) => u && !u.pending)
    .map(([key, u]) => ({ key, ...u }))
    .sort((a, b) => isOnline(b) - isOnline(a) || lastSeen(b) - lastSeen(a));
  return html`
    <a href="#/" class="back">${t("back")}</a>
    <h2>🛡️ ${t("adminConsole")}</h2>
    ${pendingSection()}
    <h3>👥 ${t("adminPlayers")} (${list.length})</h3>
    <details class="card adm-legend">
      <summary>ℹ️ ${t("adminLegendTitle")}</summary>
      <ul>
        ${SWITCHES.map(([, label]) => html`<li><b>${t(label)}:</b> ${t(label + "Hint")}</li>`)}
      </ul>
    </details>
    <div class="adm-list">${list.map(userCard)}</div>
  `;
}
