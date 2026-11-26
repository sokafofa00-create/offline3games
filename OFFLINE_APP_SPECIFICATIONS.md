# المواصفات الهندسية الكاملة لتطبيق تشغيل ألعاب Plato أوفلاين (Pass-and-Play / نفس الجهاز)

هذا المستند يضع المواصفات المعمارية والبرمجية الكاملة للتطبيق المضيف (Host Application) القادر على تشغيل الألعاب الثلاث الموجودة في المسار `com.plato.android/files/g` **بشكل أوفلاين بالكامل (100% Offline)** وبنظام **اللعب المحلي المتعاقب على نفس الجهاز (Local Multiplayer / Pass-and-Play)** دون أي اتصال بالإنترنت أو خوادم خارجية، ودون أي أخطاء في الرسوميات أو الفيزياء أو الصوتيات.

---

## 1. تحليل الألعاب الثلاث الموجودة في المجلد `files/g`

بعد الفحص الهندسي العكسي لجميع ملفات الألعاب الثلاث ومطابقة ملفات التحقق (`attestation.json` و`__assets.json` و`dictionary.json` و`main.js`)، تبيّن ما يلي:

| المعرّف (Folder Hash) | اسم اللعبة | حجم `main.js` | الملفات الثابتة (Static) | النواقص الثابتة | اللغات المدعومة | عدد اللاعبين | نظام الأدوار (Turn Model) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| `7c5d2aa05094dbee8753108c59f617b2f4b1e7ae` | **Pool (البلياردو)** | 1.00 MB | 184 ملف | **0 (مكتملة 100%)** | 22 لغة (بينها **العربية `ar`**) | 2 أو 3 أو 4 | **تتابعي صِرف** (`[0]` ثم `[1]`) — لا توجد معلومات مخفية |
| `5470e3f408f5869a8a853c580878c101400906a5` | **Match Monsters** | 1.15 MB | 587 ملف | **0 (مكتملة 100%)** | 20 لغة (بينها **العربية `ar`**) | 2 (1 ضد 1) | **هجين**: مرحلة اختيار الوحوش (`[0, 1]`) ثم تبادل أدوار (`[0]` ⇄ `[1]`) |
| `ae765a3baaa799266c501acf673b10a5b0000e92` | **Brawlbots (الدبابات)** | 1.40 MB | 429 ملف | **0 (مكتملة 100%)** | 14 لغة (بينها **العربية `ar`**) | 2 أو 3 أو 4 | **متزامن في كل جولة** (`[0, 1, ...]` يصوّب الجميع ثم تنطلق القذائف معاً) |

> **ملاحظة مهمة حول الأصول (Assets):**
> - جميع الملفات الأساسية اللازمة لتشغيل الألعاب الثلاث (الطاولات، الكرات، العصا الافتراضية، الوحوش، الدبابات، الخرائط، الشيدرات `GLSL`، المؤثرات الصوتية `.m4a`، وملفات الأنيميشن `Spine`) **موجودة بالكامل محلياً بنسبة 100%** داخل مجلد `game/` لكل لعبة.
> - ملف `__assets.json` يحتوي فقط على روابط لعناصر المتجر التجميلية الإضافية (ثيمات/عصي مدفوعة تُحمّل عند الطلب عبر SHA-1 إلى `files/assets/`). يوجد حالياً ملف موسيقى البلياردو الأساسي (`pool/th_basic_music.m4a`) محفوظاً بالفعل في `files/assets/1e5886c0d6b16cef3b72c964745813cb69714c03`، بينما تتراجع الألعاب تلقائياً وبأمان للثيم الأساسي إذا أرجع التطبيق خطأ عدم توفر لأي عنصر تجميلي غير محمّل.

---

## 2. كيف تعمل هذه الألعاب داخلياً؟ (حقيقة معمارية حاسمة)

ألعاب Plato **ليست صفحات HTML/DOM عادية**؛ فلا يوجد ملف `index.html` ولا تستخدم `document.createElement` للرسم. بدلاً من ذلك:

1. **ملف `main.js` موحّد (Server + Client في ملف واحد):**
   يحتوي ملف `main.js` لكل لعبة على **منطق السيرفر الكامل (`BaseLogic` / `PhysicsLogic`)** بالإضافة إلى **محرك الرسم والواجهة (`RenderingContext` + `Scene` + `Spine` + `p2.js Physics`)**.
   - عندما يُستدعى `logic.initialize(settings, undefined)` بدون رقم مقعد، يعمل الكود كـ **سيرفر حَكَم (Authoritative Server)** (`logic.server === true`).
   - عندما يُستدعى `logic.initialize(settings, seatIndex)` أو `logic.deserialize(state, seatIndex)`، يعمل الكود كـ **عميل رسومي (Client)**.
2. **الاعتماد على 4 كائنات عامة فقط (Global Native Bridges):**
   يتوقع `main.js` وجود 4 كائنات محقونة في النطاق العام (`globalThis`) قبل تنفيذه:
   - `plato`: جسر النظام ودورة الحياة والملفات والترجمة والغرفة (46 دالة/خاصية).
   - `GL`: جسر رسوميات OpenGL ES 2.0 **بنمط لغة C** (يستخدم أرقاماً صحيحة `Int32Array` للمعرّفات وليس كائنات WebGL مباشرة) + 3 دوال لتحميل الصور وتوليد النصوص كـ Textures.
   - `audio`: جسر المؤثرات الصوتية والموسيقى (5 دوال).
   - `pmath`: دوال مثلثية حتمية لضمان تطابق الفيزياء (`sin`, `cos`, `acos`, `asin`, `atan2`, `pow`).

---

## 3. البنية المعمارية الموصى بها للتطبيق المضيف (Host App Architecture)

