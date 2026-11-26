// Offline Authoritative Game Server Worker
// Runs the exact same game main.js in headless Server mode (localSeat === undefined)
// with zero network access and 0ms in-memory latency.

let serverLogic = null;
let numSeats = 2;
let textFiles = {};
let dictionary = {};
let language = "ar";
let playerNames = [];
let unlockedInventory = [];

let nextTimerId = 1;
const activeTimers = new Map();
const serverAlarms = new Map();

function hrtimeNs() {
  return Math.floor(performance.now() * 1e6);
}

function normalizePath(uri) {
  const s = String(uri || "");
  return s.startsWith("~/") ? s.slice(2) : s.replace(/^\.\//, "");
}

function translateArgs(args) {
  if (!Array.isArray(args) || args.length === 0) return "";
  const key = args[0];
  const langPack = dictionary[language] || dictionary.en || Object.values(dictionary)[0] || {};
  let template = langPack[key] ?? dictionary.en?.[key] ?? key;
  for (let i = 1; i < args.length; i++) {
    const raw = args[i];
    let rep;
    if (typeof raw === "number") {
      rep = playerNames[raw] || `P${raw + 1}`;
    } else if (typeof raw === "string" && raw.startsWith("^")) {
      rep = translateArgs([raw.slice(1)]);
    } else {
      rep = String(raw);
    }
    template = template.split(`{${i - 1}}`).join(rep);
  }
  return template;
}

function setupHeadlessGlobals() {
  globalThis.window = globalThis;
  globalThis.document = {};
  globalThis.pmath = {
    sin: Math.sin,
    cos: Math.cos,
    acos: Math.acos,
    asin: Math.asin,
    atan2: Math.atan2,
    pow: Math.pow,
  };

  globalThis.AudioController = { musicVolume: 1 };
  globalThis.audio = {
    load: () => 1,
    play: () => {},
    playMusic: () => {},
    stopMusic: () => {},
    unload: () => {},
  };

  // Minimal headless GL stub so module-level shader/GL constants in main.js evaluate cleanly
  let glId = 1;
  globalThis.GL = new Proxy(
    {
      NONE: 0,
      TEXTURE0: 33984,
      TEXTURE_2D: 3553,
      COMPILE_STATUS: 35713,
      LINK_STATUS: 35714,
      FRAMEBUFFER_COMPLETE: 36053,
      MAX_TEXTURE_SIZE: 3379,
      genBuffers(n, arr) { for (let i = 0; i < n; i++) arr[i] = glId++; },
      genTextures(n, arr) { for (let i = 0; i < n; i++) arr[i] = glId++; },
      genFramebuffers(n, arr) { for (let i = 0; i < n; i++) arr[i] = glId++; },
      genRenderbuffers(n, arr) { for (let i = 0; i < n; i++) arr[i] = glId++; },
      deleteBuffers() {},
      deleteTextures() {},
      deleteFramebuffers() {},
      deleteRenderbuffers() {},
      activeTexture() {},
      bindTexture() {},
      getShaderiv(_s, _p, out) { out[0] = 1; },
      getProgramiv(_p, _n, out) { out[0] = 1; },
      getIntegerv(_p, out) { out[0] = 2048; },
      checkFramebufferStatus() { return 36053; },
      createShader() { return glId++; },
      createProgram() { return glId++; },
      getAttribLocation() { return 0; },
      getUniformLocation() { return glId++; },
      texImage2DFromFile() { return { width: 64, height: 64 }; },
      texImage2DFromText() { return { width: 64, height: 32 }; },
      texImage2DFromTextRich() { return { width: 64, height: 32 }; },
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop === "string" && prop === prop.toUpperCase()) return 1;
        return () => {};
      },
    }
  );

  const serverNetListeners = [];
  globalThis.__deliverServerNetMessage = (bytes, seat) => {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (const fn of serverNetListeners) fn(arr, { seat });
  };

  globalThis.plato = {
    version: 25,
    os: "android",
    dpi: 326,
    language,
    is_develop: false,
    globals: {},
    game_preferences: {},
    saved_local_state: {},
    shop: undefined,
    net: {
      sendMessage(bytes, opts) {
        const arr = bytes instanceof Uint8Array ? Array.from(bytes) : bytes;
        self.postMessage({ type: "serverNetMessage", bytes: arr, seat: opts?.seat ?? 0 });
      },
      onMessage(cb) {
        if (typeof cb === "function") serverNetListeners.push(cb);
      },
    },
    haptic: { isVibrationSupported: () => false, vibrate: () => {}, vibratePattern: () => {} },
    isRTL: () => language === "ar" || language === "fa",
    hrtime: hrtimeNs,
    log: (_msg, _lvl) => {},
    track: () => {},
    saveGamePreferences: () => {},
    saveLocalState: () => {},
    getInventory: () => unlockedInventory,
    getPlatoID: (seat) => playerNames[seat] || `Player ${seat + 1}`,
    ownerSeat: () => 0,
    translate: translateArgs,
    loadFileAsString(uri) {
      const key = normalizePath(uri);
      return textFiles[key] ?? "";
    },
    fetchTexture(_h, _ok, err) { if (err) err(_h, 2); },
    fetchAudio(_h, _ok, err) { if (err) err(_h, 2); },
    streamMusic(_h, err) { if (err) err(_h, 2); },
    setTimer(cb, ms, repeat) {
      const id = nextTimerId++;
      if (repeat) {
        activeTimers.set(id, { repeat: true, handle: setInterval(cb, ms) });
      } else {
        activeTimers.set(id, {
          repeat: false,
          handle: setTimeout(() => {
            activeTimers.delete(id);
            cb();
          }, ms),
        });
      }
      return id;
    },
    clearTimer(id) {
      const entry = activeTimers.get(id);
      if (!entry) return;
      if (entry.repeat) clearInterval(entry.handle);
      else clearTimeout(entry.handle);
      activeTimers.delete(id);
    },
    requestRender: () => {},
    addMenuButton: () => {},
    clearMenu: () => {},
    setOnSurfaceCreatedListener: () => {},
    setOnSurfaceChangedListener: () => {},
    setOnDrawFrameListener: () => {},
    setOnTouchListener: () => {},
    setOnMouseListener: () => {},
    setOnAvatarsReadyListener: () => {},
    setOnMenuButtonClickedListener: () => {},
    showGameOver: () => {},
    showItemPurchase: () => {},
    showProfile: () => {},
    requestKeyboard: () => {},
    sendMove: () => {},
    resetSynchronizationStream: () => {},
    alarm: {
      set(durationMs, alarmId) {
        scheduleServerAlarm(durationMs, alarmId);
      },
    },
    session: {
      changeTurn(turns, msg) {
        self.postMessage({ type: "turnChanged", turns, msg });
      },
      gameOver(finishOrder, msg, reason) {
        self.postMessage({ type: "gameOver", finishOrder, msg, reason });
      },
    },
    setGameLogic(registeredLogic) {
      const ParentClass = registeredLogic && Object.getPrototypeOf(registeredLogic.constructor);
      if (
        ParentClass &&
        ParentClass !== Function.prototype &&
        ParentClass.prototype &&
        Object.getPrototypeOf(ParentClass.prototype) &&
        typeof Object.getPrototypeOf(ParentClass.prototype).initialize === "function"
      ) {
        // Some bundles (Match Monsters) call this.setCustomPlugins() inside the shared base-class
        // constructor but define it on the derived (client-registered) class only. The pure server
        // class would then throw "this.setCustomPlugins is not a function", so borrow the method
        // from the registered class when the base class lacks it. Pool already has it: no change.
        if (
          typeof ParentClass.prototype.setCustomPlugins !== "function" &&
          typeof registeredLogic.constructor.prototype.setCustomPlugins === "function"
        ) {
          ParentClass.prototype.setCustomPlugins = registeredLogic.constructor.prototype.setCustomPlugins;
        }
        serverLogic = new ParentClass();
        if (
          Array.isArray(registeredLogic.customPlugins) &&
          Array.isArray(serverLogic.customPlugins) &&
          serverLogic.customPlugins.length === 0
        ) {
          serverLogic.customPlugins = registeredLogic.customPlugins;
        }
      } else {
        serverLogic = registeredLogic;
      }
      // Use ServerTotalTrust in offline local room since all seats share the same physical device screen
      if (serverLogic && "vMode" in serverLogic) {
        serverLogic.vMode = 3;
      }
    },
  };
}

