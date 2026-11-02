import java.io.File
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// SeeBuyGet Driver — the app (2026-11-02). The Driver web app, opened full screen as a Trusted Web Activity, and a small
// native part that does only the car's work: Messages in the car (05_engineering/android-auto-messages.md).

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/** A Gradle property (gradle.properties, or -P from the workflow), trimmed; the fallback when it is missing or empty. */
fun prop(name: String, fallback: String): String =
    (project.findProperty(name) as String?)?.trim()?.takeIf { it.isNotEmpty() } ?: fallback

/** A Kotlin/Java string literal for BuildConfig. */
fun literal(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

// The public site, by its name only. A name with a scheme or a path in it is a mistake made once, so it is refused here,
// at the build, rather than found on a phone.
val sbgHost = prop("sbgHost", "seebuyget.com").lowercase()
require(Regex("^[a-z0-9.-]+(:[0-9]{1,5})?$").matches(sbgHost)) {
    "sbgHost must be a bare host name like seebuyget.com (no https://, no path); it was '$sbgHost'"
}

// DIGITAL ASSET LINKS, the app's half: "this app may speak for https://<sbgHost>". The site's half is
// /.well-known/assetlinks.json with the signing key's fingerprint (README.md, "What the owner sets up"). Quotes are
// escaped for the resource compiler, which would otherwise eat them.
val assetStatements =
    """[{"relation": ["delegate_permission/common.handle_all_urls"], "target": {"namespace": "web", "site": "https://$sbgHost"}}]"""
        .replace("\"", "\\\"")

// THE UPLOAD KEY, only when the workflow has unpacked one from the repository's secrets. Never in the repository.
val uploadStoreFile: File? = System.getenv("SBG_UPLOAD_KEYSTORE")?.takeIf { it.isNotBlank() }?.let { file(it) }?.takeIf { it.exists() }

android {
    namespace = "com.seebuyget.driver"
    compileSdk = 36

    defaultConfig {
        // Permanent once published (the plan, section 4.3).
        applicationId = "com.seebuyget.driver"
        // The web app runs on Android 7 and up; the car's part checks for Android 9 itself (CarLinkActivity), because
        // Android Auto needs it on the phone.
        minSdk = 24
        targetSdk = 36
        versionCode = prop("sbgVersionCode", "1").toIntOrNull() ?: 1
        versionName = prop("sbgVersionName", "0.1.0")

        manifestPlaceholders["sbgHost"] = sbgHost
        resValue("string", "asset_statements", assetStatements)

        buildConfigField("String", "SBG_HOST", literal(sbgHost))
        // Firebase's public Android settings. Empty: the app does not register for wake-ups, and says so (Push.kt).
        buildConfigField("String", "FIREBASE_PROJECT_ID", literal(prop("firebaseProjectId", "")))
        buildConfigField("String", "FIREBASE_APP_ID", literal(prop("firebaseAppId", "")))
        buildConfigField("String", "FIREBASE_API_KEY", literal(prop("firebaseApiKey", "")))
        buildConfigField("String", "FIREBASE_SENDER_ID", literal(prop("firebaseSenderId", "")))
    }

    signingConfigs {
        uploadStoreFile?.let { store ->
            create("upload") {
                storeFile = store
                storePassword = System.getenv("SBG_UPLOAD_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("SBG_UPLOAD_KEY_ALIAS")
                keyPassword = System.getenv("SBG_UPLOAD_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (uploadStoreFile != null) signingConfig = signingConfigs.getByName("upload")
        }
    }

    buildFeatures {
        buildConfig = true
        resValues = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources {
            excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/versions/9/previous-compilation-data.bin")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    // The Trusted Web Activity: Google's own launcher for a verified site (2.7.4, 6 October 2026).
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.4")
    // Firebase Cloud Messaging, for the content-free wake-up only (26.0.0, BoM 35.0.0, 7 October 2026). Initialised by
    // hand from BuildConfig (Push.kt): no google-services plugin, no google-services.json.
    implementation("com.google.firebase:firebase-messaging:26.0.0")
    // MessagingStyle, Person, RemoteInput, the notification channel: what the car reads (1.17.0, August 2025; the same
    // the browser helper asks for).
    implementation("androidx.core:core:1.17.0")

    testImplementation("junit:junit:4.13.2")
    // On a phone org.json is Android's own; in a JVM test Android's copy is a stub that throws, so the real one is used.
    testImplementation("org.json:json:20240303")
}
