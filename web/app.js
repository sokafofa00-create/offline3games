import { preloadGameBundle, launchPlatoOfflineSession } from "./runtime/plato-bridge.js";
import { startBots } from "./bots.js";
import { initLobby } from "./lobby.js";

const GAMES = {
  pool: {
    id: "7c5d2aa05094dbee8753108c59f617b2f4b1e7ae",
    titleAr: "البلياردو",
  },
  monsters: {
    id: "5470e3f408f5869a8a853c580878c101400906a5",
    titleAr: "Match Monsters",
  },
  brawlbots: {
    id: "ae765a3baaa799266c501acf673b10a5b0000e92",
    titleAr: "Brawlbots",
  },
};

const SEAT_COLORS = ["#0ea5e9", "#f43f5e", "#10b981", "#f59e0b"];

// Cached preloaded game bundles so Rematch starts in 0ms!
const bundleCache = new Map();

let selectedGameKey = "pool";
let activeSession = null;
let lastLaunchParams = null;

// DOM Elements
const setupScreen = document.getElementById("setup-screen");
const gameScreen = document.getElementById("game-screen");
const gameTabs = document.querySelectorAll(".game-tab");
const poolOptions = document.getElementById("pool-options");
const monstersOptions = document.getElementById("monsters-options");
const brawlbotsOptions = document.getElementById("brawlbots-options");

const poolGameTypeEl = document.getElementById("pool-gametype");
const poolLiveEl = document.getElementById("pool-live");
const poolScoringEl = document.getElementById("pool-scoring");
const poolBreakEl = document.getElementById("pool-break");
const appLangEl = document.getElementById("app-lang");
const mmRulesEl = document.getElementById("mm-rules");
const mmLiveEl = document.getElementById("mm-live");
const bbPlayersEl = document.getElementById("bb-players");

const p3Wrap = document.getElementById("p3-wrap");
const p4Wrap = document.getElementById("p4-wrap");
const pInputs = [
  document.getElementById("p1-name"),
  document.getElementById("p2-name"),
  document.getElementById("p3-name"),
  document.getElementById("p4-name"),
];

