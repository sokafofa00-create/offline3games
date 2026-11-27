// On-screen diagnostics (no network). Errors always show a small red box; __diagShow() adds device/WebGL/canvas info for a while.
(function () {
  var errs = [], box = null;
  function mk() {
    if (box) return box;
    box = document.createElement("pre");
    box.style.cssText = "position:fixed;left:0;top:0;right:0;max-height:60vh;overflow:auto;margin:0;padding:6px;z-index:2147483647;font:11px monospace;color:#fff;background:rgba(120,0,0,.85);white-space:pre-wrap;pointer-events:auto;direction:ltr;text-align:left";
    box.addEventListener("click", function () { box.style.display = "none"; });
    (document.body || document.documentElement).appendChild(box);
    return box;
  }
  function add(m) { errs.push(String(m).slice(0, 300)); if (errs.length > 8) errs.shift(); render(); }
  var info = false, t0 = 0;
  function webgl() {
    try {
      var c = document.createElement("canvas"), g2 = c.getContext("webgl2"), g = g2 || c.getContext("webgl");
      if (!g) return "webgl: NONE";
      var d = g.getExtension("WEBGL_debug_renderer_info");
      return (g2 ? "webgl2" : "webgl1") + " tex" + g.getParameter(g.MAX_TEXTURE_SIZE) + " " + (d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER));
    } catch (e) { return "webgl err " + e; }
  }
  function render() {
    var lines = [];
    if (info) {
      var cv = Array.prototype.map.call(document.querySelectorAll("canvas"), function (c) { return c.width + "x" + c.height + (c.offsetWidth ? "" : "(hidden)"); });
      lines.push("DIAG " + navigator.userAgent, webgl(), "win " + innerWidth + "x" + innerHeight + " dpr " + devicePixelRatio, "canvas " + cv.join(" "), "stage " + (window.__diagStage || "-"));
    }
    if (!info) { if (box) box.style.display = "none"; return; }
    var b = mk(); b.style.display = "block";
    b.style.background = errs.length ? "rgba(120,0,0,.85)" : "rgba(0,0,0,.6)";
    b.textContent = lines.concat(errs.map(function (e) { return "ERR " + e; })).join("\n");
  }
  window.addEventListener("error", function (e) { add((e.message || "error") + " @" + (e.filename || "").split("/").pop() + ":" + e.lineno); });
  window.addEventListener("unhandledrejection", function (e) { var r = e.reason; add("rej " + (r && (r.stack || r.message) || JSON.stringify(r))); });
  window.__diagShow = function () { info = true; t0 = Date.now(); render(); var iv = setInterval(function () { render(); if (Date.now() - t0 > 90000) { info = false; clearInterval(iv); render(); } }, 2000); };
})();
