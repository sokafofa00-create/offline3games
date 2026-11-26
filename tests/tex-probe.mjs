import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage();
await p.setContent("<canvas id=c width=4 height=4></canvas>");
const r = await p.evaluate(async () => {
  const mk = async (opt) => {
    const c = document.createElement("canvas"); c.width = 1; c.height = 1; const x = c.getContext("2d");
    x.fillStyle = "rgba(255,255,255,0.5)"; x.fillRect(0, 0, 1, 1);
    const blob = await new Promise((res) => c.toBlob(res, "image/png"));
    return createImageBitmap(blob, { premultiplyAlpha: opt, colorSpaceConversion: "none" });
  };
  const gl = document.getElementById("c").getContext("webgl2", { premultipliedAlpha: true });
  const out = { renderer: gl.getParameter(gl.RENDERER) };
  for (const opt of ["none", "premultiply"]) for (const unpack of [true, false]) {
    const bmp = await mk(opt); const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, unpack);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    out[`bitmap=${opt},unpackPremul=${unpack}`] = Array.from(px).join(",");
  }
  return out;
});
console.log("TEXPROBE " + JSON.stringify(r, null, 1));
await b.close();
# rerun 2 public repo