const startBtn = document.getElementById("start-btn");
const playModeEl = document.getElementById("play-mode");
const difficultyBox = document.getElementById("difficulty-box");
const botDifficultyEl = document.getElementById("bot-difficulty");
const modeBox = document.getElementById("mode-box");
const setupCard = document.getElementById("setup-card");
const modeTabs = document.querySelectorAll(".mode-tab");
const lobbyDefaults = (game) => {
  const saved = selectedGameKey; selectedGameKey = game;
  // LAN matches are one player per device: use the first (two-player) option of each game.
  const st = game === "pool" ? { gameType: Number(poolGameTypeEl.options[0].value), live: Number(poolLiveEl.value), trickShots: Number(poolScoringEl.value), break: Number(poolBreakEl.value) } : buildGameSettings();
  if (game === "brawlbots") st.players = Number(bbPlayersEl.options[0].value);
  selectedGameKey = saved; return st;
};
let lanChan = null;
let pendingHost = null;
let pendingJoin = null;
function leaveLan() {
  lanChan = null; pendingHost = null; pendingJoin = null;
  if (window.__LOBBY__ && window.__LOBBY__.lan) { window.__LOBBY__.lan.fast(false); window.__LOBBY__.setState("available"); }
}
// Reliable ordered channel to one peer: chunks big frames, queues frames that arrive before the game session is ready.
function makeChannel(lan, peer, matchId) {
  const q = []; let handler = null; let chain = Promise.resolve(); const chunks = new Map();
  return {
    send(msg) {
      const str = JSON.stringify(msg); const id = Math.random().toString(36).slice(2); const N = 30000; const n = Math.max(1, Math.ceil(str.length / N));
      for (let i = 0; i < n; i++) { const frame = { t: "lan", m: matchId, c: id, i, n, d: str.slice(i * N, (i + 1) * N) }; chain = chain.then(() => lan.sendTo(peer, frame)).catch(() => {}); }
    },
    onRecv(cb) { handler = cb; q.splice(0).forEach(cb); },
    feed(m) {
      if (m.m !== matchId || m.c === undefined) return;
      let e = chunks.get(m.c); if (!e) { e = { n: m.n, parts: [], got: 0 }; chunks.set(m.c, e); }
      if (e.parts[m.i] === undefined) { e.parts[m.i] = m.d; e.got++; }
      if (e.got === e.n) { chunks.delete(m.c); const obj = JSON.parse(e.parts.join("")); if (handler) handler(obj); else q.push(obj); }
    },
  };
}
function startLanMatch(role, card, names, peer, lan) {
  const ch = makeChannel(lan, peer, card.matchId); lanChan = ch;
  const params = {
    gameId: GAMES[card.game].id, settings: card.settings, playerNames: names, language: "ar", mode: "lan", botSeats: [], difficulty: "medium", gameKey: card.game,
    lan: { role, seat: role === "host" ? 0 : 1, guestSeat: 1, send: ch.send, onRecv: ch.onRecv },
  };
  lastLaunchParams = params;
  lan.fast(true); window.__LOBBY__.setState("playing");
  window.__LAN_PARAMS__ = { role, game: card.game, names };
  startMatch(params);
}
const lobby = initLobby({
  getName: () => document.getElementById("p1-name").value.trim() || "اللاعب 1",
  buildMatch: lobbyDefaults,
  onMatchCreated: (card) => { pendingHost = { card, taken: false }; },
  onJoinCard: (card, lan, peers) => {
    const peer = peers.find((p) => p.id === card.hostId) || { id: card.hostId, ip: card.hostIp };
    pendingJoin = { card, peer };
    lan.sendTo(peer, { t: "join", matchId: card.matchId });
  },
});
window.__LOBBY__ = lobby;
lobby.onNet = (m) => {
  const lan = lobby.lan; if (!lan) return;
  if (m.t === "join") {
    if (!pendingHost || pendingHost.taken || m.matchId !== pendingHost.card.matchId) return;
    pendingHost.taken = true;
    const peer = lobby.peers.find((p) => p.id === m.from) || { id: m.from, ip: "" };
    const hostName = document.getElementById("p1-name").value.trim() || "اللاعب 1";
    const names = [hostName, m.name || "اللاعب 2"];
    startLanMatch("host", pendingHost.card, names, peer, lan);
    lan.sendTo(peer, { t: "lan", k: "go", matchId: pendingHost.card.matchId, names });
  } else if (m.t === "lan") {
    if (m.k === "go") {
      if (pendingJoin && m.matchId === pendingJoin.card.matchId) { const pj = pendingJoin; pendingJoin = null; startLanMatch("guest", pj.card, m.names, pj.peer, lan); }
    } else if (lanChan) lanChan.feed(m);
  }
};
function setPlayMode(mode) {
  playModeEl.value = mode;
  modeTabs.forEach((t) => t.classList.toggle("selected", t.dataset.mode === mode));
  setupCard.classList.remove("mode-hotseat", "mode-bot", "mode-lan");
  setupCard.classList.add("mode-" + mode);
  difficultyBox.classList.toggle("hidden", mode !== "bot");
  if (mode === "lan") lobby.open(); else lobby.close();
}
modeTabs.forEach((t) => t.addEventListener("click", () => setPlayMode(t.dataset.mode)));
let activeBots = null;
const loadingBox = document.getElementById("loading-box");
const progressFill = document.getElementById("progress-fill");
const loadingText = document.getElementById("loading-text");