function scheduleServerAlarm(durationMs, alarmId) {
  // Clear existing alarm with same id if any
  for (const [id, info] of serverAlarms.entries()) {
    if (id === alarmId || alarmId !== 4294967043) {
      clearTimeout(info.handle);
      serverAlarms.delete(id);
    }
  }
  const startMs = performance.now();
  const dur = Math.max(10, Number(durationMs) || 0);
  const handle = setTimeout(() => {
    serverAlarms.delete(alarmId);
    if (!serverLogic || serverLogic.gameOver) return;
    pendingReveals.clear();
    serverLogic.alarm({}, alarmId);
    const rev = collectRevealForSeat(0);
    self.postMessage({
      type: "serverAlarm",
      alarmId,
      reveal: rev,
          revealBySeat: allReveals(),
      turns: serverLogic.turn ? serverLogic.turn.slice() : [],
      gameOver: serverLogic.gameOver,
    });
  }, dur);
  serverAlarms.set(alarmId, { handle, startMs, durationMs: dur });
}

const pendingReveals = new Map();

// Per-seat reveals for LAN matches (one client per seat). Hotseat ignores this extra field.
function allReveals() {
  const o = {};
  for (let s = 0; s < numSeats; s++) o[s] = collectRevealForSeat(s) || null;
  return o;
}

