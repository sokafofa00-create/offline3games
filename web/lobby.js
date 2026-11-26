// LAN lobby: waiting room with online players, chat and "match created" cards.
import { createLan } from "./lan.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const GAME_LABEL = { pool: "البلياردو", monsters: "Match Monsters", brawlbots: "Brawlbots" };

export function initLobby({ getName, buildMatch, onMatchCreated, onJoinCard }) {
  let lan = null;
  let peers = [];
  let me = { id: "", name: "" };
  const seenCards = new Set();
  const myId = (() => { let v = localStorage.getItem("lan-id"); if (!v) { v = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); localStorage.setItem("lan-id", v); } return v; })();
  const chat = $("lobby-chat");

  const addMsg = (html, cls = "") => { const d = document.createElement("div"); d.className = "lobby-msg " + cls; d.innerHTML = html; chat.appendChild(d); chat.scrollTop = chat.scrollHeight; return d; };
  const renderPeers = () => {
    $("lobby-count").textContent = peers.length ? `${peers.length} متصل` : "لا أحد متصل";
    const box = $("lobby-players");
    box.innerHTML = peers.length ? peers.map((p) => `<span class="peer-chip ${p.state === "playing" ? "busy" : ""}"><i></i>${esc(p.name)}<small>${p.state === "playing" ? "في مباراة" : "متاح"}</small></span>`).join("") : '<span class="lobby-empty">لا يوجد أحد متصل الآن. افتح التطبيق على جهاز آخر في نفس الشبكة.</span>';
    $("lobby-me").textContent = `${me.name || getName()}${me.ip ? " · " + me.ip : ""}`;
  };
  const addCard = (m, mine) => {
    if (seenCards.has(m.matchId)) return;
    seenCards.add(m.matchId);
    const who = mine ? "أنت" : esc(m.name || "لاعب");
    const el = addMsg(`<div class="match-card"><b>${GAME_LABEL[m.game] || esc(m.game)}</b><span>${who} أنشأ مباراة</span>${mine ? '<em>بانتظار لاعب آخر…</em>' : '<button type="button" class="join-btn">انضم</button>'}</div>`, mine ? "mine" : "");
    const btn = el.querySelector(".join-btn");
    if (btn) btn.onclick = () => { btn.disabled = true; btn.textContent = "جارٍ الانضمام…"; onJoinCard(m, lan, peers); };
  };
  const onMessage = (m) => {
    if (m.t === "chat") addMsg(`<span class="who">${esc(m.name || "لاعب")}</span> ${esc(m.text).slice(0, 500)}`);
    else if (m.t === "match") addCard(m, false);
    else if (m.t === "join" || m.t === "lan") api.onNet && api.onNet(m);
  };
  const api = {
    onNet: null,
    get lan() { return lan; },
    async open() {
      if (lan) return;
      me = { id: myId, name: getName() };
      lan = createLan({ id: myId, name: me.name, onPeers: (p, m) => { peers = p; me = { ...me, ...m }; renderPeers(); }, onMessage });
      await lan.start();
      renderPeers();
    },
    close() { if (lan) { lan.stop(); lan = null; } peers = []; },
    setState(s) { if (lan) lan.setState(s); },
  };
  const send = async () => {
    const inp = $("lobby-input"); const text = inp.value.trim(); if (!text || !lan) return; inp.value = "";
    addMsg(`<span class="who me">أنت</span> ${esc(text).slice(0, 500)}`, "mine");
    await lan.broadcast({ t: "chat", text });
  };
  $("lobby-send").onclick = send;
  $("lobby-input").addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  $("lobby-games-btn").onclick = () => $("lobby-games-menu").classList.toggle("hidden");
  document.querySelectorAll("#lobby-games-menu [data-lobby-game]").forEach((b) => {
    b.onclick = async () => {
      $("lobby-games-menu").classList.add("hidden");
      if (!lan) return;
      const game = b.getAttribute("data-lobby-game");
      const card = { t: "match", matchId: myId + "-" + Date.now().toString(36), game, settings: buildMatch(game), hostId: myId, hostIp: lan.me.ip };
      addCard({ ...card, name: me.name }, true);
      const n = await lan.broadcast(card);
      if (!n) addMsg('<span class="lobby-empty">لم يصل الإشعار لأحد: لا يوجد لاعب متصل.</span>');
      onMatchCreated(card, lan);
    };
  });
  return api;
}