const menuBtn = document.getElementById("menu-btn");
const muteBtn = document.getElementById("mute-btn");
const switchSeatBtn = document.getElementById("switch-seat-btn");
const turnDot = document.getElementById("turn-dot");
const turnText = document.getElementById("turn-text");
const gameOverBar = document.getElementById("gameover-bar");
const rematchBtn = document.getElementById("rematch-btn");
const passCover = document.getElementById("pass-cover");
const passCoverTitle = document.getElementById("pass-cover-title");
const passCoverDot = document.getElementById("pass-cover-dot");
const passCoverBtn = document.getElementById("pass-cover-btn");
const backSetupBtn = document.getElementById("back-setup-btn");

const menuBackdrop = document.getElementById("menu-backdrop");
const closeMenuBtn = document.getElementById("close-menu-btn");
const gameMenuItemsEl = document.getElementById("game-menu-items");
const menuRematchBtn = document.getElementById("menu-rematch-btn");
const menuExitBtn = document.getElementById("menu-exit-btn");

function getRequiredPlayerCount() {
  if (selectedGameKey === "pool") {
    const gt = Number(poolGameTypeEl.value);
    if (gt === 6) return 3; // Cutthroat
    if (gt === 1 || gt === 2 || gt === 4 || gt === 5) return 4; // 2v2
    return 2;
  }
  if (selectedGameKey === "brawlbots") {
    const pl = Number(bbPlayersEl.value);
    if (pl === 1) return 3;
    if (pl === 2 || pl === 3) return 4;
    return 2;
  }
  return 2;
}

function updatePlayerInputsVisibility() {
  const count = getRequiredPlayerCount();
  p3Wrap.classList.toggle("hidden", count < 3);
  p4Wrap.classList.toggle("hidden", count < 4);
}

gameTabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    gameTabs.forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    selectedGameKey = btn.dataset.game;
    poolOptions.classList.toggle("hidden", selectedGameKey !== "pool");
    monstersOptions.classList.toggle("hidden", selectedGameKey !== "monsters");
    brawlbotsOptions.classList.toggle("hidden", selectedGameKey !== "brawlbots");
    updatePlayerInputsVisibility();
  });
});

poolGameTypeEl.addEventListener("change", updatePlayerInputsVisibility);
bbPlayersEl.addEventListener("change", updatePlayerInputsVisibility);

function buildGameSettings() {
  if (selectedGameKey === "pool") {
    return {
      gameType: Number(poolGameTypeEl.value),
      live: Number(poolLiveEl.value),
      trickShots: Number(poolScoringEl.value),
      break: Number(poolBreakEl.value),
    };
  }
  if (selectedGameKey === "monsters") {
    return {
      liveMode: Number(mmLiveEl.value),
      matchRules: Number(mmRulesEl.value),
      monsterSelection: 1,
      weeklyStatus: 0,
    };
  }
  return {
    players: Number(bbPlayersEl.value),
  };
}

function renderDynamicMenu(items) {
  gameMenuItemsEl.innerHTML = "";
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "menu-item";
    btn.textContent = item.label;
    btn.addEventListener("click", () => {
      menuBackdrop.classList.add("hidden");
      activeSession?.clickMenuItem(item.id);
    });
    gameMenuItemsEl.appendChild(btn);
  }
}

// Asks the Android host to rotate (no-op in a plain browser). Resolves after the window resize, or after 1.5s.
async function setHostOrientation(mode) {
  window.__ORIENTATION_CALLS__ = (window.__ORIENTATION_CALLS__ || []).concat(mode);
  const host = window.AndroidHost;
  if (!host || typeof host.setOrientation !== "function") return;
  const wantLandscape = mode === "landscape";
  if ((window.innerWidth > window.innerHeight) === wantLandscape) { host.setOrientation(mode); return; }
  await new Promise((resolve) => {
    const done = () => { window.removeEventListener("resize", done); resolve(); };
    window.addEventListener("resize", done);
    setTimeout(done, 1500);
    host.setOrientation(mode);
  });
}

