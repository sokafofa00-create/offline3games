// C-style OpenGL ES 2.0 -> WebGL2/WebGL1 Bridge for Offline Plato Runtime
export function createGLBridge(canvas, assetStore) {
  const ctxAttrs = {
    alpha: false,
    depth: true,
    stencil: true,
    antialias: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  };

  const gl =
    canvas.getContext("webgl2", ctxAttrs) ||
    canvas.getContext("webgl", ctxAttrs) ||
    canvas.getContext("experimental-webgl", ctxAttrs);

  if (!gl) {
    throw new Error("WebGL غير مدعوم على هذا الجهاز");
  }

  const isWebGL2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;

  let nextId = 1;
  const buffers = new Map();
  const textures = new Map();
  const framebuffers = new Map();
  const renderbuffers = new Map();
  const renderbufferFormats = new Map();
  const shaders = new Map();
  const programs = new Map();
  const uniforms = new Map();

  // Reusable 2D canvas for synchronous text texture generation
  const textCanvas = document.createElement("canvas");
  const textCtx = textCanvas.getContext("2d", { willReadFrequently: false });

  function argbIntToCss(argb) {
    const u = argb >>> 0;
    const a = ((u >>> 24) & 0xff) / 255;
    const r = (u >>> 16) & 0xff;
    const g = (u >>> 8) & 0xff;
    const b = u & 0xff;
    return `rgba(${r},${g},${b},${a.toFixed(4)})`;
  }

  function normalizeHexColor(c) {
    if (!c || c === "#") return "#ffffff";
    if (c.startsWith("#")) {
      const hex = c.slice(1);
      if (hex.length === 6) return c;
      if (hex.length < 6) return "#" + hex.padStart(6, "0");
      if (hex.length === 8) {
        // #AARRGGBB -> rgba
        const a = parseInt(hex.slice(0, 2), 16) / 255;
        const r = parseInt(hex.slice(2, 4), 16);
        const g = parseInt(hex.slice(4, 6), 16);
        const b = parseInt(hex.slice(6, 8), 16);
        return `rgba(${r},${g},${b},${a.toFixed(4)})`;
      }
    }
    return c;
  }

  function buildFontCss(fontName, sizePx) {
    const s = Math.max(8, Math.round(Number(sizePx) || 28));
    const f = String(fontName || "").toLowerCase();
    let weight = "500";
    let style = "normal";
    if (f.includes("black") || f.includes("heavy") || f.includes("extrabold")) weight = "800";
    else if (f.includes("bold") && !f.includes("semi")) weight = "700";
    else if (f.includes("semi") || f.includes("demi") || f.includes("medium")) weight = "600";
    else if (f.includes("light")) weight = "300";
    if (f.includes("italic") || f.includes("oblique")) style = "italic";
    return `${style} ${weight} ${s}px "Cairo", "Noto Sans Arabic", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  }

  function wrapLines(ctx, rawText, maxWidth) {
    const paragraphs = String(rawText ?? "").split(/\r?\n/);
    if (!maxWidth || maxWidth <= 0 || !isFinite(maxWidth)) {
      return paragraphs;
    }
    const lines = [];
    for (const para of paragraphs) {
      if (!para) {
        lines.push("");
        continue;
      }
      const words = para.split(/(\s+)/);
      let current = "";
      for (const token of words) {
        const candidate = current + token;
        if (current && ctx.measureText(candidate).width > maxWidth) {
          lines.push(current.trimEnd());
          current = token.trimStart();
          // Handle single super-long word without spaces
          while (current && ctx.measureText(current).width > maxWidth && current.length > 1) {
            let cut = current.length - 1;
            while (cut > 1 && ctx.measureText(current.slice(0, cut)).width > maxWidth) cut--;
            lines.push(current.slice(0, cut));
            current = current.slice(cut);
          }
        } else {
          current = candidate;
        }
      }
      if (current || lines.length === 0) lines.push(current);
    }
    return lines;
  }

  function uploadCanvasToBoundTexture(target, level, cnv) {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(target, level, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cnv);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  function uploadBitmapToTarget(target, level, bitmap) {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(target, level, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  const GL = {
    NONE: 0,
    ZERO: gl.ZERO,
    ONE: gl.ONE,
    SRC_COLOR: gl.SRC_COLOR,
    ONE_MINUS_SRC_COLOR: gl.ONE_MINUS_SRC_COLOR,
    SRC_ALPHA: gl.SRC_ALPHA,
    ONE_MINUS_SRC_ALPHA: gl.ONE_MINUS_SRC_ALPHA,
    DST_ALPHA: gl.DST_ALPHA,
    ONE_MINUS_DST_ALPHA: gl.ONE_MINUS_DST_ALPHA,
    DST_COLOR: gl.DST_COLOR,
    ONE_MINUS_DST_COLOR: gl.ONE_MINUS_DST_COLOR,
    SRC_ALPHA_SATURATE: gl.SRC_ALPHA_SATURATE,

    POINTS: gl.POINTS,
    LINES: gl.LINES,
    LINE_LOOP: gl.LINE_LOOP,
    LINE_STRIP: gl.LINE_STRIP,
    TRIANGLES: gl.TRIANGLES,
    TRIANGLE_STRIP: gl.TRIANGLE_STRIP,
    TRIANGLE_FAN: gl.TRIANGLE_FAN,

    ARRAY_BUFFER: gl.ARRAY_BUFFER,
    ELEMENT_ARRAY_BUFFER: gl.ELEMENT_ARRAY_BUFFER,
    STATIC_DRAW: gl.STATIC_DRAW,
    DYNAMIC_DRAW: gl.DYNAMIC_DRAW,
    STREAM_DRAW: gl.STREAM_DRAW,

    FRONT: gl.FRONT,
    BACK: gl.BACK,
    FRONT_AND_BACK: gl.FRONT_AND_BACK,

    TEXTURE_2D: gl.TEXTURE_2D,
    CULL_FACE: gl.CULL_FACE,
    BLEND: gl.BLEND,
    DITHER: gl.DITHER,
    STENCIL_TEST: gl.STENCIL_TEST,
    DEPTH_TEST: gl.DEPTH_TEST,
    SCISSOR_TEST: gl.SCISSOR_TEST,

    NEVER: gl.NEVER,
    LESS: gl.LESS,
    EQUAL: gl.EQUAL,
    LEQUAL: gl.LEQUAL,
    GREATER: gl.GREATER,
    NOTEQUAL: gl.NOTEQUAL,
    GEQUAL: gl.GEQUAL,
    ALWAYS: gl.ALWAYS,

    KEEP: gl.KEEP,
    REPLACE: gl.REPLACE,
    INCR: gl.INCR,
    DECR: gl.DECR,
    INVERT: gl.INVERT,
    INCR_WRAP: gl.INCR_WRAP,
    DECR_WRAP: gl.DECR_WRAP,

    NEAREST: gl.NEAREST,
    LINEAR: gl.LINEAR,
    NEAREST_MIPMAP_NEAREST: gl.NEAREST_MIPMAP_NEAREST,
    LINEAR_MIPMAP_NEAREST: gl.LINEAR_MIPMAP_NEAREST,
    NEAREST_MIPMAP_LINEAR: gl.NEAREST_MIPMAP_LINEAR,
    LINEAR_MIPMAP_LINEAR: gl.LINEAR_MIPMAP_LINEAR,

    TEXTURE_MAG_FILTER: gl.TEXTURE_MAG_FILTER,
    TEXTURE_MIN_FILTER: gl.TEXTURE_MIN_FILTER,
    TEXTURE_WRAP_S: gl.TEXTURE_WRAP_S,
    TEXTURE_WRAP_T: gl.TEXTURE_WRAP_T,
    REPEAT: gl.REPEAT,
    CLAMP_TO_EDGE: gl.CLAMP_TO_EDGE,
    MIRRORED_REPEAT: gl.MIRRORED_REPEAT,

    TEXTURE0: gl.TEXTURE0,
    TEXTURE1: gl.TEXTURE1,
    TEXTURE2: gl.TEXTURE2,
    TEXTURE3: gl.TEXTURE3,
    TEXTURE4: gl.TEXTURE4,
    TEXTURE5: gl.TEXTURE5,
    TEXTURE6: gl.TEXTURE6,
    TEXTURE7: gl.TEXTURE7,

    TEXTURE_CUBE_MAP: gl.TEXTURE_CUBE_MAP,
    TEXTURE_CUBE_MAP_POSITIVE_X: gl.TEXTURE_CUBE_MAP_POSITIVE_X,

    BYTE: gl.BYTE,
    UNSIGNED_BYTE: gl.UNSIGNED_BYTE,
    SHORT: gl.SHORT,
    UNSIGNED_SHORT: gl.UNSIGNED_SHORT,
    INT: gl.INT,
    UNSIGNED_INT: gl.UNSIGNED_INT,
    FLOAT: gl.FLOAT,

    ALPHA: gl.ALPHA,
    RGB: gl.RGB,
    RGBA: gl.RGBA,
    LUMINANCE: gl.LUMINANCE,
    LUMINANCE_ALPHA: gl.LUMINANCE_ALPHA,

    FRAGMENT_SHADER: gl.FRAGMENT_SHADER,
    VERTEX_SHADER: gl.VERTEX_SHADER,
    COMPILE_STATUS: gl.COMPILE_STATUS,
    LINK_STATUS: gl.LINK_STATUS,
    LOW_FLOAT: gl.LOW_FLOAT,
    MEDIUM_FLOAT: gl.MEDIUM_FLOAT,
    HIGH_FLOAT: gl.HIGH_FLOAT,

    FRAMEBUFFER: gl.FRAMEBUFFER,
    RENDERBUFFER: gl.RENDERBUFFER,
    COLOR_ATTACHMENT0: gl.COLOR_ATTACHMENT0,
    DEPTH_ATTACHMENT: gl.DEPTH_ATTACHMENT,
    STENCIL_ATTACHMENT: gl.STENCIL_ATTACHMENT,
    DEPTH_STENCIL_ATTACHMENT: gl.DEPTH_STENCIL_ATTACHMENT,
    FRAMEBUFFER_COMPLETE: gl.FRAMEBUFFER_COMPLETE,

    DEPTH_BUFFER_BIT: gl.DEPTH_BUFFER_BIT,
    STENCIL_BUFFER_BIT: gl.STENCIL_BUFFER_BIT,
    COLOR_BUFFER_BIT: gl.COLOR_BUFFER_BIT,
    MAX_TEXTURE_SIZE: gl.MAX_TEXTURE_SIZE,

    // --- Resource Generation & Deletion (C-Style Int32Array Handles) ---
    genBuffers(n, outArr) {
      for (let i = 0; i < n; i++) {
        const id = nextId++;
        buffers.set(id, gl.createBuffer());
        outArr[i] = id;
      }
    },
    deleteBuffers(n, arr) {
      for (let i = 0; i < n; i++) {
        const id = arr[i];
        const b = buffers.get(id);
        if (b) {
          gl.deleteBuffer(b);
          buffers.delete(id);
        }
      }
    },
    genTextures(n, outArr) {
      for (let i = 0; i < n; i++) {
        const id = nextId++;
        textures.set(id, gl.createTexture());
        outArr[i] = id;
      }
    },
    deleteTextures(n, arr) {
      for (let i = 0; i < n; i++) {
        const id = arr[i];
        const t = textures.get(id);
        if (t) {
          gl.deleteTexture(t);
          textures.delete(id);
        }
      }
    },
    genFramebuffers(n, outArr) {
      for (let i = 0; i < n; i++) {
        const id = nextId++;
        framebuffers.set(id, gl.createFramebuffer());
        outArr[i] = id;
      }
    },
    deleteFramebuffers(n, arr) {
      for (let i = 0; i < n; i++) {
        const id = arr[i];
        const fb = framebuffers.get(id);
        if (fb) {
          gl.deleteFramebuffer(fb);
          framebuffers.delete(id);
        }
      }
    },
    genRenderbuffers(n, outArr) {
      for (let i = 0; i < n; i++) {
        const id = nextId++;
        renderbuffers.set(id, gl.createRenderbuffer());
        outArr[i] = id;
      }
    },
    deleteRenderbuffers(n, arr) {
      for (let i = 0; i < n; i++) {
        const id = arr[i];
        const rb = renderbuffers.get(id);
        if (rb) {
          gl.deleteRenderbuffer(rb);
          renderbuffers.delete(id);
          renderbufferFormats.delete(id);
        }
      }
    },

    // --- State & Binding ---
    activeTexture(unit) {
      gl.activeTexture(unit);
    },
    bindTexture(target, id) {
      gl.bindTexture(target, id ? textures.get(id) || null : null);
    },
    bindBuffer(target, id) {
      gl.bindBuffer(target, id ? buffers.get(id) || null : null);
    },
    bindFramebuffer(target, id) {
      gl.bindFramebuffer(target, id ? framebuffers.get(id) || null : null);
    },
    bindRenderbuffer(target, id) {
      this._boundRenderbufferId = id || 0;
      gl.bindRenderbuffer(target, id ? renderbuffers.get(id) || null : null);
    },
    bufferData(target, byteLength, data, usage) {
      if (data != null) {
        gl.bufferData(target, data, usage);
      } else {
        gl.bufferData(target, byteLength, usage);
      }
    },
    renderbufferStorage(target, internalformat, width, height) {
      const rbId = this._boundRenderbufferId || 0;
      renderbufferFormats.set(rbId, internalformat);
      if (internalformat === 35056) {
        // GL_DEPTH24_STENCIL8_OES
        const fmt = isWebGL2 ? gl.DEPTH24_STENCIL8 : gl.DEPTH_STENCIL;
        gl.renderbufferStorage(target, fmt, width, height);
      } else {
        gl.renderbufferStorage(target, internalformat, width, height);
      }
    },
    framebufferTexture2D(target, attachment, textarget, texId, level) {
      gl.framebufferTexture2D(target, attachment, textarget, texId ? textures.get(texId) || null : null, level);
    },
    framebufferRenderbuffer(target, attachment, rbTarget, rbId) {
      const rb = rbId ? renderbuffers.get(rbId) || null : null;
      if (!isWebGL2 && renderbufferFormats.get(rbId) === 35056) {
        if (attachment === gl.STENCIL_ATTACHMENT) {
          gl.framebufferRenderbuffer(target, gl.DEPTH_STENCIL_ATTACHMENT, rbTarget, rb);
        }
        return;
      }
      gl.framebufferRenderbuffer(target, attachment, rbTarget, rb);
    },
    checkFramebufferStatus(target) {
      return gl.checkFramebufferStatus(target);
    },

    // --- Shaders & Programs ---
    createShader(type) {
      const id = nextId++;
      shaders.set(id, gl.createShader(type));
      return id;
    },
    shaderSource(shaderId, source) {
      const sh = shaders.get(shaderId);
      if (sh) gl.shaderSource(sh, source);
    },
    compileShader(shaderId) {
      const sh = shaders.get(shaderId);
      if (sh) gl.compileShader(sh);
    },
    getShaderiv(shaderId, pname, outUint32Arr) {
      const sh = shaders.get(shaderId);
      outUint32Arr[0] = sh && gl.getShaderParameter(sh, pname) ? 1 : 0;
    },
    getShaderInfoLog(shaderId) {
      const sh = shaders.get(shaderId);
      return sh ? gl.getShaderInfoLog(sh) || "" : "";
    },
    getShaderPrecisionFormat(shaderType, precisionType, rangeArr, precisionArr) {
      const fmt = gl.getShaderPrecisionFormat(shaderType, precisionType);
      if (fmt) {
        rangeArr[0] = fmt.rangeMin;
        rangeArr[1] = fmt.rangeMax;
        precisionArr[0] = fmt.precision;
      } else {
        rangeArr[0] = 127;
        rangeArr[1] = 127;
        precisionArr[0] = 23;
      }
    },
    createProgram() {
      const id = nextId++;
      programs.set(id, gl.createProgram());
      return id;
    },
    attachShader(progId, shaderId) {
      const p = programs.get(progId);
      const s = shaders.get(shaderId);
      if (p && s) gl.attachShader(p, s);
    },
    linkProgram(progId) {
      const p = programs.get(progId);
      if (p) gl.linkProgram(p);
    },
    getProgramiv(progId, pname, outUint32Arr) {
      const p = programs.get(progId);
      outUint32Arr[0] = p && gl.getProgramParameter(p, pname) ? 1 : 0;
    },
    getProgramInfoLog(progId) {
      const p = programs.get(progId);
      return p ? gl.getProgramInfoLog(p) || "" : "";
    },
    useProgram(progId) {
      gl.useProgram(progId ? programs.get(progId) || null : null);
    },
    getAttribLocation(progId, name) {
      const p = programs.get(progId);
      return p ? gl.getAttribLocation(p, name) : -1;
    },
    getUniformLocation(progId, name) {
      const p = programs.get(progId);
      if (!p) return -1;
      const loc = gl.getUniformLocation(p, name);
      if (!loc) return -1;
      const id = nextId++;
      uniforms.set(id, loc);
      return id;
    },

    // --- Uniforms & Attributes ---
    enableVertexAttribArray(index) {
      if (index >= 0) gl.enableVertexAttribArray(index);
    },
    disableVertexAttribArray(index) {
      if (index >= 0) gl.disableVertexAttribArray(index);
    },
    vertexAttribPointer(index, size, type, normalized, stride, offset) {
      if (index >= 0) gl.vertexAttribPointer(index, size, type, Boolean(normalized), stride, offset);
    },
    uniform1f(locId, x) {
      const loc = uniforms.get(locId);
      if (loc) gl.uniform1f(loc, x);
    },
    uniform2f(locId, x, y) {
      const loc = uniforms.get(locId);
      if (loc) gl.uniform2f(loc, x, y);
    },
    uniform3f(locId, x, y, z) {
      const loc = uniforms.get(locId);
      if (loc) gl.uniform3f(loc, x, y, z);
    },
    uniform4f(locId, x, y, z, w) {
      const loc = uniforms.get(locId);
      if (loc) gl.uniform4f(loc, x, y, z, w);
    },
    uniform1i(locId, x) {
      const loc = uniforms.get(locId);
      if (loc) gl.uniform1i(loc, x);
    },
    uniform2i(locId, x, y) {
      const loc = uniforms.get(locId);
      if (loc) gl.uniform2i(loc, x, y);
    },
    uniform3i(locId, x, y, z) {
      const loc = uniforms.get(locId);
      if (loc) gl.uniform3i(loc, x, y, z);
    },
    uniform4i(locId, x, y, z, w) {
      const loc = uniforms.get(locId);
      if (loc) gl.uniform4i(loc, x, y, z, w);
    },
    uniform1fv(locId, _count, v) {
      const loc = uniforms.get(locId);
      if (loc) gl.uniform1fv(loc, v);
    },
    uniform2fv(locId, _count, v) {
      const loc = uniforms.get(locId);
      if (loc) gl.uniform2fv(loc, v);
    },
    uniform3fv(locId, _count, v) {
      const loc = uniforms.get(locId);
      if (loc) gl.uniform3fv(loc, v);
    },
    uniform4fv(locId, _count, v) {
      const loc = uniforms.get(locId);
      if (loc) gl.uniform4fv(loc, v);
    },
    uniform1iv(locId, _count, v) {
      const loc = uniforms.get(locId);
      if (loc) gl.uniform1iv(loc, v);
    },
    uniform2iv(locId, _count, v) {
      const loc = uniforms.get(locId);
      if (loc) gl.uniform2iv(loc, v);
    },
    uniform3iv(locId, _count, v) {
      const loc = uniforms.get(locId);
      if (loc) gl.uniform3iv(loc, v);
    },
    uniform4iv(locId, _count, v) {
      const loc = uniforms.get(locId);
      if (loc) gl.uniform4iv(loc, v);
    },
    uniformMatrix3fv(locId, _count, transpose, value) {
      const loc = uniforms.get(locId);
      if (loc) gl.uniformMatrix3fv(loc, Boolean(transpose), value);
    },
    uniformMatrix4fv(locId, _count, transpose, value) {
      const loc = uniforms.get(locId);
      if (loc) gl.uniformMatrix4fv(loc, Boolean(transpose), value);
    },

    // --- Rasterizer & Drawing ---
    viewport(x, y, width, height) {
      gl.viewport(x, y, width, height);
    },
    scissor(x, y, width, height) {
      gl.scissor(Math.round(x), Math.round(y), Math.max(0, Math.round(width)), Math.max(0, Math.round(height)));
    },
    clearColor(r, g, b, a) {
      gl.clearColor(r, g, b, a);
    },
    clearStencil(s) {
      gl.clearStencil(s);
    },
    clear(mask) {
      gl.clear(mask);
    },
    colorMask(r, g, b, a) {
      gl.colorMask(Boolean(r), Boolean(g), Boolean(b), Boolean(a));
    },
    stencilFunc(func, ref, mask) {
      gl.stencilFunc(func, ref, mask);
    },
    stencilMask(mask) {
      gl.stencilMask(mask);
    },
    stencilOp(fail, zfail, zpass) {
      gl.stencilOp(fail, zfail, zpass);
    },
    blendFunc(sfactor, dfactor) {
      gl.blendFunc(sfactor, dfactor);
    },
    cullFace(mode) {
      gl.cullFace(mode);
    },
    lineWidth(width) {
      gl.lineWidth(width);
    },
    enable(cap) {
      gl.enable(cap);
    },
    disable(cap) {
      gl.disable(cap);
    },
    flush() {
      gl.flush();
    },
    getError() {
      return gl.getError();
    },
    getIntegerv(pname, outArr) {
      outArr[0] = gl.getParameter(pname) || 2048;
    },
    drawArrays(mode, first, count) {
      gl.drawArrays(mode, first, count);
    },
    drawElements(mode, count, type, offset) {
      gl.drawElements(mode, count, type, offset);
    },
    texParameteri(target, pname, param) {
      gl.texParameteri(target, pname, param);
    },
    generateMipmap(target) {
      gl.generateMipmap(target);
    },
    texImage2D(target, level, internalformat, width, height, border, format, type, pixels) {
      if (window.__DEBUG_HOTSEAT__) { const k = `if${internalformat}/f${format}/t${type}/${pixels ? pixels.constructor.name : "null"}`; const m = (window.__TEXFMT ||= {}); m[k] = (m[k] || 0) + 1; }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(target, level, internalformat, width, height, border, format, type, pixels ?? null);
    },

    // --- Custom Plato Native Texture Helpers ---
    texImage2DFromFile(target, level, uri, _border) {
      const bmp = assetStore.getBitmap(uri);
      if (!bmp) {
        // Fallback 2x2 white pixel so rendering never crashes
        const fallback = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(target, level, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, fallback);
        console.warn("[GL] Missing preloaded bitmap for:", uri);
        return { width: 2, height: 2 };
      }
      uploadBitmapToTarget(target, level, bmp);
      return { width: bmp.width, height: bmp.height };
    },

    texImage2DFromText(target, level, text, _border, style = {}) {
      const str = String(text ?? "");
      const size = Math.max(8, Math.round(style.size ?? 50));
      const fontCss = buildFontCss(style.font, size);
      textCtx.font = fontCss;
      const metrics = textCtx.measureText(str || " ");
      const padX = Math.ceil(size * 0.12);
      const w = Math.max(2, Math.ceil(metrics.width) + padX * 2);
      const h = Math.max(2, Math.ceil(size * 1.32));

      if (target !== 0) {
        textCanvas.width = w;
        textCanvas.height = h;
        if (style.background_color) {
          textCtx.fillStyle = argbIntToCss(style.background_color);
          textCtx.fillRect(0, 0, w, h);
        } else {
          textCtx.clearRect(0, 0, w, h);
        }
        const isArabic = /[\u0600-\u06FF]/.test(str);
        textCtx.direction = isArabic ? "rtl" : "ltr";
        textCtx.font = fontCss;
        textCtx.textBaseline = "middle";
        textCtx.textAlign = "center";
        textCtx.fillStyle = argbIntToCss(style.color ?? 0xff000000);
        textCtx.fillText(str, w / 2, h / 2 + size * 0.04);
        uploadCanvasToBoundTexture(target, level, textCanvas);
      }

      return { width: w, height: h };
    },

    texImage2DFromTextRich(text, options = {}) {
      const str = String(text ?? "").replace(/<[^>]*>/g, "");
      const size = Math.max(8, Math.round(options.fontSize ?? 36));
      const fontCss = buildFontCss(options.font, size);
      textCtx.font = fontCss;

      const lines = wrapLines(textCtx, str, options.maxWidth);
      const lineHeight = Math.ceil(size * 1.28);
      let maxLineW = 0;
      for (const ln of lines) {
        const mw = textCtx.measureText(ln || " ").width;
        if (mw > maxLineW) maxLineW = mw;
      }

      const padX = Math.ceil(size * 0.14);
      const padY = Math.ceil(size * 0.1);
      const w = Math.max(2, Math.ceil(maxLineW) + padX * 2);
      const h = Math.max(2, lines.length * lineHeight + padY * 2);

      textCanvas.width = w;
      textCanvas.height = h;
      textCtx.clearRect(0, 0, w, h);

      const isArabic = /[\u0600-\u06FF]/.test(str);
      textCtx.direction = isArabic ? "rtl" : "ltr";
      textCtx.font = fontCss;
      textCtx.textBaseline = "middle";
      textCtx.fillStyle = normalizeHexColor(options.fontColor);

      const align = options.textAlign || (isArabic ? "right" : "left");
      let anchorX = padX;
      if (align === "center") {
        textCtx.textAlign = "center";
        anchorX = w / 2;
      } else if (align === "right") {
        textCtx.textAlign = "right";
        anchorX = w - padX;
      } else {
        textCtx.textAlign = "left";
        anchorX = padX;
      }

      for (let i = 0; i < lines.length; i++) {
        const cy = padY + i * lineHeight + lineHeight / 2 + size * 0.03;
        textCtx.fillText(lines[i], anchorX, cy);
      }

      uploadCanvasToBoundTexture(gl.TEXTURE_2D, 0, textCanvas);
      return { width: w, height: h };
    },
  };

  // Helper to upload a dynamic ImageBitmap and return { texture_id, width, height }
  function registerExternalBitmap(bitmap) {
    const out = new Int32Array(1);
    GL.genTextures(1, out);
    const id = out[0];
    const prevUnit = gl.getParameter(gl.ACTIVE_TEXTURE);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures.get(id));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    uploadBitmapToTarget(gl.TEXTURE_2D, 0, bitmap);
    if (GL.resetBoundTexture) GL.resetBoundTexture();
    gl.activeTexture(prevUnit);
    return { texture_id: id, width: bitmap.width, height: bitmap.height };
  }

  // Generate colorful local player avatars on a 2D canvas and upload to GL textures
  function createAvatarTextures(playerNames) {
    const palette = [
      ["#0ea5e9", "#0369a1"], // Seat 0: Cyan/Blue
      ["#f43f5e", "#be123c"], // Seat 1: Rose/Red
      ["#10b981", "#047857"], // Seat 2: Emerald
      ["#f59e0b", "#b45309"], // Seat 3: Amber
    ];
    const size = 160;
    const cnv = document.createElement("canvas");
    cnv.width = size;
    cnv.height = size;
    const ctx = cnv.getContext("2d");

    return playerNames.map((name, idx) => {
      const [c1, c2] = palette[idx % palette.length];
      ctx.clearRect(0, 0, size, size);

      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c2);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.stroke();

      const label = `P${idx + 1}`;
      ctx.fillStyle = "#ffffff";
      ctx.font = '800 58px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, size / 2, size / 2 + 3);

      const out = new Int32Array(1);
      GL.genTextures(1, out);
      const texId = out[0];
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textures.get(texId));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      uploadCanvasToBoundTexture(gl.TEXTURE_2D, 0, cnv);
      if (GL.resetBoundTexture) GL.resetBoundTexture();

      return {
        texture: texId,
        x: 0,
        y: 0,
        width: size,
        height: size,
      };
    });
  }

  return { GL, gl, registerExternalBitmap, createAvatarTextures };
}
