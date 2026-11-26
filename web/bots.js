// Computer players for Match Monsters and Brawlbots (hot-seat app, no network).
// The bot drives its seat through the same client-logic calls the on-screen controls use (localMove / plugin moves).
// Difficulty: "easy" | "medium" | "hard". It only acts when the game is not paused and the bridge has switched
// _localSeat to the bot seat, so it never acts out of turn and never touches a human seat.

const rnd = (a, b) => a + Math.random() * (b - a);
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

function monstersDraft(l, seat, diff) {
  const p = l.plugins()[0];
  if (!p || typeof p.canConfirm !== "function") return false;
  let did = false;
  for (let n = 0; n < 8 && !p.canConfirm(seat); n++) {
    const cands = [];
    p.selectable.forEach((m, ix) => {
      if (m.sku !== 0 && p.canSelect(seat, m.key) && !p.selecting[seat].some((x) => x && x.key === m.key) && !p.confirmed[seat].some((x) => x && x.key === m.key)) cands.push(m);
    });
    if (!cands.length) break;
    const m = diff === "easy" ? pickRandom(cands) : cands[0];
    p.moveSelect(m, p.selecting[seat].length + p.confirmed[seat].length);
    did = true;
  }
  if (p.canConfirm(seat)) { p.moveConfirm(); did = true; }
  return did;
}

function monstersSwap(l, seat, diff) {
  const b = l.board;
  if (!b) return false;
  const moves = [];
  for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const x2 = x + dx, y2 = y + dy;
    if (x2 >= b.width || y2 >= b.height || !b.areTilesAdjacent(x, y, x2, y2)) continue;
    b.swapTiles(x, y, x2, y2);
    const ms = b.getMatches(b.tiles[y2][x2]);
    b.swapTiles(x2, y2, x, y);
    if (ms && ms.length) moves.push({ x1: x, y1: y, x2, y2, score: ms.length });
  }
  if (!moves.length) return false;
  moves.sort((a, c) => c.score - a.score);
  let m;
  if (diff === "hard") m = moves[0];
  else if (diff === "medium") m = pickRandom(moves.slice(0, Math.max(1, Math.ceil(moves.length / 3))));
  else m = pickRandom(moves);
  return !!l.localMove({ t: 6, x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2 }, true);
}

function pos(t) {
  const p = t && (t.position || t.pos || t);
  if (!p) return null;
  if (Array.isArray(p) && p.length >= 2) return { x: +p[0], y: +p[1] };
  if (typeof p.x === "number" && typeof p.y === "number") return { x: p.x, y: p.y };
  return null;
}

function brawlbotsAct(l, seat, diff) {
  if (!l.worldMap) return false;
  const selected = l.worldMap.tanksSelected(true);
  if (!selected && l.canSelectTank(seat, 0)) {
    const own = [];
    for (let i = 0; i < 16; i++) { try { if (l.isTankOwned(seat, i)) own.push(i); } catch (_e) {} }
    if (!own.length) return false;
    return !!l.localMove({ a: 1, t: diff === "easy" ? pickRandom(own) : own[0] });
  }
  if (selected && l.canShoot(seat, true)) {
    const weapons = [];
    for (let i = 0; i < 4; i++) { try { if (l.canSelectWeapon(seat, i)) weapons.push(i); } catch (_e) {} }
    const w = weapons.length ? (diff === "hard" ? weapons[weapons.length - 1] : pickRandom(weapons)) : 0;
    // Aim at the nearest enemy tank with an angle error that shrinks with difficulty. Power 3.0 is the validator's safe limit.
    let ang = rnd(-Math.PI * 0.15, Math.PI * 0.85);
    try {
      const me = pos(l.worldMap.tanks[seat]);
      let best = null;
      l.worldMap.tanks.forEach((t, s) => { if (s === seat) return; const p = pos(t); if (me && p) { const d = Math.hypot(p.x - me.x, p.y - me.y); if (!best || d < best.d) best = { p, d }; } });
      if (me && best) {
        const err = { easy: 0.6, medium: 0.25, hard: 0.08 }[diff] ?? 0.25;
        ang = Math.atan2(best.p.y - me.y, best.p.x - me.x) + rnd(-err, err);
      }
    } catch (_e) {}
    const pow = 3.0 * (diff === "easy" ? rnd(0.5, 0.9) : 0.98);
    return !!l.localMove({ a: 5, i: [pow * Math.cos(ang), pow * Math.sin(ang)], p: w, f: 0, u: false }, false);
  }
  return false;
}

// Starts the bot driver. Returns { stop, log }.
export function startBots({ getLogic, botSeats, difficulty, game }) {
  const seats = new Set(botSeats);
  const log = [];
  let lastKey = "";
  let lastAt = 0;
  const tick = () => {
    const l = getLogic();
    if (!l || !l.started || l.gameOver || l.paused) return;
    const turns = Array.isArray(l.turn) ? l.turn : [];
    const seat = l._localSeat;
    if (!seats.has(seat) || !turns.includes(seat)) return;
    // Wait for the game's own state to change before acting again on the same seat (no fixed timers beyond a minimum gap).
    const key = [game, seat, l.moveCount, l.gamePhase, JSON.stringify(l.turn)].join("|");
    const now = Date.now();
    if (key === lastKey && now - lastAt < 4000) return;
    if (now - lastAt < 700) return;
    let acted = false;
    try {
      if (game === "monsters") acted = l.gamePhase === 0 ? monstersDraft(l, seat, difficulty) : monstersSwap(l, seat, difficulty);
      else if (game === "brawlbots") acted = brawlbotsAct(l, seat, difficulty);
    } catch (e) { log.push({ err: String(e && e.message).slice(0, 120), seat }); }
    if (log.length < 200) log.push({ t: now, seat, acted, phase: l.gamePhase });
    lastKey = key; lastAt = now;
  };
  const id = setInterval(tick, 350);
  return { stop: () => clearInterval(id), log };
}