async function startMatch(params) {
  if (activeSession) {
    activeSession.destroy();
    activeSession = null;
  }

  // Recreate a fresh canvas element so WebGL state is 100% clean across rematches/games
  const container = document.querySelector(".canvas-container");
  container.innerHTML = '<canvas id="game-canvas"></canvas>';
  const freshCanvas = document.getElementById("game-canvas");

  gameOverBar.classList.add("hidden");
  menuBackdrop.classList.add("hidden");

  startBtn.disabled = true;
  loadingBox.classList.remove("hidden");

  try {
    let bundle = bundleCache.get(params.gameId);
    if (!bundle) {
      bundle = await preloadGameBundle(params.gameId, (loaded, total) => {
        const pct = Math.round((loaded / Math.max(1, total)) * 100);
        progressFill.style.width = `${pct}%`;
        loadingText.textContent = `جارٍ تجهيز ملفات اللعبة محلياً (${pct}%)...`;
      });
      bundleCache.set(params.gameId, bundle);
    }

    // Brawlbots is landscape; rotate the host first and wait for the resize so the surface is created at the right size.
    await setHostOrientation(params.gameId === GAMES.brawlbots.id ? "landscape" : "portrait");
    setupScreen.classList.remove("active");
    gameScreen.classList.add("active");

    let currentHudInfo = { seat: 0, turns: [0], simultaneous: false };
    // Pass-the-phone cover: only for games with hidden information (not Pool).
    const humanCount = params.playerNames.length - (params.botSeats ? params.botSeats.length : 0);
    const coverEnabled = params.gameId !== GAMES.pool.id && humanCount > 1 && !params.lan;
    let coveredSeat = -1;
    let coverTimer = null;
    const hideCover = () => passCover.classList.add("hidden");
    const maybeShowCover = (info) => {
      if (!coverEnabled || info.gameOver || info.seat === coveredSeat) return;
      clearTimeout(coverTimer);
      const tryShow = () => {
        const lg = activeSession?.getClientLogic?.();
        if (!lg) { coverTimer = setTimeout(tryShow, 250); return; }
        if (lg.gameOver) return;
        if (lg.paused) { coverTimer = setTimeout(tryShow, 250); return; }
        if (currentHudInfo.seat === coveredSeat) return;
        coveredSeat = currentHudInfo.seat;
        passCoverDot.style.background = SEAT_COLORS[coveredSeat % SEAT_COLORS.length];
        passCoverTitle.textContent = `الدور على ${currentHudInfo.playerName}`;
        passCover.classList.remove("hidden");
      };
      tryShow();
    };
    passCoverBtn.onclick = hideCover;
    hideCover();

    activeSession = await launchPlatoOfflineSession({
      canvas: freshCanvas,
      bundle,
      settings: params.settings,
      playerNames: params.playerNames,
      language: params.language,
      topSafeInsetCssPx: 46,
      lan: params.lan || null,
      onMenuUpdated: renderDynamicMenu,
      onTurnHudUpdate(info) {
        currentHudInfo = info;
        if (info.gameOver) { clearTimeout(coverTimer); hideCover(); } else maybeShowCover(info);
        turnDot.style.background = SEAT_COLORS[info.seat % SEAT_COLORS.length];
        if (info.gameOver) {
          turnText.textContent = params.language === "ar" ? "انتهت المباراة" : "Game Over";
          switchSeatBtn.classList.add("hidden");
        } else {
          turnText.textContent =
            params.language === "ar" ? `دور: ${info.playerName}` : `Turn: ${info.playerName}`;
          switchSeatBtn.classList.toggle("hidden", !info.simultaneous || params.gameId === GAMES.brawlbots.id);
        }
      },
      onGameOverHud() {
        gameOverBar.classList.remove("hidden");
        if (params.lan) rematchBtn.classList.add("hidden"); else rematchBtn.classList.remove("hidden");
      },
    });

    switchSeatBtn.onclick = () => {
      if (!activeSession || !currentHudInfo.turns.length) return;
      const idx = currentHudInfo.turns.indexOf(currentHudInfo.seat);
      const nextSeat = currentHudInfo.turns[(idx + 1) % currentHudInfo.turns.length];
      activeSession.manualSwitchSeat(nextSeat);
    };

    if (activeBots) { activeBots.stop(); activeBots = null; }
    if (params.botSeats && params.botSeats.length) {
      activeBots = startBots({ getLogic: () => activeSession?.getClientLogic?.(), botSeats: params.botSeats, difficulty: params.difficulty, game: params.gameKey });
      window.__BOTS__ = activeBots;
    }
    // Expose debug handle for automated verification
    window.__ACTIVE_SESSION__ = activeSession;
  } catch (err) {
    console.error("Failed to launch match:", err);
    alert("حدث خطأ أثناء تشغيل اللعبة: " + err.message);
    setHostOrientation("portrait");
    gameScreen.classList.remove("active");
    setupScreen.classList.add("active");
  } finally {
    startBtn.disabled = false;
    loadingBox.classList.add("hidden");
  }
}

