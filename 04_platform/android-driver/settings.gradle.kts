// SeeBuyGet Driver for Android (05_engineering/android-auto-messages.md, slice S2, 2026-11-02).
//
// Built on GitHub only (.github/workflows/android-driver.yml): a Gradle build on the owner's machine is exactly the load
// that shuts it down. There is no Gradle wrapper here on purpose — its jar is a binary nobody here can produce; the
// workflow puts a pinned Gradle on the path instead (README.md, "How it is built").

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    // Every library comes from these two, named here once; a module asking for its own repository is refused.
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "SeeBuyGetDriver"
include(":app")
