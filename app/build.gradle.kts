plugins {
    id("com.android.application")
}

// APK MOJA kwa devices zote (simu + tablet, 64-bit na 32-bit, Android 5.0+).
// Tunatumia GeckoView 143.x (toleo la mwisho linaloshika Android 5-7) na artifact ya "omni"
// ambayo ina ABI zote ndani yake.
val gv = (project.findProperty("geckoviewVersion") as String?) ?: "[143.0,144.0)"

// ABI zinazowekwa ndani ya APK. Default = zote mbili (APK moja ya kila kifaa).
// Workflow pia hujenga toleo dogo la 64-bit pekee na 32-bit pekee: -Pabis=arm64-v8a  au  -Pabis=armeabi-v7a
val abiList = ((project.findProperty("abis") as String?) ?: "arm64-v8a,armeabi-v7a").split(",").map { it.trim() }

android {
    namespace = "tz.gpsa.browser"
    compileSdk = 37

    // Saini YA KUDUMU: kila build inatiwa saini kwa ufunguo huu huu (app/gpsa-release.jks).
    // Zamani kila build ya GitHub ilipata ufunguo mpya wa debug, kwa hiyo APK mpya haikuweza kuwekwa
    // juu ya ya zamani ("App not installed"). Sasa mabadiliko yanawekwa juu ya app ya zamani moja kwa moja.
    signingConfigs {
        create("gpsa") {
            storeFile = file("gpsa-release.jks")
            storePassword = "gpsa-browser-2026"
            keyAlias = "gpsa"
            keyPassword = "gpsa-browser-2026"
        }
    }

    defaultConfig {
        applicationId = "tz.gpsa.browser"
        minSdk = 21
        targetSdk = 34
        // Workflow (GitHub Actions) inatuma -PappVersionCode na -PappVersionName kila build; build ya mkono inatumia thamani za chini.
        versionCode = (project.findProperty("appVersionCode") as String?)?.toIntOrNull() ?: 4
        versionName = (project.findProperty("appVersionName") as String?) ?: "1.2.1"
        ndk { abiFilters += abiList }
    }

    // Aina mbili za APK: "phone" (simu) na "tablet". Zinatofautiana kwenye ukubwa wa vitufe/maandishi ya upau wa juu
    // (tazama app/src/phone/res na app/src/tablet/res). Zote zinaweza kuwekwa kwenye kifaa chochote; applicationId ni ileile.
    flavorDimensions += "device"
    productFlavors {
        create("phone") { dimension = "device" }
        create("tablet") { dimension = "device" }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("gpsa")
            isMinifyEnabled = false          // GeckoView haihitaji R8; inaepusha hitilafu za ziada
        }
        debug {
            signingConfig = signingConfigs.getByName("gpsa")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    packaging { jniLibs { useLegacyPackaging = true } }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("org.mozilla.geckoview:geckoview-omni:$gv")
}