function collectRevealForSeat(seat) {
  const globalRev = pendingReveals.get(-1);
  const seatRev = pendingReveals.get(seat);
  if (!globalRev && !seatRev) return undefined;
  return Object.assign({}, globalRev || {}, seatRev || {});
}

function wireServerCallbacks(logic) {
  logic.onGetInventory = () => unlockedInventory;
  logic.onSetAlarm = (durationMs, alarmId) => {
    scheduleServerAlarm(durationMs, alarmId);
  };
  logic.onGetAlarm = (alarmId) => {
    const info = serverAlarms.get(alarmId);
    if (!info) return undefined;
    const elapsed = performance.now() - info.startMs;
    const remaining = Math.max(0, Math.round(info.durationMs - elapsed));
    return [remaining, info.durationMs];
  };
  logic.onReveal = (seats, data) => {
    if (!Array.isArray(seats) || !data) return;
    for (const s of seats) {
      const prev = pendingReveals.get(s) || {};
      pendingReveals.set(s, Object.assign({}, prev, JSON.parse(JSON.stringify(data))));
    }
  };
  logic.onTurnChanged = (turns, msg) => {
    self.postMessage({ type: "turnChanged", turns: turns ? turns.slice() : [], msg });
  };
  logic.onGameOver = (finishOrder, msg, reason) => {
    self.postMessage({ type: "gameOver", finishOrder, msg, reason });
  };
}