أمامك خياران لبناء التطبيق، و**الخيار الأول هو الأفضل والأسرع بمراحل** لأنه يوفر بيئة متطابقة 100% دون الحاجة لكتابة محرك C++ OpenGL/JNI معقد:

### الخيار الأول (الموصى به): تطبيق Android (Kotlin أو Flutter/Capacitor) يضم طبقة محاكاة WebGL2 + WebAudio + OffscreenCanvas

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    واجهة التطبيق الخارجية (Host App UI)                 │
│  • اختيار اللعبة (البلياردو / Match Monsters / Brawlbots)               │
│  • إعدادات المباراة + أسماء اللاعبين المحليين + شريط علوي (HUD)        │
├─────────────────────────────────────────────────────────────────────────┤
│               محرك الغرفة المحلي وتبديل الأدوار (Offline Room)          │
│  • In-Memory Authoritative Server (يشغّل نفس منطق اللعبة محلياً بـ 0ms) │
│  • Hotseat Controller (يبدّل التحكم تلقائياً بين اللاعب 1 واللاعب 2)     │
├─────────────────────────────────────────────────────────────────────────┤
│                طبقة محاكاة بيئة Plato (Plato Runtime Shim)              │
│  ┌──────────────┐ ┌──────────────────────┐ ┌───────────┐ ┌───────────┐ │
│  │  plato.* API │ │ GL.* C-to-WebGL Shim │ │ audio.*   │ │  pmath.*  │ │
│  │  (46 عضو)    │ │ + Canvas2D Text Gen  │ │ WebAudio  │ │  Math     │ │
│  └──────────────┘ └──────────────────────┘ └───────────┘ └───────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│      محمّل الأصول المسبق المتزامن (Synchronous Asset Preloader)         │
│  • يقرأ attestation.json ويفك ضغط الصور (.webp/.png) والنصوص مسبقاً     │
│  • يقدّم الملفات محلياً عبر WebViewAssetLoader دون أي إذن إنترنت        │
└─────────────────────────────────────────────────────────────────────────┘
```

#### لماذا يجب وجود "محمّل أصول مسبق (Asset Preloader)" قبل تشغيل `main.js`؟ (شرط مصيري!)
في الكود الأصلي للألعاب الثلاث، تُستدعى الدوال التالية **بشكل متزامن (Synchronous)** وتنتظر النتيجة في نفس السطر البرمجي:
- `plato.loadFileAsString("~/shaders/GlowShaderVert.glsl")` ← تتوقع نص الملف فوراً.
- `GL.texImage2DFromFile(target, 0, "~/images/ui/ui.webp", 0)` ← تتوقع رفع الصورة للـ GPU وإرجاع `{ width, height }` فوراً!
- `audio.load("~/sounds/ball1.m4a")` ← تتوقع معرّف الصوت الرقمي (`number`) فوراً!

لذلك، **التسلسل الإلزامي لتشغيل أي لعبة بدون مشاكل** هو:
1. قراءة `dictionary.json` و`game/attestation.json` و`game/__assets.json`.
2. تحميل جميع ملفات `attestation.json` في الذاكرة قبل تنفيذ `main.js`:
   - الملفات النصية (`.json`, `.atlas`, `.glsl`, `.toml`) تُحفظ في `Map<string, string>`.
   - ملفات الصور (`.webp`, `.png`) تُفكّ مسبقاً عبر `createImageBitmap()` وتُحفظ في `Map<string, ImageBitmap>` لتكون جاهزة للرفع المتزامن الفوري داخل `texImage2DFromFile`!
   - ملفات الصوت (`.m4a`, `.wav`) تُسجّل بمعرّفات رقمية متسلسلة (`1, 2, 3...`) وتُفكّ عبر `AudioContext.decodeAudioData` بالتوازي.
3. حقن الكائنات الأربعة (`plato`, `GL`, `audio`, `pmath`).
4. تنفيذ `game/main.js`.
5. إطلاق أحداث دورة الحياة بالترتيب الدقيق الموضح في القسم الخامس.

*(ملاحظة: إذا رغبت ببناء التطبيق بـ Native C++ عبر `GLSurfaceView` + محرك `QuickJS` أو `V8` + `OpenGL ES 2.0` + `Oboe Audio`، فإن نفس المواصفات والجسور أدناه تنطبق حرفياً بدون الحاجة لتحميل الصور مسبقاً لأن C++ يقرأ الملفات متزامناً من القرص).*

---

## 4. المواصفات التفصيلية الكاملة للجسور الأربعة (API Specifications)

### أولاً: مسارات الملفات (URI Resolution)
تستخدم الألعاب صيغتين للمسارات:
- مسار يبدأ بـ `~/` مثل `"~/images/ui/ui.webp"` أو `"~/shaders/GlowShaderVert.glsl"` ← يشير مباشرة إلى مجلد `game/` الخاص باللعبة الحالية (`files/g/<game_id>/game/...`).
- مسار بدون `~/` مثل `"__assets.json"` ← يشير أيضاً إلى `files/g/<game_id>/game/__assets.json`.
- معرّف أصل ديناميكي (SHA-1 Hash بطول 40 حرفاً مثل `"1e5886c0d6b16cef3b72c964745813cb69714c03"`) ← يشير إلى `files/assets/<hash>`.

---

### ثانياً: مواصفات كائن `GL` (OpenGL ES 2.0 C-Style Wrapper)

> **انتبه جيداً:** محرك Plato لا يستدعي WebGL بصيغة المتصفح مباشرة، بل يستخدم صيغة C الخاصة بـ OpenGL ES 2.0! يجب أن يحتفظ الجسر بجدول معرّفات رقمية (`id = 1, 2, 3...` — لا تُرجع `0` أو رقماً سالباً أبداً لأن اللعبة تتحقق من `handle < 0` وتعتبر `0` هو الـ Screen Framebuffer الرئيسي).

#### 1. الفروقات الجوهرية عن WebGL القياسي والتي يجب تحويلها في الجسر:
| دالة `GL` في ألعاب Plato | كيف تستدعيها اللعبة | كيف ينفذها جسر WebGL في تطبيقك |
| :--- | :--- | :--- |
| `GL.genBuffers(n, outInt32Arr)` | تمرر العدد `n` ومصفوفة `Int32Array(n)` | ينشئ `n` من `gl.createBuffer()`، يحفظها بأرقام موجبة `>= 1` في جدول، ويكتب الأرقام داخل `outInt32Arr` |
| `GL.genTextures(n, outInt32Arr)` | نفس النمط أعلاه | ينشئ `gl.createTexture()` ويحفظها بأرقام موجبة `>= 1` |
| `GL.genFramebuffers(n, outInt32Arr)` | نفس النمط أعلاه | ينشئ `gl.createFramebuffer()` ويحفظها بأرقام موجبة `>= 1` (بينما الرقم `0` يرممز لـ `null` أي الشاشة الرئيسية!) |
| `GL.genRenderbuffers(n, outInt32Arr)` | نفس النمط أعلاه | ينشئ `gl.createRenderbuffer()` ويحفظها بأرقام موجبة `>= 1` |
| `GL.deleteBuffers(n, int32Arr)` | تمرر العدد ومصفوفة الأرقام (وكذلك لـ `Textures`, `Framebuffers`, `Renderbuffers`) | يحذف الكائنات المقابلة من `gl` ومن الجدول |
| `GL.bufferData(target, byteLength, typedArray, usage)` | **4 معاملات!** المعامل الثاني هو `byteLength` والثالث البيانات | يستدعي `gl.bufferData(target, typedArray, usage)` |
| `GL.renderbufferStorage(target, 35056, w, h)` | تستخدم الثابت `35056` (`GL_DEPTH24_STENCIL8_OES`) | في WebGL1 حول `35056` إلى `gl.DEPTH_STENCIL` (`0x84F9`)، وفي WebGL2 استخدم `gl.DEPTH24_STENCIL8` (`0x88F0`) |
| `GL.getShaderiv(shaderId, pname, outUint32Arr)` | تملأ `outUint32Arr[0]` بـ `1` أو `0` | `outUint32Arr[0] = gl.getShaderParameter(shader, pname) ? 1 : 0` |
| `GL.getProgramiv(progId, pname, outUint32Arr)` | تملأ `outUint32Arr[0]` بـ `1` أو `0` | `outUint32Arr[0] = gl.getProgramParameter(prog, pname) ? 1 : 0` |
| `GL.getIntegerv(pname, outInt32Arr)` | مثل `GL.MAX_TEXTURE_SIZE` | `outInt32Arr[0] = gl.getParameter(pname)` |
| `GL.getShaderPrecisionFormat(type, prec, rangeArr, precArr)` | تملأ `rangeArr[0..1]` و`precArr[0]` (تستخدمها Match Monsters) | يقرأ `gl.getShaderPrecisionFormat` ويملأ المصفوفتين (`precArr[0] = 23` مثلاً) |
| `GL.uniformMatrix4fv(locId, count, transpose, float32Arr)` | **4 معاملات!** يوجد `count` (عادة `1`) قبل `transpose` | يستدعي `gl.uniformMatrix4fv(locObj, Boolean(transpose), float32Arr)` (ونفس الشيء لـ `uniformMatrix3fv`) |
| `GL.uniform1fv` / `2fv` / `3fv` / `4fv` / `1iv`..`4iv` | **3 معاملات:** `(locId, count, array)` | يستدعي `gl.uniformXfv(locObj, array)` |
| `GL.texImage2D(target, lvl, intFmt, w, h, border, fmt, type, pixels)` | `pixels` قد تكون `null` أو `TypedArray` | يستدعي `gl.texImage2D(...)` مباشرة |

#### 2. الدوال الثلاث المخصصة لـ Plato داخل `GL`:
1. **`GL.texImage2DFromFile(target, level, uri, border)`**
   - تأخذ الـ `ImageBitmap` المحمّل مسبقاً للمسار `uri`.
   - **مهم جداً للشفافية (Premultiplied Alpha):** محرك Plato يستخدم `GL.blendFunc(GL.ONE, GL.ONE_MINUS_SRC_ALPHA)`! لذا عند رفع الصور إلى WebGL، يجب تفعيل `gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)` قبل رفع الصورة (ثم إعادته إلى `false` عند إنهاء الرفع لكي لا يؤثر على `GL.texImage2D` الفارغة الخاصة بالـ Framebuffers!).
   - تُرجع كائناً `{ width: img.width, height: img.height }`.

2. **`GL.texImage2DFromText(target, level, text, border, style)`**
   - `style`: `{ font: "bold" | "semibold" | "regular" | string, size: number, color: number (ARGB uint32), background_color: number (ARGB uint32), append: boolean }`.
   - ترسم النص على `OffscreenCanvas` ثنائي الأبعاد باللون والخط المحددين (مع مراعاة تحويل لون `ARGB` ذي 32-بت: `A = (c >>> 24) & 255`, `R = (c >>> 16) & 255`, `G = (c >>> 8) & 255`, `B = c & 255`).
   - إذا كان `target !== GL.NONE` (`0`)، ترفع الـ Canvas إلى الـ Texture المربوط حالياً مع `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true`. (أما إذا كان `target === GL.NONE` فهي عملية قياس أبعاد فقط!).
   - تُرجع `{ width, height }`.

3. **`GL.texImage2DFromTextRich(text, options)`**
   - `options`: `{ fontSize: number, font: string, fontColor: "#RRGGBB" | "#AARRGGBB", maxWidth?: number, textAlign?: "left" | "center" | "right" }`.
   - ترسم النص مع دعم **التفاف الأسطر التلقائي (Word Wrap)** إذا تم تحديد `maxWidth`، ودعم المحاذاة (`textAlign`) واللغة العربية (RTL)، وترفع الـ Canvas إلى `GL.TEXTURE_2D` على الـ Texture المربوط حالياً، وتُرجع `{ width, height }`.

#### 3. قائمة الثوابت والدوال المطلوبة في `GL`:
- جميع ثوابت WebGL القياسية المستخدمة (`TEXTURE_2D`, `TEXTURE0`..`TEXTURE3`, `RGBA`, `UNSIGNED_BYTE`, `UNSIGNED_SHORT`, `FLOAT`, `ARRAY_BUFFER`, `ELEMENT_ARRAY_BUFFER`, `STATIC_DRAW`, `DYNAMIC_DRAW`, `TRIANGLES`, `TRIANGLE_STRIP`, `TRIANGLE_FAN`, `FRAGMENT_SHADER`, `VERTEX_SHADER`, `COMPILE_STATUS`, `LINK_STATUS`, `FRAMEBUFFER`, `RENDERBUFFER`, `COLOR_ATTACHMENT0`, `DEPTH_ATTACHMENT`, `STENCIL_ATTACHMENT`, `FRAMEBUFFER_COMPLETE`, `BLEND`, `ONE`, `ZERO`, `ONE_MINUS_SRC_ALPHA`, `DST_ALPHA`, `DEPTH_TEST`, `STENCIL_TEST`, `CULL_FACE`, `SCISSOR_TEST`, `FRONT`, `BACK`, `KEEP`, `REPLACE`, `INCR`, `INCR_WRAP`, `DECR_WRAP`, `INVERT`, `NEVER`, `ALWAYS`, `EQUAL`, `NOTEQUAL`, `LINEAR`, `NEAREST`, `LINEAR_MIPMAP_LINEAR`, `LINEAR_MIPMAP_NEAREST`, `NEAREST_MIPMAP_LINEAR`, `NEAREST_MIPMAP_NEAREST`, `CLAMP_TO_EDGE`, `TEXTURE_WRAP_S`, `TEXTURE_WRAP_T`, `TEXTURE_MAG_FILTER`, `TEXTURE_MIN_FILTER`, `TEXTURE_CUBE_MAP`, `TEXTURE_CUBE_MAP_POSITIVE_X`, `COLOR_BUFFER_BIT`, `STENCIL_BUFFER_BIT`, `MAX_TEXTURE_SIZE`, `LOW_FLOAT`, `MEDIUM_FLOAT`, `HIGH_FLOAT`, `NONE: 0`).

---

### ثالثاً: مواصفات كائن `plato` الكاملة (جميع الـ 46 خاصية ودالة)

| الخاصية / الدالة | النوع والتوقيع | الوظيفة الدقيقة في بيئة الأوفلاين |
| :--- | :--- | :--- |
| `plato.version` | `number` (`25`) | رقم إصدار بيئة التشغيل (ضعه `>= 20` لتفعيل كافة الميزات الحديثة). |
| `plato.os` | `string` (`"android"`) | نظام التشغيل (`"android"` أو `"windows"`؛ `"android"` يفعّل إيماءات اللمس المثالية). |
| `plato.dpi` | `number` | كثافة الشاشة مثل `163 * window.devicePixelRatio` (`PLATO_BASE_DPI = 163`). |
| `plato.language` | `string` | رمز اللغة مثل `"ar"` أو `"en"` (مطابق لمفاتيح `dictionary.json`). |
| `plato.isRTL()` | `() => boolean` | ترجع `true` إذا كانت `plato.language === "ar"` أو `"fa"`. |
| `plato.is_develop` | `boolean` (`false`) | ضعها `false` للوضع النهائي (وضعها `true` يضيف أزرار تصحيح الأخطاء والإضاءة في القائمة). |
| `plato.globals` | `object` (`{}`) | كائن فارغ تستخدمه الألعاب لتسجيل الـ Singletons المشتركة. |
| `plato.hrtime()` | `() => number` | **مهم جداً:** ترجع الوقت بـ **النانوثانية (Nanoseconds)** وليس المللي ثانية! أي `Math.floor(performance.now() * 1e6)`. |
| `plato.log(msg, level)` | `(string, number) => void` | تسجيل الرسائل في Console (`0=Trace .. 5=Fatal`). |
| `plato.track(event, data)` | `(string, any) => void` | دالة إحصائيات (No-op أوفلاين). |
| `plato.hp` | `any` (`undefined`) | خاصية اختيارية تفحصها Brawlbots (تُترك `undefined`). |
| `plato.loadFileAsString(uri)` | `(uri: string) => string` | تُرجع محتوى الملف النصي المحمّل مسبقاً من مجلد `game/`. |
| `plato.fetchTexture(hash, okCb, errCb)` | `(hash, (h, info)=>void, (h, err)=>void)` | لتحميل صور المتجر الديناميكية من `files/assets/<hash>`. إذا وُجد الملف محلياً ترفعه لـ GL وتستدعي `okCb(hash, { texture_id, width, height })`، وإلا تستدعي `errCb(hash, 2)` فوراً ليتراجع الكود بسلاسة للثيم الافتراضي! |
| `plato.fetchAudio(hash, okCb, errCb)` | `(hash, (h, id)=>void, (h, err)=>void)` | لتحميل صوت ديناميكي من `files/assets/<hash>`. إذا لم يوجد محلياً تستدعي `errCb(hash, 2)` فوراً. |
| `plato.streamMusic(hash, errCb)` | `(hash, (h, err)=>void)` | يشغّل ملف الموسيقى الموجود في `files/assets/<hash>` بشكل متكرر (Loop)، وإذا لم يوجد يستدعي `errCb(hash, 2)`. |
| `plato.setTimer(cb, ms, repeat)` | `(fn, number, boolean) => number` | إذا كان `repeat === true` تستخدم `setInterval`، وإلا `setTimeout`، وتُرجع معرّفاً رقمياً موجباً. |
| `plato.clearTimer(id)` | `(id: number) => void` | تلغي المؤقت سواء كان `Timeout` أو `Interval`. |
| `plato.requestRender()` | `() => void` | تطلب رسم الإطار القادم عبر `requestAnimationFrame` (لتوفير البطارية وعدم الرسم المتكرر دون داعٍ، أو يمكن تشغيل حلقة `60fps` مستمرة عند الحاجة). |
| `plato.setOnSurfaceCreatedListener(cb)` | `(cb: () => void) => void` | يُستدعى مرة واحدة فور جاهزية سطح الـ WebGL/OpenGL. |
| `plato.setOnSurfaceChangedListener(cb)` | `(cb: (w, h, chatH, topY) => void)` | يُستدعى بعد `SurfaceCreated` وعند تغير أبعاد الشاشة: `(canvasWidth, canvasHeight, 0, safeTopOffsetPx)` حيث `chatH = 0` أوفلاين و`topY` مثل `70 * dpr` لوضع صور اللاعبين أسفل الشريط العلوي بأناقة! |
| `plato.setOnDrawFrameListener(cb)` | `(cb: () => void) => void` | يُستدعى في كل إطار رسم (`requestAnimationFrame`). |
| `plato.setOnTouchListener(cb)` | `(cb: (ev) => void) => void` | يستقبل أحداث اللمس بصيغة `{ action: PlatoPointerEventAction, pointers: [{ id, x, y }] }` بالبكسل الفعلي للـ Canvas. |
| `plato.setOnMouseListener(cb)` | `(cb: (ev) => void) => void` | (اختياري لدعم الماوس على الكمبيوتر في Match Monsters / Brawlbots). |
| `plato.setOnAvatarsReadyListener(cb)` | `(cb: (avatars[]) => void)` | يُمرر له مصفوفة صور اللاعبين المحليين المولّدة كـ GL Textures: `[{ texture: texId, x: 0, y: 0, width: 128, height: 128 }, ...]`. |
| `plato.addMenuButton(id, label)` | `(id: string, label: string)` | يسجل أزرار قائمة اللعبة (مثل: الإعدادات، كتم الصوت، الاستسلام، خطوط التصويب) في زر القائمة الخاص بشريط التطبيق العلوي. |
| `plato.clearMenu()` | `() => void` | يفرغ عناصر القائمة المسجلة (تستخدمها Match Monsters). |
| `plato.setOnMenuButtonClickedListener(cb)`| `(cb: (id: string) => void)` | يستدعيه التطبيق عندما يضغط اللاعب على أحد خيارات قائمة اللعبة. |
| `plato.translate(args)` | `(args: [key, ...any[]]) => string` | يترجم المفتاح من `dictionary.json` للغة المختارة مع تعويض `{0}, {1}`: إذا كان المعامل **رقماً** يُستبدل باسم اللاعب صاحب المقعد `getPlatoID(arg)`، وإذا بدأ بـ `"^"` يُترجم المفتاح الفرعي أولاً، وإلا يُعوّض كنص مباشر. |
| `plato.getPlatoID(seat)` | `(seat: number) => string` | يُرجع اسم اللاعب الجالس في المقعد `seat` (مثلاً `"اللاعب 1"`، `"اللاعب 2"`، أو الأسماء التي يكتبها اللاعبان قبل بدء المباراة). |
| `plato.ownerSeat()` | `() => number` | يُرجع `0` (صاحب الغرفة المحلية). |
| `plato.getInventory()` | `() => number[]` | يُرجع مصفوفة أرقام العناصر المفتوحة (أوفلاين: نُرجع معرّفات الوحوش في Match Monsters لفتح كل الوحوش للاعبَين مجاناً!). |
| `plato.shop` | `undefined` | يُترك `undefined` ليعمل المتجر على العناصر الأساسية المدمجة فوراً دون انتظار الشبكة أو إعادة المحاولة. |
| `plato.net` | `{ sendMessage, onMessage }` | قناة تمرير رسائل `Uint8Array` ثنائية الاتجاه بين العميل والسيرفر المحلي داخل الذاكرة. |
| `plato.showItemPurchase(sku)` | `(sku) => void` | يعرض رسالة لطيفة أن المتجر غير مطلوب في وضع الأوفلاين. |
| `plato.showProfile(seat)` | `(seat: number) => void` | اختياري (عرض اسم ونقاط اللاعب المحلي). |
| `plato.requestKeyboard(onChange, onDone)` | `(fn, fn) => void` | يفتح مربع إدخال نصي بسيط إذا ضغط المستخدم على خانة بحث. |
| `plato.haptic` | `{ isVibrationSupported, vibrate, vibratePattern }` | يربط مع `navigator.vibrate` أو اهتزاز أندرويد لإعطاء إحساس واقعي عند ضرب الكرات! |
| `plato.game_preferences` | `object` | يُحمّل من `localStorage` لكل لعبة لحفظ تفضيلات الصوت وخطوط التصويب. |
| `plato.saveGamePreferences(obj)` | `(obj) => void` | يحفظ `obj` في `localStorage` تحت مفتاح خاص باللعبة. |
| `plato.saved_local_state` | `object` | كائن حالة الجلسة المحلية للعميل. |
| `plato.saveLocalState(obj)` | `(obj) => void` | يحفظ حالة الجلسة المحلية. |
| `plato.setGameLogic(logicObj)` | `(logic) => void` | **نقطة الربط المركزية!** تسجّل كائن منطق اللعبة مع محرك الغرفة المحلي (المشروح في القسم الخامس). |
| `plato.sendMove(packet)` | `(packet) => void` | يرسل حركة اللاعب الحالي فوراً إلى محرك السيرفر المحلي في الذاكرة. |
| `plato.resetSynchronizationStream()` | `() => void` | يعيد مزامنة حالة العميل من السيرفر المحلي عبر `serialize` / `deserialize`. |
| `plato.showGameOver()` | `() => void` | يُشعر التطبيق المضيف بانتهاء المباراة لإظهار زر **"إعادة المباراة (Rematch)"** أو **"تغيير الإعدادات"**. |
| `plato.session` و `plato.alarm` | كائنات داخلية للسيرفر | `{ changeTurn, gameOver }` و `{ set }` عند تفعيل النداء المباشر للسيرفر. |

---

### رابعاً: مواصفات كائن `audio` وكائن `pmath`

#### 1. كائن `audio`:
- `audio.load(uri: string): number` ← يُرجع المعرّف الرقمي لملف الصوت المحمّل من `game/sounds/...`.
- `audio.play(id: number, volLeft = 1, volRight = 1, loop = false, rate = 1, priority = false): void` ← يشغّل المؤثر الصوتي عبر `Web Audio API` (`AudioBufferSourceNode` + `StereoPannerNode` / `GainNode` للتحكم بمستوى الصوت وسرعته `playbackRate`).
- `audio.playMusic(uri: string, vol = 1, loop = 1): void` ← يشغّل ملف موسيقى ثابت (`~/...`).
- `audio.stopMusic(): void` ← يوقف أي موسيقى قيد التشغيل (سواء من `playMusic` أو `plato.streamMusic`).
- `audio.unload(id: number): void` ← يحرر الصوت من الذاكرة عند الحاجة.
- `AudioController.musicVolume` ← خاصية عامة (`getter`/`setter` بين `0` و`1`) تضبط مستوى صوت الموسيقى الخلفية مباشرة عبر `GainNode`.

#### 2. كائن `pmath`:
```js
globalThis.pmath = {
  sin: Math.sin,
  cos: Math.cos,
  acos: Math.acos,
  asin: Math.asin,
  atan2: Math.atan2,
  pow: Math.pow,
};
```
*(بما أن السيرفر المحلي والعميل يعملان على نفس الجهاز ونفس محرك الـ JS، فإن دوال `Math` القياسية تعطي تطابقاً حتمياً بنسبة 100.000% دون أي انحراف في الفيزياء!).*

---

### خامساً: صيغة أحداث اللمس (`PlatoPointerEventAction`)
عند تحويل أحداث اللمس (`touchstart` / `touchmove` / `touchend` / `pointer*`) من شاشة الجهاز إلى الدالة المسجلة في `plato.setOnTouchListener(cb)`:
- الإحداثيات `x` و `y` تكون بوحدة **البكسل الفعلي للـ Canvas** (`clientX * dpr`, `clientY * dpr`) من أعلى اليسار `(0, 0)`.
- قيم `action` المعتمدة في محرك الألعاب الثلاث:
  - `0` (`DOWN`): لمسة الإصبع الأول.
  - `1` (`UP`): رفع الإصبع الأخير.
  - `2` (`MOVE`): تحريك الإصبع/الأصابع.
  - `3` (`CANCEL`): إلغاء اللمسة.
  - لدعم اللمس المتعدد (إصبع ثانٍ للـ Pinch Zoom في بعض الألعاب): الإصبع الثاني `DOWN_POINTER_2 = 261` و`UP_POINTER_2 = 262`، مع تمرير مصفوفة `pointers: [{ id: 0, x, y }, { id: 1, x, y }]`.

---

## 5. كيف يعمل نظام اللعب المحلي على نفس الجهاز (Offline Pass-and-Play Engine)؟

لتشغيل الألعاب الثلاث أوفلاين بحيث يلعب **اللاعب الأول ضد اللاعب الثاني (أو حتى 3 و4 لاعبين في البلياردو والدبابات!) على نفس الجهاز** بسلاسة تامة، يجب أن يعمل محرك الغرفة في التطبيق على النحو التالي:

### أ. محرك السيرفر المحلي المدمج (In-Memory Loopback Room)
بما أن `main.js` يحتوي على كلاس المنطق الكامل (`clientLogic.constructor`):
1. عند استدعاء `plato.setGameLogic(clientLogic)`، ينشئ التطبيق المضيف **نسخة ثانية مستقلة في الذاكرة تمثل السيرفر الحكم**:
   `serverLogic = new clientLogic.constructor()` (أو يشغّل نسخة منطق السيرفر في سياق معزول خفيف).
2. لضمان فتح كافة الوحوش في **Match Monsters** أوفلاين، نضبط `serverLogic.onGetInventory = (seat) => ALL_MONSTER_IDS`.
3. **بدء المباراة فورياً (0ms):**
   - نضبط `serverLogic.seed = randomInt32()` ثم نستدعي `const numSeats = serverLogic.initialize(gameSettings, undefined)`.
   - لكل مقعد `s` من `0` إلى `numSeats - 1`: نستدعي `serverLogic.join(s)` ثم `serverLogic.enter(s)` ← فتبدأ المباراة تلقائياً (`_executeStart()`)!
   - نأخذ لقطة البداية للعميل: `const initState = serverLogic.serialize(activeSeat)` ونمررها إلى `clientLogic.deserialize(initState, activeSeat)` ثم `clientLogic.enter(0..numSeats-1)`.
4. **معالجة الحركات والفيزياء (`plato.sendMove`) والمؤقتات (`onSetAlarm`):**
   - عندما ينفذ اللاعب النشط على الشاشة أي حركة (تصويب، تسديد الكرة، تحريك الكرة البيضاء، تبديل الجواهر)، يستدعي العميل `plato.sendMove(packet)`.
   - يستلمها `serverLogic.move(activeSeat, packet)` في نفس اللحظة (خلال `< 1ms`):
     - إذا أطلق السيرفر `onReveal(seats, revealData)` (مثل التحقق الفيزيائي `PhysicsLogic` بعد استقرار كرات البلياردو أو كشف بيانات الجواهر)، يمررها التطبيق فوراً إلى العميل!
     - إذا كانت الحركة من مقعد آخر أو حركة آلية عند انتهاء الوقت (`onSetAlarm` -> `serverLogic.alarm({}, alarmId)`), تُبثّ للعميل فوراً عبر `clientLogic.move` / `clientLogic.alarm`.

### ب. آلية تبديل التحكم بين اللاعبين على نفس الجهاز (Hotseat Switching)

هنا يكمن السر الذي يجعل تجربة اللعب على جهاز واحد طبيعية وممتعة بلا أي تشويش بصري:

#### 1. في الألعاب التتابعية الصرفة — مثل **البلياردو (Pool)** ومرحلة القتال في **Match Monsters**:
- في الوضع الأونلاين الأصلي، يظل `clientLogic._localSeat` ثابتاً على `0`، فعندما يصبح الدور للاعب الثاني (`turn = [1]`) تتعطل جميع أزرار التصويب والعصا ومقياس القوة لأن `isLocalPlayerTurn()` ترجع `false`!
- **في وضع الأوفلاين على نفس الجهاز (Pass-and-Play):**
  - بمجرد استقرار الكرات وانتقال الدور إلى المقعد الجديد `nextSeat = turn[0]`، يقوم محركنا بتحديث المقعد المتحكم `activeSeat = nextSeat` وتفعيل أدوات التصويب ومقياس القوة والـ Spin للاعب صاحب الدور فوراً!
  - **قاعدة ذهبية في البلياردو (تثبيت منظور الشاشة `displaySeat = 0`):**
    في كود البلياردو يوجد متغيران منفصلان: `_localSeat` (من يملك حق الإمساك بالعصا والتسديد الآن) و`displaySeat` (من تظهر صورته وكراته على الجانب الأيمن مقابل الجانب الأيسر). **سنقوم بتثبيت `displaySeat = 0` طوال المباراة مع تحريك `_localSeat` فقط مع صاحب الدور!** وبذلك تبقى صورة اللاعب 1 وكراته (سادة أو مخطط) ثابتة في مكانها دائماً، وصورة اللاعب 2 وكراته ثابتة في مكانها دائماً دون أن تنقلب واجهة الشاشة في كل دور، بينما يتمكن كلا اللاعبين من التصويب والتسديد بكامل الصلاحيات في دوره!
  - **قاعدة ذهبية في نصوص الترجمة (`plato.translate`):**
    تحتوي ملفات `dictionary.json` على نسختين لكل لغة: عامة مثل `"ar"` (*"دور {0}"*، *"فاز {0}"*)، وشخصية مثل `"arp"` (*"دورك"*، *"لقد فزت"*). في اللعب على نفس الجهاز نستخدم دائماً القاموس العام (`"ar"` أو `"en"`) مع أسماء اللاعبين، فتظهر الرسائل واضحة للجميع: **"حان دور أحمد للكسر"**، **"وضع محمد الكرة 8 في الجيب"**، **"فاز أحمد!"**.

#### 2. في المراحل المتزامنة (`turn = [0, 1]`) — مثل **Brawlbots** ومرحلة اختيار الوحوش في **Match Monsters**:
- عندما تحتوي مصفوفة `turn` على أكثر من لاعب في نفس الوقت (مثلاً اللاعب 1 واللاعب 2 يختاران وحوشهما أو يصوّبان دباباتهما في نفس الجولة):
  1. يبدأ التحكم عند أول لاعب في `turn` لم ينهِ حركته بعد (مثلاً **اللاعب 1**).
  2. ما إن يضغط اللاعب 1 زر التأكيد/الإطلاق، يتحول التحكم تلقائياً (مع إشعار واضح في الشريط العلوي *"مرّر الجهاز إلى اللاعب 2"* أو زر تبديل سريع) إلى **اللاعب 2** عبر تحديث حالة العميل `clientLogic.deserialize(serverLogic.serialize(1), 1)` (مما يحافظ حتى على سرية الاختيار في الطور الأعمى!).
  3. فور تأكيد اللاعب 2 لحركته، تنطلق القذائف أو تبدأ المعركة أمام اللاعبَين معاً!

---

## 6. مواصفات إعدادات المباريات لكل لعبة (`settings` Object)

يجب أن يعرض التطبيق قبل تشغيل كل لعبة نافذة إعدادات أنيقة تمرر كائن `settings` التالي إلى `initialize(settings)`:

### 1. إعدادات لعبة البلياردو (`Pool`)
```json
{
  "live": 0,
  "gameType": 0,
  "break": 2,
  "trickShots": 0
}
```
- **`live` (نظام الوقت):**
  - `0`: **بدون عدّاد وقت ضاغط (Turn-Based)** ← *(مثالي للعب الهادئ مع صديق على نفس الجهاز)*.
  - `1`: **مباشر بمؤقت (Live — 30 ثانية لكل ضربة)** ← *(مثالي للتحدي السريع!)*.
- **`gameType` (نوع اللعبة وعدد اللاعبين على نفس الجهاز):**
  - `0`: **8-Ball (1 ضد 1)** — لاعبان.
  - `3`: **9-Ball (1 ضد 1)** — لاعبان.
  - `6`: **Cutthroat (تحدي ثلاثي — 3 لاعبين كل لاعب ضد الآخرين على نفس الجهاز!)** — 5 كرات لكل لاعب.
  - `1` / `2`: **8-Ball فرق (2 ضد 2 / Pro)** — 4 لاعبين.
  - `4` / `5`: **9-Ball فرق (2 ضد 2 / Pro)** — 4 لاعبين.
- **`break` (ضربة البداية / الكسر):** `0` = اللاعب الأول، `1` = اللاعب الثاني، `2` = عشوائي.
- **`trickShots` (نظام النقاط):** `0` = عادي، `1` = Trickshot (احتساب نقاط الحركات الاستعراضية وارتدادات الباند!).

### 2. إعدادات لعبة `Match Monsters`
```json
{
  "liveMode": 0,
  "matchRules": 0,
  "monsterSelection": 1,
  "weeklyStatus": 0
}
```
- `liveMode`: `0` بدون مؤقت سريع / `1` بمؤقت جولة.
- `matchRules`: `0` القواعد القياسية (`Normal`) / `1` حركات حرة إضافية (`FreeMoves`).
- `monsterSelection`: طور اختيار الوحوش قبل المعركة.

### 3. إعدادات لعبة `Brawlbots`
```json
{
  "players": 0
}
```
- `players`: `0` = لاعبان (1 ضد 1)، `1` = 3 لاعبين (الكل ضد الكل)، `2` = 4 لاعبين (الكل ضد الكل)، `3` = فريقان (2 ضد 2).

---

## 7. المواصفات الشكلية والوظيفية للتطبيق المضيف (UI & Technical Specs)

ليعمل التطبيق بأعلى جودة ودون أي مشاكل على الهواتف والأجهزة اللوحية (أو الكمبيوتر):

1. **الشاشة الكاملة والاتجاه (Orientation & Viewport):**
   - الاتجاه الإلزامي: **عمودي (Portrait)** بملء الشاشة (`Immersive Sticky Fullscreen`) مع منع تمرير الصفحة (`touch-action: none; user-select: none; overflow: hidden`) حتى لا تتداخل إيماءات السحب عند تصويب عصا البلياردو مع إيماءات النظام.
2. **الشريط العلوي المدمج (Host Top Bar - ارتفاع ~48dp شفاف أو داكن أنيق):**
   - يعرض على اليمين/اليسار: زر **القائمة (☰)** الذي يفتح الأزرار المسجلة عبر `plato.addMenuButton` (كتم الصوت، إيقاف الموسيقى، تشغيل/إيقاف التصويب باللمس، الاستسلام، + خيار "إعادة المباراة" و"الخروج للقائمة").
   - يعرض في المنتصف: **شارة صاحب الدور الحالي** باسمه ولونه (مثلاً: *"دور: اللاعب 1"* / *"دور: اللاعب 2"*).
   - يتم تمرير ارتفاع هذا الشريط في المعامل الرابع `topY` لدالة `onSurfaceChanged(width, height, 0, topBarHeightPx)` حتى ترسم اللعبة صور اللاعبين أسفله مباشرة دون أي تداخل!
3. **إعدادات WebView في حال بناء APK للأندرويد:**
   - Android `minSdk`: `24+` (يدعم WebGL 2.0، ES6+، WebP، وترميز الصوت AAC/M4A عتادياً في جميع الأجهزة).
   - تفعيل `settings.javaScriptEnabled = true` و`settings.domStorageEnabled = true` و`settings.mediaPlaybackRequiresUserGesture = false` (مهم جداً لكي تعمل أصوات الكرات والموسيقى فور بدء اللعب دون تعليق!).
   - استخدام `androidx.webkit.WebViewAssetLoader` لربط مجلد الأصول المحلي بنطاق افتراضي محلي (`https://appassets.androidplatform.net/`)؛ هذا يمنحك سرعة قراءة فائقة، ويدعم `fetch` و`WebGL` بدون أي مشاكل `CORS` نهائياً، مع **حذف إذن `android.permission.INTERNET`** من `AndroidManifest.xml` لضمان كون التطبيق أوفلاين 100%.
