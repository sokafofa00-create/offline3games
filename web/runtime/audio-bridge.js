// Web Audio API Bridge for Offline Plato Runtime (.m4a / .wav / .ogg)
export function createAudioBridge(assetStore) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = AudioCtx ? new AudioCtx() : null;

  let nextAudioId = 1;
  const uriToId = new Map();
  const idToBuffer = new Map();
  const pendingDecodes = new Map();

  let currentMusicNode = null;
  let currentMusicGain = null;
  let currentMusicVolume = 0.8;
  let masterMuted = false;

  const AudioController = {
    get musicVolume() {
      return currentMusicVolume;
    },
    set musicVolume(v) {
      currentMusicVolume = Math.max(0, Math.min(1, Number(v) ?? 0.8));
      if (currentMusicGain && !masterMuted) {
        currentMusicGain.gain.value = currentMusicVolume;
      }
    },
  };

  // Unlock AudioContext automatically on first user gesture
  function unlockAudio() {
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
  }
  window.addEventListener("pointerdown", unlockAudio, { passive: true });
  window.addEventListener("touchstart", unlockAudio, { passive: true });
  window.addEventListener("keydown", unlockAudio, { passive: true });

  function decodeAndStore(id, arrayBuffer) {
    if (!ctx || !arrayBuffer) return Promise.resolve(null);
    // Slice buffer because decodeAudioData detaches the ArrayBuffer
    const copy = arrayBuffer.slice(0);
    const p = ctx
      .decodeAudioData(copy)
      .then((audioBuf) => {
        idToBuffer.set(id, audioBuf);
        pendingDecodes.delete(id);
        return audioBuf;
      })
      .catch(() => {
        pendingDecodes.delete(id);
        return null;
      });
    pendingDecodes.set(id, p);
    return p;
  }

  function playBuffer(buf, volLeft = 1, volRight = 1, loop = false, rate = 1) {
    if (!ctx || !buf || masterMuted) return null;
    unlockAudio();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = Boolean(loop);
    if (isFinite(rate) && rate > 0) {
      src.playbackRate.value = Math.max(0.25, Math.min(4, rate));
    }

    const gain = ctx.createGain();
    const avgVol = Math.max(0, Math.min(2, ((volLeft ?? 1) + (volRight ?? 1)) * 0.5));
    gain.gain.value = avgVol;

    if (typeof ctx.createStereoPanner === "function" && volLeft !== volRight) {
      const sum = (volLeft || 0) + (volRight || 0);
      const pan = sum > 0 ? Math.max(-1, Math.min(1, ((volRight || 0) - (volLeft || 0)) / sum)) : 0;
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      src.connect(panner);
      panner.connect(gain);
    } else {
      src.connect(gain);
    }

    gain.connect(ctx.destination);
    try {
      src.start(0);
    } catch (_) {}
    return { src, gain };
  }

  function stopMusicInternal() {
    if (currentMusicNode) {
      try {
        currentMusicNode.stop();
        currentMusicNode.disconnect();
      } catch (_) {}
      currentMusicNode = null;
      currentMusicGain = null;
    }
  }

  const audio = {
    load(uri) {
      const normalized = assetStore.normalizeGamePath(uri);
      if (uriToId.has(normalized)) {
        return uriToId.get(normalized);
      }
      const id = nextAudioId++;
      uriToId.set(normalized, id);
      const raw = assetStore.getAudioBytes(normalized);
      if (raw) {
        decodeAndStore(id, raw);
      }
      return id;
    },

    play(id, volLeft = 1, volRight = 1, loop = false, rate = 1, _priority = false) {
      const buf = idToBuffer.get(id);
      if (buf) {
        playBuffer(buf, volLeft, volRight, loop, rate);
      } else if (pendingDecodes.has(id)) {
        pendingDecodes.get(id).then((b) => {
          if (b) playBuffer(b, volLeft, volRight, loop, rate);
        });
      }
    },

    playMusic(uri, vol = 1, loop = 1) {
      stopMusicInternal();
      const id = this.load(uri);
      const startFromBuf = (b) => {
        if (!b || masterMuted) return;
        stopMusicInternal();
        const res = playBuffer(b, vol, vol, Boolean(loop), 1);
        if (res) {
          currentMusicNode = res.src;
          currentMusicGain = res.gain;
        }
      };
      const buf = idToBuffer.get(id);
      if (buf) startFromBuf(buf);
      else if (pendingDecodes.has(id)) pendingDecodes.get(id).then(startFromBuf);
    },

    stopMusic() {
      stopMusicInternal();
    },

    unload(id) {
      idToBuffer.delete(id);
    },
  };

  async function fetchDynamicAudio(hash, okCb, errCb) {
    try {
      const resp = await fetch(`./assets/${hash}`);
      if (!resp.ok) {
        errCb(hash, 2); // RemoteFileNotFound
        return;
      }
      const bytes = await resp.arrayBuffer();
      const id = nextAudioId++;
      const decoded = await decodeAndStore(id, bytes);
      if (decoded) okCb(hash, id);
      else errCb(hash, 10);
    } catch (_) {
      errCb(hash, 2);
    }
  }

  async function streamDynamicMusic(hash, errCb) {
    stopMusicInternal();
    try {
      const resp = await fetch(`./assets/${hash}`);
      if (!resp.ok) {
        if (errCb) errCb(hash, 2);
        return;
      }
      const bytes = await resp.arrayBuffer();
      const tempId = nextAudioId++;
      const buf = await decodeAndStore(tempId, bytes);
      if (!buf) {
        if (errCb) errCb(hash, 10);
        return;
      }
      if (!masterMuted) {
        stopMusicInternal();
        const res = playBuffer(buf, currentMusicVolume, currentMusicVolume, true, 1);
        if (res) {
          currentMusicNode = res.src;
          currentMusicGain = res.gain;
        }
      }
    } catch (_) {
      if (errCb) errCb(hash, 2);
    }
  }

  function setMasterMuted(muted) {
    masterMuted = Boolean(muted);
    if (masterMuted) {
      stopMusicInternal();
    }
  }

  return {
    audio,
    AudioController,
    fetchDynamicAudio,
    streamDynamicMusic,
    setMasterMuted,
    isMasterMuted: () => masterMuted,
    destroy() {
      stopMusicInternal();
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      if (ctx && ctx.state !== "closed") {
        ctx.close().catch(() => {});
      }
    },
  };
}
