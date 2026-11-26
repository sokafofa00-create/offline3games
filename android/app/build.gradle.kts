plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val generatedAssetsDir = layout.buildDirectory.dir("generated/offlineAssets")

val syncOfflineAssets by tasks.registering(Sync::class) {
    into(generatedAssetsDir)

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
    listOf("match_monsters_assets", "brawlbots_assets").forEach { dirName ->
        val manifestFile = file("../../$dirName/__assets.json")
        if (manifestFile.exists()) {
            @Suppress("UNCHECKED_CAST")
            val hashByName = groovy.json.JsonSlurper().parseText(manifestFile.readText()) as Map<String, String>
            from("../../$dirName") {
                eachFile {
                    val hash = hashByName[this.path]
                    if (hash == null) {
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
