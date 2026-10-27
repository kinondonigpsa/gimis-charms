// Newer GeckoView/AndroidX libraries are compiled with Kotlin 2.4, so the Kotlin compiler used by AGP must be 2.4 too.
buildscript {
    repositories { google(); mavenCentral() }
    dependencies { classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.20") }
}

plugins {
    id("com.android.application") version "9.1.0" apply false
}
