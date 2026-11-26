package com.local.offlinegames

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintWriter
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Local-network-only transport: UDP presence beacon + line-based TCP messages.
 * Every address is checked with [isPrivate]; anything outside loopback / 10/8 / 172.16/12 / 192.168/16 / 169.254/16
 * is refused for both outgoing and incoming traffic. No internet host is ever contacted.
 */
class LanNet {
    companion object {
        const val BEACON_PORT = 47831
        const val TCP_PORT = 47832
        const val PEER_TTL_MS = 8000L

        fun isPrivate(a: InetAddress): Boolean {
            if (a.isLoopbackAddress) return true
            val b = (a as? Inet4Address)?.address ?: return a.isLinkLocalAddress || a.isSiteLocalAddress
            val b0 = b[0].toInt() and 0xff
            val b1 = b[1].toInt() and 0xff
            return b0 == 10 || (b0 == 172 && b1 in 16..31) || (b0 == 192 && b1 == 168) || (b0 == 169 && b1 == 254)
        }
    }

    private val running = AtomicBoolean(false)
    private val events = ConcurrentLinkedQueue<String>()
    private class Peer(val id: String, val name: String, val ip: String, var state: String, var seen: Long)
    private val peers = ConcurrentHashMap<String, Peer>()
    private var myId = ""
    private var myName = ""
    private var myState = "available"
    private var beacon: DatagramSocket? = null
    private var server: ServerSocket? = null
    private val conns = ConcurrentHashMap<String, Socket>()

    fun localAddresses(): List<Pair<InetAddress, InetAddress?>> {
        val out = ArrayList<Pair<InetAddress, InetAddress?>>()
        try {
            for (ni in NetworkInterface.getNetworkInterfaces()) {
                if (!ni.isUp || ni.isLoopback) continue
                for (ia in ni.interfaceAddresses) {
                    val a = ia.address
                    if (a is Inet4Address && isPrivate(a)) out.add(Pair(a, ia.broadcast))
                }
            }
        } catch (_: Exception) {}
        return out
    }

    fun myIp(): String = localAddresses().firstOrNull()?.first?.hostAddress ?: ""

    @Synchronized
    fun start(id: String, name: String) {
        if (running.get()) { myName = name; return }
        myId = id; myName = name; myState = "available"
        running.set(true)
        Thread { runServer() }.apply { isDaemon = true; start() }
        Thread { runBeaconListener() }.apply { isDaemon = true; start() }
        Thread { runBeaconSender() }.apply { isDaemon = true; start() }
    }

    @Synchronized
    fun stop() {
        running.set(false)
        try { beacon?.close() } catch (_: Exception) {}
        try { server?.close() } catch (_: Exception) {}
        conns.values.forEach { try { it.close() } catch (_: Exception) {} }
        conns.clear(); peers.clear()
    }

    fun setState(s: String) { myState = s }

    private fun runServer() {
        try {
            val ss = ServerSocket()
            ss.reuseAddress = true
            ss.bind(InetSocketAddress(TCP_PORT))
            server = ss
            while (running.get()) {
                val s = ss.accept()
                if (!isPrivate(s.inetAddress)) { try { s.close() } catch (_: Exception) {}; continue }
                Thread { readLoop(s) }.apply { isDaemon = true; start() }
            }
        } catch (_: Exception) {}
    }

    private fun readLoop(s: Socket) {
        try {
            val r = BufferedReader(InputStreamReader(s.getInputStream(), Charsets.UTF_8))
            while (running.get()) {
                val line = r.readLine() ?: break
                if (line.length > 65536) continue
                try {
                    val o = JSONObject(line)
                    o.put("fromIp", s.inetAddress.hostAddress)
                    events.add(o.toString())
                } catch (_: Exception) {}
            }
        } catch (_: Exception) {}
        try { s.close() } catch (_: Exception) {}
    }

    private fun runBeaconListener() {
        try {
            val ds = DatagramSocket(null)
            ds.reuseAddress = true
            ds.broadcast = true
            ds.bind(InetSocketAddress(BEACON_PORT))
            beacon = ds
            val buf = ByteArray(2048)
            while (running.get()) {
                val p = DatagramPacket(buf, buf.size)
                ds.receive(p)
                if (!isPrivate(p.address)) continue
                try {
                    val o = JSONObject(String(p.data, 0, p.length, Charsets.UTF_8))
                    val id = o.getString("id")
                    if (id == myId || o.optString("app") != "offline-games") continue
                    val ip = p.address.hostAddress ?: continue
                    peers[id] = Peer(id, o.optString("name", "?").take(24), ip, o.optString("state", "available"), System.currentTimeMillis())
                } catch (_: Exception) {}
            }
        } catch (_: Exception) {}
    }

    private fun runBeaconSender() {
        try {
            val ds = DatagramSocket()
            ds.broadcast = true
            while (running.get()) {
                val msg = JSONObject().put("app", "offline-games").put("id", myId).put("name", myName).put("state", myState).toString().toByteArray(Charsets.UTF_8)
                for ((_, bc) in localAddresses()) {
                    if (bc == null || !isPrivate(bc)) continue
                    try { ds.send(DatagramPacket(msg, msg.size, bc, BEACON_PORT)) } catch (_: Exception) {}
                }
                Thread.sleep(2000)
            }
            ds.close()
        } catch (_: Exception) {}
    }

    fun peersJson(): String {
        val now = System.currentTimeMillis()
        val arr = JSONArray()
        for ((id, p) in peers) {
            if (now - p.seen > PEER_TTL_MS) { peers.remove(id); continue }
            arr.put(JSONObject().put("id", p.id).put("name", p.name).put("ip", p.ip).put("state", p.state))
        }
        return JSONObject().put("me", JSONObject().put("id", myId).put("name", myName).put("ip", myIp())).put("peers", arr).toString()
    }

    /** Sends one JSON line to a private-address peer over TCP. Returns false if refused or failed. */
    fun send(ip: String, json: String): Boolean {
        return try {
            val addr = InetAddress.getByName(ip)
            if (!isPrivate(addr)) return false
            val key = addr.hostAddress ?: return false
            var s = conns[key]
            if (s == null || s.isClosed || !s.isConnected) {
                s = Socket()
                s.connect(InetSocketAddress(addr, TCP_PORT), 2000)
                conns[key] = s
                val sock = s
                Thread { readLoop(sock) }.apply { isDaemon = true; start() }
            }
            val w = PrintWriter(java.io.OutputStreamWriter(s.getOutputStream(), Charsets.UTF_8), true)
            w.println(json.replace("\n", " "))
            !w.checkError()
        } catch (_: Exception) { conns.remove(ip); false }
    }

    fun broadcast(json: String): Int {
        var n = 0
        for ((_, p) in peers) if (send(p.ip, json)) n++
        return n
    }

    fun poll(): String {
        val arr = JSONArray()
        while (true) { val e = events.poll() ?: break; arr.put(JSONObject(e)) }
        return arr.toString()
    }
}
