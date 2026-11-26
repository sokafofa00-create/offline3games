# صالة الألعاب الجماعية أوفلاين (Offline 3 Games — Pass & Play)

تطبيق أندرويد وويب مستقل لتشغيل 3 ألعاب جماعية **أوفلاين بالكامل (100% بدون إنترنت)** بنظام **اللعب على نفس الهاتف (Pass-and-Play / Local Hotseat)**:

1. **Pool (البلياردو)**: `com.plato.android/files/g/7c5d2aa05094dbee8753108c59f617b2f4b1e7ae` — **(مكتملة ومختبرة بالكامل 1v1 / Cutthroat 3P / 2v2 / Trickshot)**.
2. **Match Monsters**: `com.plato.android/files/g/5470e3f408f5869a8a853c580878c101400906a5` — **(موجودة بكافة أصولها وجاهزة لاستكمال تكييف المراحل المتزامنة)**.
3. **Brawlbots (الدبابات)**: `com.plato.android/files/g/ae765a3baaa799266c501acf673b10a5b0000e92` — **(موجودة بكافة أصولها وجاهزة لاستكمال تكييف التصويب المتزامن)**.

## هيكلة المشروع
- `OFFLINE_APP_SPECIFICATIONS.md`: التوثيق الهندسي الكامل للبيئة والجسور الأربعة (`plato`, `GL`, `audio`, `pmath`) وآلية اللعب المتعاقب.
- `web/`: واجهة التطبيق ومحرك التشغيل (`WebGL2` + `WebAudio` + `Local Server Worker` + `Hotseat Controller`).
- `android/`: مشروع Android Kotlin نظيف (`WebViewAssetLoader` بدون إذن `INTERNET` وبدون `pairip` أو أي مكتبات تتبع).
- `ci/build-apk.yml`: ملف بناء الـ APK الجاهز لـ GitHub Actions (انسخه إلى `.github/workflows/build-apk.yml` لتفعيل البناء التلقائي).
- `serve.mjs`: خادم محلي للتجربة السريعة عبر `node serve.mjs`.
