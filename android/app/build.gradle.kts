import java.util.Base64
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val generatedAssetsDir = layout.buildDirectory.dir("generated/offlineAssets")

val syncOfflineAssets by tasks.registering(Sync::class) {
    into(generatedAssetsDir)
    // Games share some hashed assets across folders; the same hash is the same file, keep the first.
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE

    from("../../web") {
        into("")
    }
    from("../../com.plato.android/files/g") {
        into("g")
    }
    from("../../com.plato.android/files/assets") {
        into("assets")
    }

    // Resource folders uploaded by file name. Each manifest (__assets.json: name -> SHA-1) maps a file to the
    // /assets/<hash> path the games request; files not listed in a manifest are not packaged. Fully offline.
    listOf("match_monsters_assets", "brawlbots_assets", "pool_assets").forEach { dirName ->
        val manifestFile = file("../../$dirName/__assets.json")
        if (manifestFile.exists()) {
            @Suppress("UNCHECKED_CAST")
            val hashByName = groovy.json.JsonSlurper().parseText(manifestFile.readText()) as Map<String, String>
            // Slim build (Pool, user request): pack only the golden asset set; repo content stays complete.
            val goldenFile = file("../../web/pool-golden.json")
            @Suppress("UNCHECKED_CAST")
            val goldenKeys: Set<String> = if (dirName == "pool_assets" && goldenFile.exists())
                ((groovy.json.JsonSlurper().parseText(goldenFile.readText()) as Map<String, Object>)["keys"] as List<String>).toSet()
            else emptySet()
            // Files known not to be the real asset (generated placeholders) are not packaged; see asset-quarantine.json.
            val quarantineFile = file("../../asset-quarantine.json")
            @Suppress("UNCHECKED_CAST")
            val quarantined: List<String> = if (quarantineFile.exists())
                ((groovy.json.JsonSlurper().parseText(quarantineFile.readText()) as Map<String, List<String>>)[dirName] ?: emptyList())
            else emptyList()
            from("../../$dirName") {
                eachFile {
                    val hash = hashByName[this.path]
                    if (hash == null || quarantined.contains(this.path) || (goldenKeys.isNotEmpty() && !goldenKeys.contains(this.path))) {
                        this.exclude()
                    } else {
                        this.relativePath = RelativePath(true, "assets", hash)
                    }
                }
                includeEmptyDirs = false
            }
        }
    }
}

android {
    namespace = "com.local.offlinegames"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.local.offlinegames"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    // Pinned debug keystore (non-secret, standard android/androiddebugkey) so every CI build has the same signing cert
    // and builds install over each other. Without this each CI runner generated a fresh debug key.
    val pinnedKs = layout.buildDirectory.file("pinned-debug.keystore").get().asFile
    pinnedKs.parentFile.mkdirs()
    pinnedKs.writeBytes(Base64.getDecoder().decode("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"))
    signingConfigs {
        getByName("debug") {
            storeFile = pinnedKs
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
            enableV1Signing = true  // compatibility hedge for MIUI installer
            enableV2Signing = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // Sign with debug key by default so release APK can also be installed directly if no keystore is configured
            signingConfig = signingConfigs.getByName("debug")
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    // Do not compress audio/webp files so WebViewAssetLoader streams them at zero-copy speed
    androidResources {
        noCompress += listOf("m4a", "mp3", "ogg", "wav", "webp", "png")
    }

    sourceSets {
        getByName("main") {
            assets.srcDir(syncOfflineAssets.map { it.destinationDir })
        }
    }
}

tasks.named("preBuild") {
    dependsOn(syncOfflineAssets)
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.webkit:webkit:1.11.0")
}
