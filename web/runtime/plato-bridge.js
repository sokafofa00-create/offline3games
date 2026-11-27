// Offline Plato Runtime, Synchronous Asset Preloader & Hotseat Pass-and-Play Engine
import { createGLBridge } from "./gl-bridge.js";
import { createAudioBridge } from "./audio-bridge.js";

const POINTER_ACTION = {
  DOWN: 0,
  UP: 1,
  MOVE: 2,
  CANCEL: 3,
  DOWN_POINTER_2: 261,
  UP_POINTER_2: 262,
  DOWN_POINTER_3: 517,
  UP_POINTER_3: 518,
};

export async function preloadGameBundle(gameId, onProgress) {
  const baseUrl = `./g/${gameId}`;

  const [dictResp, attResp, dynResp, mainResp] = await Promise.all([
    fetch(`${baseUrl}/dictionary.json`),
    fetch(`${baseUrl}/game/attestation.json`),
    fetch(`${baseUrl}/game/__assets.json`),
    fetch(`${baseUrl}/game/main.js`),
  ]);

  const [dictionary, attWrapper, dynamicAssets, mainCode] = await Promise.all([
    dictResp.json(),
    attResp.json(),
    dynResp.json(),
    mainResp.text(),
  ]);

  const manifestList = JSON.parse(attWrapper.payload);
  const textFiles = new Map();
  const bitmaps = new Map();
  const audioBytes = new Map();

  // Seed __assets.json directly so AssetCache.initialize() finds it immediately
  textFiles.set("__assets.json", JSON.stringify(dynamicAssets));

  const filesToLoad = manifestList.filter((item) => item.name !== "main.js" && item.name !== "__assets.json");
  let loadedCount = 0;
  const totalCount = filesToLoad.length;

  // Load static files with high concurrency (local disk / WebViewAssetLoader is instant)
  const CONCURRENCY = 24;
  let cursor = 0;

  async function worker() {
    while (cursor < filesToLoad.length) {
      const item = filesToLoad[cursor++];
      const name = item.name;
      const url = `${baseUrl}/game/${name}`;
      try {
        const res = await fetch(url);
        if (res.ok) {
          if (/\.(webp|png|jpg|jpeg)$/i.test(name)) {
            const blob = await res.blob();
            const bmp = await createImageBitmap(blob, {
              premultiplyAlpha: "premultiply",
              colorSpaceConversion: "none",
            });
            bitmaps.set(name, bmp);
          } else if (/\.(m4a|mp3|ogg|wav)$/i.test(name)) {
            const buf = await res.arrayBuffer();
            audioBytes.set(name, buf);
          } else {
            const txt = await res.text();
            textFiles.set(name, txt);
          }
        }
      } catch (err) {
        console.warn("[Preloader] Failed loading static asset:", name, err);
      }
      loadedCount++;
      if (onProgress) onProgress(loadedCount, totalCount);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, filesToLoad.length || 1) }, () => worker()));

  function normalizeGamePath(uri) {
    const s = String(uri || "");
    return s.startsWith("~/") ? s.slice(2) : s.replace(/^\.\//, "");
  }

  // User request (Pool): choosing a table style changes only the background (and music), never the table/head-line art.
  // Theme manifests ({sku:{assets,data:{background,table,head_line,music}}}) get the standard theme's table and head line.
  for (const [name, txt] of Array.from(textFiles.entries())) {
    if (typeof txt !== "string" || !/\.json$/i.test(name) || txt.length < 200 || txt.charCodeAt(0) !== 123) continue;
    try {
      const o = JSON.parse(txt);
      const keys = Object.keys(o);
      if (!keys.length || !keys.every((k) => o[k] && o[k].data && Array.isArray(o[k].data.background) && Array.isArray(o[k].data.table) && Array.isArray(o[k].data.head_line))) continue;
      const stdTable = [{ key: "th_basic_table", uri: "~/images/imported/themes/th_basic_table.webp" }];
      const stdHead = [{ key: "th_basic_head_line", uri: "~/images/imported/themes/th_basic_head_line.webp" }];
      for (const k of keys) {
        const e = o[k];
        const drop = new Set([...e.data.table, ...e.data.head_line].map((a) => a.key));
        if (Array.isArray(e.assets)) e.assets = e.assets.filter((a) => !drop.has(a.key));
        e.data.table = stdTable;
        e.data.head_line = stdHead;
      }
      textFiles.set(name, JSON.stringify(o));
    } catch (_) {}
  }

  // Extract unlocked monster IDs if monsters.json is present (for Match Monsters)
  let unlockedInventory = [];
  if (textFiles.has("monsters.json")) {
    try {
      const monsters = JSON.parse(textFiles.get("monsters.json"));
      const arr = Array.isArray(monsters) ? monsters : monsters.monsters || Object.values(monsters);
      unlockedInventory = arr
        .map((m, idx) => Number(m?.id ?? m?.sku ?? idx))
        .filter((n) => !Number.isNaN(n));
    } catch (_) {}
  }

  // Offline build: there is no store or account, so every item that ships in the game files counts as owned.
  // Collect every SKU the bundle declares: `sku = N` / "sku": N in toml/json, and numeric-keyed equipment manifests
  // (Pool cues, tables, effects: {"1001":{"assets":[],"data":{...}}}).
  {
    const skuSet = new Set(unlockedInventory);
    const re = /["']?\bsku["']?\s*[:=]\s*(\d+)/g;
    for (const [name, txt] of textFiles.entries()) {
      if (typeof txt !== "string" || txt.length > 600000 || !/\.(json|toml)$/i.test(name)) continue;
      let m; re.lastIndex = 0;
      while ((m = re.exec(txt))) skuSet.add(Number(m[1]));
      if (/^\s*\{\s*"\d+"\s*:\s*\{/.test(txt) && /\.json$/i.test(name)) {
        try {
          const o = JSON.parse(txt);
          const keys = Object.keys(o);
          if (keys.length && keys.every((k) => /^\d+$/.test(k) && o[k] && typeof o[k] === "object" && ("data" in o[k] || "assets" in o[k]))) keys.forEach((k) => skuSet.add(Number(k)));
        } catch (_) {}
      }
    }
    unlockedInventory = Array.from(skuSet).filter((n) => Number.isFinite(n));
  }

  const plainTextObj = {};
  for (const [k, v] of textFiles.entries()) plainTextObj[k] = v;

  return {
    gameId,
    dictionary,
    dynamicAssets,
    mainCode,
    unlockedInventory,
    plainTextObj,
    normalizeGamePath,
    getText: (uri) => textFiles.get(normalizeGamePath(uri)) ?? "",
    getBitmap: (uri) => bitmaps.get(normalizeGamePath(uri)) ?? null,
    getAudioBytes: (uri) => audioBytes.get(normalizeGamePath(uri)) ?? null,
    disposeBitmaps() {
      for (const bmp of bitmaps.values()) {
        if (bmp && typeof bmp.close === "function") bmp.close();
      }
      bitmaps.clear();
    },
  };
}

export async function launchPlatoOfflineSession({
  canvas,
  bundle,
  settings,
  playerNames,
  language = "ar",
  topSafeInsetCssPx = 46,
  onMenuUpdated,
  onTurnHudUpdate,
  onGameOverHud,
  lan = null, // { role: "host"|"guest", seat, guestSeat, send(msg), onRecv(cb) } for one-seat-per-device LAN matches
}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const glBridge = createGLBridge(canvas, bundle);
  const audioBridge = createAudioBridge(bundle);

  let clientLogic = null;
  let onSurfaceCreated = null;
  let onSurfaceChanged = null;
  let onDrawFrame = null;
  let onTouch = null;
  let onMouse = null;
  let onAvatarsReady = null;
  let onMenuClicked = null;

  const menuItems = [];
  let nextTimerId = 1;
  const timers = new Map();
  let renderRequested = true;
  let rafId = 0;
  let destroyed = false;
  let numSeats = 2;
  let activeLocalSeat = 0;
  // Track which seats have already acted in simultaneous-turn games (Brawlbots / Match Monsters draft)
  const actedInSimultaneousRound = new Set();
  let manualSeatOverride = null; // seat chosen with the on-screen switch button for the current simultaneous round

  const prefStorageKey = `offline_plato_prefs_${bundle.gameId}`;
  let savedPrefs = {};
  try {
    savedPrefs = JSON.parse(localStorage.getItem(prefStorageKey) || "{}");
  } catch (_) {}

  function translate(args) {
    if (!Array.isArray(args) || args.length === 0) return "";
    const key = args[0];
    // Always use third-person dictionary ('ar' / 'en') in Pass-and-Play so player names are shown clearly!
    const dict = bundle.dictionary[language] || bundle.dictionary.en || Object.values(bundle.dictionary)[0] || {};
    let str = dict[key] ?? bundle.dictionary.en?.[key] ?? key;
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      let val;
      if (typeof arg === "number") {
        val = playerNames[arg] || (language === "ar" ? `اللاعب ${arg + 1}` : `Player ${arg + 1}`);
      } else if (typeof arg === "string" && arg.startsWith("^")) {
        val = translate([arg.slice(1)]);
      } else {
        val = String(arg);
      }
      str = str.split(`{${i - 1}}`).join(val);
    }
    return str;
  }

  // Spawn dedicated Local Server Worker
  let serverWorker;
  if (lan && lan.role === "guest") {
    // Guest phone: no local game server. Client messages go to the host; host server messages come back here.
    serverWorker = {
      onmessage: null,
      postMessage(m) { if (m && m.type === "init") lan.send({ k: "hello" }); else lan.send({ k: "w", m }); },
      terminate() {},
      addEventListener() {},
    };
    lan.onRecv((msg) => { if (msg && msg.k === "w" && serverWorker.onmessage) serverWorker.onmessage({ data: msg.m }); });
  } else {
    serverWorker = new Worker(new URL("./server-worker.js", import.meta.url));
  }
  if (lan && lan.role === "host") {
    // Host phone runs the one authoritative server for both seats and forwards the guest's share over the LAN.
    let hostInit = null;
    let helloPending = false;
    serverWorker.addEventListener("message", (ev) => {
      const m = ev.data;
      if (!m) return;
      if (m.type === "initialized") {
        hostInit = m;
        if (helloPending) { helloPending = false; lan.send({ k: "w", m: { ...hostInit, initialSeat: lan.guestSeat } }); }
        return;
      }
      if ((m.type === "resyncState" || m.type === "serverNetMessage") && m.seat !== lan.guestSeat) return;
      lan.send({ k: "w", m });
    });
    lan.onRecv((msg) => {
      if (!msg) return;
      if (msg.k === "hello") {
        if (hostInit) lan.send({ k: "w", m: { ...hostInit, initialSeat: lan.guestSeat } }); else helloPending = true;
      } else if (msg.k === "w" && msg.m) {
        const m = msg.m;
        // Both phones simulate the same world; the host's world-state report is delivered for every seat, so the guest's duplicate is dropped.
        if (m.type === "clientMove" && m.packet && m.packet.__info && m.packet.__info.a === -1) return;
        serverWorker.postMessage({ ...m, seat: lan.guestSeat, activeClientSeat: lan.guestSeat });
      }
    });
  }
  const clientNetListeners = [];

  const plato = {
    version: 25,
    os: "android",
    dpi: Math.round(163 * dpr),
    language,
    is_develop: false,
    globals: {},
    shop: undefined,
    net: {
      sendMessage(bytes) {
        const seatForMove = clientLogic?._localSeat ?? activeLocalSeat;
        const arr = bytes instanceof Uint8Array ? Array.from(bytes) : bytes;
        serverWorker.postMessage({ type: "clientNetMessage", seat: seatForMove, bytes: arr });
      },
      onMessage(cb) {
        if (typeof cb === "function") clientNetListeners.push(cb);
      },
    },
    game_preferences: savedPrefs,
    saved_local_state: {},
    haptic: {
      isVibrationSupported: () => typeof navigator.vibrate === "function",
      vibrate: (ms = 20) => {
        try {
          if (window.AndroidHost?.vibrate) window.AndroidHost.vibrate(ms);
          else if (navigator.vibrate) navigator.vibrate(ms);
        } catch (_) {}
      },
      vibratePattern: (pat) => {
        try {
          if (navigator.vibrate) navigator.vibrate(pat);
        } catch (_) {}
      },
    },
    isRTL: () => language === "ar" || language === "fa",
    hrtime: () => Math.floor(performance.now() * 1e6),
    log: (msg, lvl = 2) => {
      if (lvl >= 4) console.error("[PlatoGame]", msg);
    },
    track: () => {},
    saveGamePreferences: (obj) => {
      try {
        localStorage.setItem(prefStorageKey, JSON.stringify(obj || plato.game_preferences));
      } catch (_) {}
    },
    saveLocalState: () => {},
    getInventory: () => bundle.unlockedInventory,
    getPlatoID: (seat) => playerNames[seat] || (language === "ar" ? `اللاعب ${seat + 1}` : `Player ${seat + 1}`),
    ownerSeat: () => 0,
    translate,
    loadFileAsString: (uri) => bundle.getText(uri),

    async fetchTexture(hash, okCb, errCb) {
      try {
        const res = await fetch(`./assets/${hash}`);
        if (!res.ok) {
          if (errCb) errCb(hash, 2);
          return;
        }
        const blob = await res.blob();
        const bmp = await createImageBitmap(blob, { premultiplyAlpha: "premultiply", colorSpaceConversion: "none" });
        const texInfo = glBridge.registerExternalBitmap(bmp);
        bmp.close();
        if (okCb) okCb(hash, texInfo);
        renderRequested = true;
      } catch (_) {
        if (errCb) errCb(hash, 2);
      }
    },

    fetchAudio(hash, okCb, errCb) {
      audioBridge.fetchDynamicAudio(hash, okCb, errCb);
    },

    streamMusic(hash, errCb) {
      audioBridge.streamDynamicMusic(hash, errCb);
    },

    setTimer(cb, ms, repeat = false) {
      const id = nextTimerId++;
      if (repeat) {
        const handle = setInterval(() => {
          if (!destroyed) {
            cb();
            renderRequested = true;
          }
        }, ms);
        timers.set(id, { repeat: true, handle });
      } else {
        const handle = setTimeout(() => {
          timers.delete(id);
          if (!destroyed) {
            cb();
            renderRequested = true;
          }
        }, ms);
        timers.set(id, { repeat: false, handle });
      }
      return id;
    },

    clearTimer(id) {
      const t = timers.get(id);
      if (!t) return;
      if (t.repeat) clearInterval(t.handle);
      else clearTimeout(t.handle);
      timers.delete(id);
    },

    requestRender() {
      renderRequested = true;
    },

    addMenuButton(id, label) {
      const existing = menuItems.findIndex((m) => m.id === id);
      if (existing >= 0) menuItems[existing].label = label;
      else menuItems.push({ id, label });
      if (onMenuUpdated) onMenuUpdated([...menuItems]);
    },

    clearMenu() {
      menuItems.length = 0;
      if (onMenuUpdated) onMenuUpdated([]);
    },

    setOnSurfaceCreatedListener: (cb) => { onSurfaceCreated = cb; },
    setOnSurfaceChangedListener: (cb) => { onSurfaceChanged = cb; },
    setOnDrawFrameListener: (cb) => { onDrawFrame = cb; },
    setOnTouchListener: (cb) => { onTouch = cb; },
    setOnMouseListener: (cb) => { onMouse = cb; },
    setOnAvatarsReadyListener: (cb) => { onAvatarsReady = cb; },
    setOnMenuButtonClickedListener: (cb) => { onMenuClicked = cb; },

    showGameOver() {
      renderRequested = true;
      if (onGameOverHud) onGameOverHud();
    },
    showItemPurchase: () => {},
    showProfile: () => {},
    requestKeyboard(onChange, onDone) {
      const val = window.prompt(language === "ar" ? "أدخل النص:" : "Enter text:", "") ?? "";
      if (onChange) onChange(val);
      if (onDone) onDone(val);
    },

    setGameLogic(logic) {
      clientLogic = logic;
      if (!lan) installHotseatHooks(logic);
    },

    sendMove(packet) {
      const seatForMove = clientLogic?._localSeat ?? activeLocalSeat;
      if (window.__DEBUG_HOTSEAT__) (window.__SRV_LOG ||= []).push({ t: Math.round(performance.now()), dir: "cli", seat: seatForMove, a: packet?.a ?? packet?.m?.a, t2: packet?.t, keys: Object.keys(packet || {}).join(",") });
      serverWorker.postMessage({
        type: "clientMove",
        seat: seatForMove,
        activeClientSeat: activeLocalSeat,
        packet,
      });
    },

    resetSynchronizationStream() {
      serverWorker.postMessage({
        type: "requestResync",
        seat: activeLocalSeat,
      });
    },

    alarm: { set() {} },
    session: { changeTurn() {}, gameOver() {} },
  };

  // --- Hotseat Pass-and-Play Controller (Same Device Player 1 vs Player 2 / 3 / 4) ---
  function installHotseatHooks(logic) {
    // 1. Keep displaySeat pinned to 0 in Pool so avatars & pocketed ball racks NEVER flip left/right between turns!
    // Pool only: Monsters and Brawlbots show the active player's own private picks/board, so their displaySeat must follow
    // the local seat (pinning it made the tank-select view read a hidden pick and throw, and mirrored seat-specific layout).
    if ("displaySeat" in logic && typeof logic.canMoveCueBall === "function") {
      Object.defineProperty(logic, "displaySeat", {
        get() { return 0; },
        set(_v) {},
        configurable: true,
      });
    }

    // 2. Patch _localMoves queue matching so local moves always match the seat that originated them
    // even if activeLocalSeat switches right after a move.
    const origMove = logic.move.bind(logic);
    logic.move = function hotseatMove(seat, packet, reveal) {
      if (
        packet &&
        packet.__info === undefined &&
        (!this._paused || this.moveIgnoresPause(seat, packet.m)) &&
        Array.isArray(this._localMoves) &&
        this._localMoves.length > 0 &&
        this._localMoves[0].seat === seat &&
        this._localMoves[0].id === packet.i
      ) {
        const prevSeat = this._localSeat;
        this._localSeat = seat;
        try {
          return origMove(seat, packet, reveal);
        } finally {
          this._localSeat = prevSeat;
        }
      }
      return origMove(seat, packet, reveal);
    };

    // 3. Synchronize active seat whenever turn changes or animations finish resuming
    if (logic.onTurnChange?.receive) {
      logic.onTurnChange.receive(() => {
        actedInSimultaneousRound.clear();
        manualSeatOverride = null;
        scheduleHotseatSeatSync();
      });
    }
    if (logic.onResumed?.receive) {
      logic.onResumed.receive(() => {
        scheduleHotseatSeatSync();
      });
    }
    if (logic.onSynchronize?.receive) {
      logic.onSynchronize.receive(() => {
        scheduleHotseatSeatSync();
      });
    }

    // Match Monsters ready check: the game acks its awaited seat from its onSync handler, which the real platform
    // triggers after state changes. This offline runtime never raises that sync after an incremental move, so the
    // ready check waited for the 25s alarm. Raise the same sync event (no ack of our own, no timer) once the
    // local seat is awaited and the logic is not paused (animations finished). Games without a ready check are untouched.
    if (typeof logic.startReadyCheck === "function" && typeof logic.isSeatAwaitingReady === "function" && logic.onSynchronize?.emit) {
      let readySyncQueued = false;
      const raiseReadySync = () => {
        if (readySyncQueued) return;
        readySyncQueued = true;
        setTimeout(() => {
          readySyncQueued = false;
          try {
            if (destroyed || logic.gameOver || logic._paused) return;
            // One phone stands in for every device: each awaited seat acks through the game's own onSync handler,
            // with the local seat set to that seat for the duration of the handler.
            const awaited = Array.from(logic._readySeats || []);
            for (const s of awaited) {
              if (!logic.isSeatAwaitingReady(s)) continue;
              const prev = logic._localSeat;
              if (window.__DEBUG_HOTSEAT__) (window.__SRV_LOG = window.__SRV_LOG || []).push({ dir: "bridge", type: "readySync", seat: s, prev });
              logic._localSeat = s;
              try { logic.onSynchronize.emit(); } finally { logic._localSeat = prev; }
            }
          } catch (_e) { /* ignore */ }
        }, 0);
      };
      for (const sig of ["onMove", "onAction", "onTurnChange", "onResumed"]) logic[sig]?.receive?.(raiseReadySync);
    }
  }

  let syncPending = false;
  function scheduleHotseatSeatSync() {
    if (lan) return;
    if (syncPending || destroyed) return;
    syncPending = true;
    queueMicrotask(() => {
      syncPending = false;
      applyHotseatSeatSync();
    });
  }

  function applyHotseatSeatSync() {
    if (!clientLogic || destroyed || clientLogic.gameOver || !clientLogic.started) {
      updateTopHud();
      return;
    }

    // Wait while physics/animations are paused so shot completion runs cleanly first
    if (clientLogic.paused) {
      updateTopHud();
      return;
    }

    const turns = Array.isArray(clientLogic.turn) ? clientLogic.turn : [];
    if (turns.length === 0) {
      updateTopHud();
      return;
    }

    // Pick next active seat:
    // - Sequential games (Pool, Match Monsters combat): turns has 1 seat -> turns[0]
    // - Simultaneous phases (Brawlbots / Match Monsters draft): pick first seat in `turns` not yet in `actedInSimultaneousRound`
    let targetSeat = turns[0];
    if (turns.length > 1) {
      // A seat that has already locked in its action (tank chosen / shot ready) is done for this round.
      const seatDone = (s) => {
        if (actedInSimultaneousRound.has(s)) return true;
        const l = clientLogic;
        if (typeof l.canSelectTank === "function" && typeof l.canShoot === "function") {
          try { return l.worldMap && l.worldMap.tanksSelected(true) ? !l.canShoot(s, true) : !l.canSelectTank(s, 0); } catch (_e) { return false; }
        }
        return false;
      };
      const pendingSeat = turns.find((s) => !seatDone(s));
      targetSeat = pendingSeat !== undefined ? pendingSeat : turns[0];
      if (manualSeatOverride !== null && turns.includes(manualSeatOverride) && !seatDone(manualSeatOverride)) targetSeat = manualSeatOverride;
    }

    if (clientLogic._localSeat !== targetSeat) {
      switchActiveSeat(targetSeat, turns.length > 1);
    } else {
      if (typeof clientLogic.sendReady === "function") {
        clientLogic.sendReady();
      }
      refreshSceneControls(targetSeat);
    }

    updateTopHud();
    renderRequested = true;
  }

  function refreshSceneControls(seat) {
    const scene = clientLogic?.sceneMgr;
    if (!scene) return;
    if (scene.avatars) {
      scene.avatars.setLocalSeat(seat);
      scene.avatars.setTurn(clientLogic.turn);
    }
    if (scene.powerMeter?.animator) scene.powerMeter.animator.updateVisibility();
    if (scene.angleBtnL?.animator) scene.angleBtnL.animator.updateVisibility();
    if (scene.angleBtnR?.animator) scene.angleBtnR.animator.updateVisibility();
    if (scene.angleText?.animator) scene.angleText.animator.updateVisibility();
    if (scene.spinBtn?.animator) scene.spinBtn.animator.updateVisibility();
    if (scene.cueStick?.updateAlpha) scene.cueStick.updateAlpha();
  }

  function switchActiveSeat(newSeat, needServerReserialize = false) {
    activeLocalSeat = newSeat;
    if (!clientLogic) return;

    if (needServerReserialize) {
      // For blind simultaneous selection phases (Match Monsters / Brawlbots), ask server for seat-filtered state
      serverWorker.postMessage({ type: "requestResync", seat: newSeat });
      return;
    }

    clientLogic._localSeat = newSeat;

    // Send ready check for the newly active player if needed
    if (typeof clientLogic.sendReady === "function") {
      clientLogic.sendReady();
    } else if (typeof clientLogic.isSeatAwaitingReady === "function" && clientLogic.isSeatAwaitingReady(newSeat)) {
      clientLogic.localReady();
    }

    // Update Pool Scene UI & controls cleanly without flipping displaySeat (which stays 0)
    const scene = clientLogic.sceneMgr;
    if (scene) {
      if (clientLogic.onLocalSeatUpdated) {
        clientLogic.onLocalSeatUpdated.emit();
      }
      if (typeof scene.onTurnChangeHandler === "function") {
        scene.onTurnChangeHandler(clientLogic.turn);
      }
      refreshSceneControls(newSeat);
    }
    renderRequested = true;
  }

  function updateTopHud() {
    if (!onTurnHudUpdate || !clientLogic) return;
    const turns = Array.isArray(clientLogic.turn) ? clientLogic.turn : [];
    const seat = turns.length === 1 ? turns[0] : activeLocalSeat;
    onTurnHudUpdate({
      seat,
      playerName: plato.getPlatoID(seat),
      turns: turns.slice(),
      numSeats,
      gameOver: Boolean(clientLogic.gameOver),
      simultaneous: turns.length > 1,
    });
  }

  // Expose the 4 required globals before running main.js
  globalThis.GL = glBridge.GL;
  globalThis.audio = audioBridge.audio;
  globalThis.AudioController = audioBridge.AudioController;
  globalThis.pmath = {
    sin: Math.sin,
    cos: Math.cos,
    acos: Math.acos,
    asin: Math.asin,
    atan2: Math.atan2,
    pow: Math.pow,
  };
  globalThis.plato = plato;

  // Execute game bundle on the UI thread
  const runGameBundle = new Function(bundle.mainCode);
  runGameBundle();

  // Resize canvas to exact device pixels
  function resizeSurface() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = Math.max(64, Math.round(rect.width * dpr));
    const h = Math.max(64, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    if (onSurfaceChanged) {
      onSurfaceChanged(w, h, 0, Math.round(topSafeInsetCssPx * dpr));
    }
    renderRequested = true;
  }

  // Wait for Local Server Worker to initialize authoritative game room
  await new Promise((resolve, reject) => {
    serverWorker.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg) return;
      if (window.__DEBUG_HOTSEAT__) (window.__SRV_LOG ||= []).push({ t: Math.round(performance.now()), dir: "srv", type: msg.type, seat: msg.seat, a: msg.packet?.m?.a, turns: msg.turns, over: msg.gameOver });

      if (lan) {
        // One local seat per device: pick this seat's private reveal; ignore other seats' private updates.
        if (msg.revealBySeat) msg.reveal = msg.revealBySeat[lan.seat] || undefined;
        if ((msg.type === "resyncState" || msg.type === "serverNetMessage") && msg.seat !== lan.seat) return;
      }

      if (msg.type === "error") {
        reject(new Error(msg.message));
        return;
      }

      if (msg.type === "initialized") {
        numSeats = msg.numSeats;
        activeLocalSeat = lan ? lan.seat : (msg.initialSeat ?? 0);

        // 1. Hydrate clientLogic from authoritative server snapshot FIRST (matches native Plato startup order!)
        if (clientLogic) {
          clientLogic.deserialize(msg.state, activeLocalSeat);
          for (let s = 0; s < numSeats; s++) {
            clientLogic.enter(s);
          }
        }

        // 2. Trigger Surface Created & Surface Changed (creates Scene with settings already applied)
        if (onSurfaceCreated) onSurfaceCreated();
        resizeSurface();

        // 3. Generate & bind local player avatar textures
        if (onAvatarsReady) {
          const avatarInfos = glBridge.createAvatarTextures(playerNames.slice(0, numSeats));
          onAvatarsReady(avatarInfos);
        }

        scheduleHotseatSeatSync();
        renderRequested = true;
        // LAN: the initial snapshot is serialized for whichever seat moves first; fetch this device's own private view.
        if (lan) serverWorker.postMessage({ type: "requestResync", seat: lan.seat });
        resolve();
        return;
      }

      if (msg.type === "serverMove" && clientLogic) {
        clientLogic.move(msg.seat, msg.packet, msg.reveal);
        // In simultaneous games, if current seat finished its action, advance to next unacted seat
        if (Array.isArray(msg.turns) && msg.turns.length > 1 && !msg.turns.includes(msg.seat)) {
          actedInSimultaneousRound.add(msg.seat);
        }
        scheduleHotseatSeatSync();
        renderRequested = true;
        return;
      }

      if (msg.type === "serverAlarm" && clientLogic) {
        clientLogic.alarm(msg.reveal || { __alarmId: msg.alarmId }, msg.alarmId);
        scheduleHotseatSeatSync();
        renderRequested = true;
        return;
      }

      if (msg.type === "resyncState" && clientLogic) {
        activeLocalSeat = msg.seat ?? activeLocalSeat;
        clientLogic.deserialize(msg.state, activeLocalSeat);
        for (let s = 0; s < numSeats; s++) {
          clientLogic.enter(s);
        }
        // Simultaneous phases: make sure the logic really acts as the seat we switched to.
        if (Array.isArray(msg.turns) && msg.turns.length > 1) clientLogic._localSeat = activeLocalSeat;
        scheduleHotseatSeatSync();
        renderRequested = true;
        return;
      }

      if (msg.type === "serverNetMessage") {
        const arr = new Uint8Array(msg.bytes || []);
        for (const fn of clientNetListeners) fn(arr);
        renderRequested = true;
        return;
      }

      if (msg.type === "turnChanged") {
        scheduleHotseatSeatSync();
        renderRequested = true;
      }
    };

    serverWorker.postMessage({
      type: "init",
      mainCode: bundle.mainCode,
      textFiles: bundle.plainTextObj,
      dictionary: bundle.dictionary,
      language,
      playerNames,
      unlockedInventory: bundle.unlockedInventory,
      settings,
      seed: Math.floor(Math.random() * 0x7fffffff) + 1,
    });
  });

  // --- Touch & Pointer Event Translation (Multi-touch + Desktop Mouse Support) ---
  const activeTouches = new Map();

  function toCanvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    // The game's InputManager computes y = surfaceHeight - y itself. Measured on this runtime (tap-scan CI run, and the
    // user's phone report "to press something at the bottom I tap at the top"): top-down CSS y reaches the game mirrored,
    // so hand it the already-mirrored y.
    return {
      x: (clientX - rect.left) * scaleX,
      y: canvas.height - (clientY - rect.top) * scaleY,
    };
  }

  function buildPointersArray() {
    return Array.from(activeTouches.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(0, 5)
      .map(([_pid, info], idx) => ({
        id: info.slot,
        x: info.x,
        y: info.y,
        slotIndex: idx,
      }));
  }

  function allocateSlot() {
    const used = new Set(Array.from(activeTouches.values()).map((v) => v.slot));
    for (let s = 0; s < 5; s++) {
      if (!used.has(s)) return s;
    }
    return 0;
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    const pt = toCanvasCoords(e.clientX, e.clientY);
    const slot = allocateSlot();
    activeTouches.set(e.pointerId, { slot, x: pt.x, y: pt.y });

    const pointers = buildPointersArray();
    const idx = pointers.findIndex((p) => p.id === slot);
    let action = POINTER_ACTION.DOWN;
    if (pointers.length > 1) {
      if (idx === 1) action = POINTER_ACTION.DOWN_POINTER_2;
      else if (idx === 2) action = POINTER_ACTION.DOWN_POINTER_3;
    }

    if (onTouch) onTouch({ action, pointers });
    if (onMouse && e.pointerType === "mouse") {
      onMouse({ x: pt.x, y: pt.y, mask: 1 });
    }
    renderRequested = true;
  }

  function onPointerMove(e) {
    const pt = toCanvasCoords(e.clientX, e.clientY);
    if (activeTouches.has(e.pointerId)) {
      e.preventDefault();
      const entry = activeTouches.get(e.pointerId);
      entry.x = pt.x;
      entry.y = pt.y;
      if (onTouch) {
        onTouch({ action: POINTER_ACTION.MOVE, pointers: buildPointersArray() });
      }
      renderRequested = true;
    } else if (onMouse && e.pointerType === "mouse") {
      onMouse({ x: pt.x, y: pt.y, mask: 4 });
    }
  }

  function onPointerUpOrCancel(e, isCancel = false) {
    if (!activeTouches.has(e.pointerId)) return;
    e.preventDefault();
    const pt = toCanvasCoords(e.clientX, e.clientY);
    const entry = activeTouches.get(e.pointerId);
    entry.x = pt.x;
    entry.y = pt.y;

    const pointers = buildPointersArray();
    const idx = pointers.findIndex((p) => p.id === entry.slot);
    let action = isCancel ? POINTER_ACTION.CANCEL : POINTER_ACTION.UP;
    if (!isCancel && pointers.length > 1) {
      if (idx === 1) action = POINTER_ACTION.UP_POINTER_2;
      else if (idx === 2) action = POINTER_ACTION.UP_POINTER_3;
    }

    if (onTouch) onTouch({ action, pointers });
    activeTouches.delete(e.pointerId);
    if (onMouse && e.pointerType === "mouse") {
      onMouse({ x: pt.x, y: pt.y, mask: 2 });
    }
    renderRequested = true;
  }

  const handleDown = (e) => onPointerDown(e);
  const handleMove = (e) => onPointerMove(e);
  const handleUp = (e) => onPointerUpOrCancel(e, false);
  const handleCancel = (e) => onPointerUpOrCancel(e, true);
  const handleResize = () => resizeSurface();

  canvas.addEventListener("pointerdown", handleDown, { passive: false });
  canvas.addEventListener("pointermove", handleMove, { passive: false });
  canvas.addEventListener("pointerup", handleUp, { passive: false });
  canvas.addEventListener("pointercancel", handleCancel, { passive: false });
  window.addEventListener("resize", handleResize);

  // --- 60 FPS Render Loop ---
  function frameLoop() {
    if (destroyed) return;
    if (renderRequested && onDrawFrame) {
      renderRequested = false;
      try {
        onDrawFrame();
      } catch (err) {
        console.error("[PlatoRenderError]", err);
      }
    }
    rafId = requestAnimationFrame(frameLoop);
  }
  rafId = requestAnimationFrame(frameLoop);

  return {
    getMenuItems: () => [...menuItems],
    clickMenuItem(id) {
      if (onMenuClicked) {
        onMenuClicked(id);
        renderRequested = true;
      }
    },
    manualSwitchSeat(seat) {
      if (seat >= 0 && seat < numSeats) {
        manualSeatOverride = seat;
        switchActiveSeat(seat, true);
        updateTopHud();
      }
    },
    toggleMasterMute() {
      const next = !audioBridge.isMasterMuted();
      audioBridge.setMasterMuted(next);
      return next;
    },
    isMasterMuted: () => audioBridge.isMasterMuted(),
    getClientLogic: () => clientLogic,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      for (const t of timers.values()) {
        if (t.repeat) clearInterval(t.handle);
        else clearTimeout(t.handle);
      }
      timers.clear();
      serverWorker.terminate();
      canvas.removeEventListener("pointerdown", handleDown);
      canvas.removeEventListener("pointermove", handleMove);
      canvas.removeEventListener("pointerup", handleUp);
      canvas.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("resize", handleResize);
      audioBridge.destroy();
    },
  };
}