startBtn.addEventListener("click", () => {
  const count = getRequiredPlayerCount();
  const language = appLangEl.value;
  const playerNames = [];
  for (let i = 0; i < count; i++) {
    const val = pInputs[i].value.trim();
    playerNames.push(val || (language === "ar" ? `اللاعب ${i + 1}` : `Player ${i + 1}`));
  }

  const mode = playModeEl.value;
  if (mode === "bot" && selectedGameKey === "pool") {
    alert("اللعب ضد الكمبيوتر في البلياردو غير متاح بعد. اختر وضع نفس الجهاز.");
    return;
  }
  const botSeats = [];
  if (mode === "bot") {
    for (let i = 1; i < count; i++) {
      botSeats.push(i);
      playerNames[i] = language === "ar" ? `الكمبيوتر ${count > 2 ? i : ""}`.trim() : `Computer ${count > 2 ? i : ""}`.trim();
    }
  }
  lastLaunchParams = {
    gameId: GAMES[selectedGameKey].id,
    settings: buildGameSettings(),
    playerNames,
    language,
    mode,
    botSeats,
    difficulty: botDifficultyEl.value,
    gameKey: selectedGameKey,
  };
  startMatch(lastLaunchParams);
});

function exitToSetup() {
  leaveLan();
  if (activeBots) { activeBots.stop(); activeBots = null; }
  setHostOrientation("portrait");
  if (activeSession) {
    activeSession.destroy();
    activeSession = null;
  }
  menuBackdrop.classList.add("hidden");
  gameOverBar.classList.add("hidden");
  gameScreen.classList.remove("active");
  setupScreen.classList.add("active");
}

menuBtn.addEventListener("click", () => menuBackdrop.classList.remove("hidden"));
closeMenuBtn.addEventListener("click", () => menuBackdrop.classList.add("hidden"));
menuBackdrop.addEventListener("click", (e) => {
  if (e.target === menuBackdrop) menuBackdrop.classList.add("hidden");
});

muteBtn.addEventListener("click", () => {
  if (!activeSession) return;
  const muted = activeSession.toggleMasterMute();
  muteBtn.textContent = muted ? "🔇" : "🔊";
});

rematchBtn.addEventListener("click", () => {
  if (lastLaunchParams) startMatch(lastLaunchParams);
});
menuRematchBtn.addEventListener("click", () => {
  if (lastLaunchParams) startMatch(lastLaunchParams);
});
backSetupBtn.addEventListener("click", exitToSetup);
menuExitBtn.addEventListener("click", exitToSetup);

// Handle Android hardware Back button if invoked by Android host
window.onAndroidBackPressed = () => {
  if (!menuBackdrop.classList.contains("hidden")) {
    menuBackdrop.classList.add("hidden");
    return true;
  }
  if (gameScreen.classList.contains("active")) {
    menuBackdrop.classList.remove("hidden");
    return true;
  }
  return false;
};