self.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg) return;

  if (msg.type === "init") {
    textFiles = msg.textFiles || {};
    dictionary = msg.dictionary || {};
    language = msg.language || "ar";
    playerNames = msg.playerNames || ["اللاعب 1", "اللاعب 2"];
    unlockedInventory = msg.unlockedInventory || [];

    setupHeadlessGlobals();

    // Evaluate game main.js inside worker
    const fn = new Function(msg.mainCode);
    fn();

    if (!serverLogic) {
      self.postMessage({ type: "error", message: "Server logic failed to register via plato.setGameLogic" });
      return;
    }

    wireServerCallbacks(serverLogic);
    serverLogic.seed = msg.seed || Math.floor(Math.random() * 0x7fffffff);

    // Initialize authoritative server (localSeat = undefined -> server === true)
    numSeats = serverLogic.initialize(msg.settings || {}, undefined) || 2;

    // Join and enter all local players on this device
    for (let s = 0; s < numSeats; s++) {
      serverLogic.join(s);
    }
    for (let s = 0; s < numSeats; s++) {
      serverLogic.enter(s);
    }

    const initialTurn = serverLogic.turn && serverLogic.turn.length > 0 ? serverLogic.turn[0] : 0;
    const initialState = serverLogic.serialize(initialTurn);

    self.postMessage({
      type: "initialized",
      numSeats,
      initialSeat: initialTurn,
      turns: serverLogic.turn ? serverLogic.turn.slice() : [0],
      state: initialState,
    });
    return;
  }

  if (msg.type === "clientMove" && serverLogic) {
    const { seat, packet, activeClientSeat } = msg;
    pendingReveals.clear();

    // PhysicsLogic WorldState report from the single shared device screen:
    // Deliver identical WorldState report on behalf of all watching seats so validation completes in 0ms!
    if (packet && packet.__info !== undefined) {
      if (packet.__info && packet.__info.a === -1) {
        const order = [seat];
        for (let s = 0; s < numSeats; s++) {
          if (s !== seat) order.push(s);
        }
        for (const s of order) {
          const cloned = JSON.parse(JSON.stringify(packet));
          serverLogic.move(s, cloned);
        }
      } else {
        const cloned = JSON.parse(JSON.stringify(packet));
        serverLogic.move(seat, cloned);
      }

      const rev = collectRevealForSeat(activeClientSeat ?? seat);
      if (rev) {
        self.postMessage({
          type: "serverMove",
          seat,
          packet: { __info: 1 },
          reveal: rev,
          revealBySeat: allReveals(),
          turns: serverLogic.turn ? serverLogic.turn.slice() : [],
          gameOver: serverLogic.gameOver,
        });
      }
      return;
    }

    // Standard game move (shot, cue ball move, stick rotation, power, ready, resign, etc.)
    const moveCopy = JSON.parse(JSON.stringify(packet));
    const accepted = serverLogic.move(seat, moveCopy);
    if (!accepted) {
      // Send authoritative resync snapshot if move was rejected
      const targetSeat = serverLogic.turn && serverLogic.turn.length > 0 ? serverLogic.turn[0] : (activeClientSeat ?? seat);
      self.postMessage({
        type: "resyncState",
        seat: targetSeat,
        state: serverLogic.serialize(targetSeat),
        turns: serverLogic.turn ? serverLogic.turn.slice() : [],
      });
      return;
    }

    const rev = collectRevealForSeat(activeClientSeat ?? seat);
    self.postMessage({
      type: "serverMove",
      seat,
      packet,
      reveal: rev,
          revealBySeat: allReveals(),
      turns: serverLogic.turn ? serverLogic.turn.slice() : [],
      gameOver: serverLogic.gameOver,
    });
    return;
  }

  if (msg.type === "clientNetMessage") {
    if (globalThis.__deliverServerNetMessage) {
      globalThis.__deliverServerNetMessage(msg.bytes, msg.seat ?? 0);
    }
    return;
  }

  if (msg.type === "requestResync" && serverLogic) {
    const targetSeat = msg.seat ?? (serverLogic.turn && serverLogic.turn.length > 0 ? serverLogic.turn[0] : 0);
    self.postMessage({
      type: "resyncState",
      seat: targetSeat,
      state: serverLogic.serialize(targetSeat),
      turns: serverLogic.turn ? serverLogic.turn.slice() : [],
    });
  }
};