4. **توليد صور رمزية محلية للاعبين (Offline Avatars):**
   - بما أنه لا يوجد اتصال بسيرفرات Plato لجلب صور الحسابات، يقوم التطبيق بتوليد صور رمزية دائرية مميزة محلياً على Canvas (أيقونة أو الحرف الأول من اسم كل لاعب بخلفية لونية مميزة لكل مقعد) ويرفعها كـ GL Textures ويمررها إلى `onAvatarsReadyListener`.

---

## 8. خطة العمل للخطوة التالية (البدء بلعبة البلياردو `Pool`)

بناءً على هذه المواصفات، للبدء بلعبة البلياردو (`7c5d2aa05094dbee8753108c59f617b2f4b1e7ae`) وتشغيلها أوفلاين بنظام لاعب ضد لاعب على نفس الجهاز:

1. **تجهيز بيئة التشغيل الموحدة (Plato Offline Runtime + WebGL/Audio Shim + Local Room Server)** بحيث تدعم البلياردو الآن وتكون جاهزة لتشغيل اللعبتين الأخريين (`Match Monsters` و`Brawlbots`) مباشرة على نفس البنية.
2. **تكييف منطق البلياردو للعب المحلي على نفس الجهاز (Pass-and-Play Hotseat):**
   - تفعيل تبديل المقعد النشط (`_localSeat`) تلقائياً إلى صاحب الدور الجديد بعد كل ضربة، مع تثبيت `displaySeat = 0` للحفاظ على ثبات الطاولة وأماكن اللاعبين.
   - ضبط الرسائل والأسماء لتظهر بأسماء اللاعبين المحليين (عربي/إنجليزي حسب الاختيار) بدلاً من رسائل الأونلاين، ودعم كافة أطوار البلياردو (8-Ball، 9-Ball، Cutthroat لـ 3 لاعبين، وTrickshot).
   - إمكانية اللعب وتجربة اللعبة مباشرة في المتصفح المحلي أو تغليفها كتطبيق أندرويد/سطح مكتب مستقل.
