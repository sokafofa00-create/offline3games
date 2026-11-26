// LAN lobby transport. On Android it talks to the native LanNet (UDP presence beacon + TCP lines, private addresses only).
// In a plain browser (CI tests) it falls back to the dev server's /__lan relay, which only simulates the network.
export function createLan({ id, name, onPeers, onMessage }) {
  const host = window.AndroidHost && typeof window.AndroidHost.lanStart === "function" ? window.AndroidHost : null;
  let timer = null;
  let interval = 600;
  let me = { id, name, ip: "" };
  const j = async (path, body) => (await fetch("/__lan/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const api = {
    mode: host ? "native" : "relay",
    get me() { return me; },
    async start() {
      if (host) host.lanStart(id, name);
      else await j("hello", { id, name, state: "available" });
      const tick = async () => {
        try {
          let st, evs;
          if (host) { st = JSON.parse(host.lanPeers()); evs = JSON.parse(host.lanPoll()); }
          else { const r = await j("poll", { id }); st = r; evs = r.events; }
          me = { ...me, ip: st.me?.ip || me.ip };
          onPeers(st.peers || [], me);
          for (const e of evs || []) onMessage(e);
        } catch (_e) {}
        timer = setTimeout(tick, interval);
      };
      tick();
    },
    fast(on) { interval = on ? 60 : 600; },
    stop() { clearTimeout(timer); timer = null; if (host) host.lanStop(); else j("bye", { id }).catch(() => {}); },
    setState(state) { if (host) host.lanSetState(state); else j("hello", { id, name, state }).catch(() => {}); },
    // Sends to every online peer. Returns the number reached.
    async broadcast(msg) { msg = { ...msg, from: id, name }; if (host) return host.lanBroadcast(JSON.stringify(msg)); return (await j("broadcast", { from: id, msg })).n; },
    async sendTo(peer, msg) { msg = { ...msg, from: id, name }; if (host) return host.lanSend(peer.ip, JSON.stringify(msg)); return (await j("send", { to: peer.id, msg })).ok; },
  };
  return api;
}
