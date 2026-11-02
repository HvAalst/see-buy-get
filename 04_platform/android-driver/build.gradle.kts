// The plugins, pinned (2026-11-02). Why these and not the newest: README.md, "Versions".
//
// Android Gradle Plugin 8.13.2 — the last of the 8 line, so the DSL and the Kotlin plugin work the way they have for
// years; AGP 9 builds Kotlin itself and changes the DSL, a move to make on purpose, not on a first build nobody can watch.
// It compiles against API 36, which Google Play has required of new apps and updates since 31 August 2026.
//
// Kotlin 2.3.21 — tested by JetBrains with AGP 8.2.2 to 9.0.0 and Gradle up to 9.3, out since the spring.
plugins {
    id("com.android.application") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.3.21" apply false
}
