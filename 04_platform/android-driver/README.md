# SeeBuyGet Driver for Android

*2026-11-02 — slice S2 of "Messages in the car" ([05_engineering/android-auto-messages.md](../../05_engineering/android-auto-messages.md)).*

One app on Google Play, **SeeBuyGet Driver** (`com.seebuyget.driver`), made of two parts:

1. **The Driver web app, full screen.** A Trusted Web Activity (Google's
   [android-browser-helper](https://github.com/GoogleChrome/android-browser-helper)): Chrome opens
   `https://seebuyget.com/driver/?app=android` with no address bar, once the site's Digital Asset Links name this app.
   Every page it opens carries `app=android`, so the web page knows it is inside the Play app and may offer
   Settings › "Messages in the car". The web app's own notices (its bell, offers) appear as this app's.
2. **Messages in the car** — a small native part in Kotlin that does only the car's work:
   - **the link**: Settings › "Messages in the car" makes a car key on the server and opens
     `sbgdriver://car-link?key=car_…` (written by the page as
     `intent://car-link?key=…#Intent;scheme=sbgdriver;package=com.seebuyget.driver;end`). The app keeps the key
     encrypted (an AES-GCM key inside the Android Keystore; never backed up), asks for notifications on Android 13 and
     up, gets the phone's Firebase token, tells the server, and says "On for this phone". `sbgdriver://car-unlink`
     forgets it here;
   - **the wake-up**: the server sends a content-free Firebase data message, `{ kind: 'chat', conversationId }`. The
     app fetches that chat's unread messages from our server with the car key and posts a `MessagingStyle`
     notification — one per conversation, titled by the load, each message from the person the chat names —
     with **Reply** (spoken in the car, sent as text, marked "Sent from the car") and **Mark as read**;
   - **after a reply**, the notification shows the reply, or "Not sent: …" in the server's own words, which the car
     reads aloud.

The words of a chat never pass through Google's push service: Firebase carries a wake-up and a device token, nothing
else. The car draws nothing of ours but the conversation: never "Accept the load".

The contract with the server — the link, the four routes under `/v1/sbg/car/`, the `Authorization: Car <key>`
header, the field names — is in one file: [`CarContract.kt`](app/src/main/java/com/seebuyget/driver/car/CarContract.kt)
(the server's side: `backend/src/modules/pudo/car.controller.ts`, `car.types.ts`, `car.dto.ts`, `car-keys.ts`, `fcm.ts`).

## What the owner sets up

Accounts and keys only the owner holds. Nothing secret is ever put in the repository or sent to Claude.

### 1. Firebase (free)

1. [console.firebase.google.com](https://console.firebase.google.com) → a project → **Add app → Android**, package
   name `com.seebuyget.driver`. Cloud Messaging is on by default.
2. The project's **public Android settings** go in the build. Download `google-services.json` (it is not secret, but it
   is not committed either: only these four values are used) and set them as **repository variables** (GitHub →
   Settings → Secrets and variables → Actions → **Variables**):

   | Variable | Where in `google-services.json` |
   |---|---|
   | `SBG_FIREBASE_PROJECT_ID` | `project_info.project_id` |
   | `SBG_FIREBASE_SENDER_ID` | `project_info.project_number` |
   | `SBG_FIREBASE_APP_ID` | `client[0].client_info.mobilesdk_app_id` (`1:…:android:…`) |
   | `SBG_FIREBASE_API_KEY` | `client[0].api_key[0].current_key` |

   (Or write them into [`gradle.properties`](gradle.properties); a repository variable wins.) Until all four are set, the
   app builds and runs, and turning Messages in the car on says it is not ready in this version — it never crashes.
3. A **service-account key** for the server (Project settings → Service accounts → Generate new private key) goes in
   the **server's `.env`** only — S1's `GLOS_FCM_PROJECT_ID` and `GLOS_FCM_SERVICE_ACCOUNT`. Never in git, never in
   this app.

### 2. Google Play

1. A developer account at [play.google.com/console](https://play.google.com/console) (one-time US$25; identity
   verified). Create the app **SeeBuyGet Driver**; the package name `com.seebuyget.driver` is permanent once published.
2. **Play App Signing** (the default): Play keeps the app's signing key. You make an **upload key** once, on any
   computer with Java (a one-second command, not a build):

   ```sh
   keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
   base64 -w0 upload.jks > upload.jks.b64     # macOS: base64 -i upload.jks -o upload.jks.b64
   ```

   and put it in the repository's **secrets** (Settings → Secrets and variables → Actions → **Secrets**):

   | Secret | What |
   |---|---|
   | `SBG_UPLOAD_KEYSTORE_BASE64` | the contents of `upload.jks.b64` |
   | `SBG_UPLOAD_KEYSTORE_PASSWORD` | the keystore's password |
   | `SBG_UPLOAD_KEY_ALIAS` | `upload` (the alias above) |
   | `SBG_UPLOAD_KEY_PASSWORD` | the key's password |

   With these four, every push to the app also builds a **signed release bundle** (`.aab`) to upload to Play's internal
   testing track. Keep `upload.jks` somewhere safe outside the repository.
3. *(Optional)* `SBG_DEBUG_KEYSTORE_BASE64` — a debug keystore (store password `android`, alias `androiddebugkey`, key
   password `android`), so every test build is signed alike and a newer one installs over an older one. Without it
   each build makes its own, and the old test app must be uninstalled first.

### 3. Digital Asset Links (the site says "this app speaks for me")

Without it the app still works, but Chrome shows an address bar at the top. The site must serve
`https://seebuyget.com/.well-known/assetlinks.json` (as `application/json`):

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.seebuyget.driver",
    "sha256_cert_fingerprints": [
      "<Play Console → Test and release → App integrity → App signing key certificate → SHA-256>",
      "<the upload key's SHA-256, for builds installed from the CI artifact>"
    ]
  }
}]
```

A key's SHA-256: `keytool -list -v -keystore upload.jks -alias upload`. (Serving the file is slice S3: it has to be a
real file under the site's root, because the site answers a missing file with a 404.)

### 4. Trying it in a car

1. Install the app: Play's internal testing track (the release bundle), or the debug APK from a build's artifacts.
2. **Android Auto developer mode** on the phone: Android Auto's settings → tap **Version** ten times → the menu ⋮ →
   **Developer settings** → tick **Unknown sources** (needed for an app not installed from Play).
3. In the app: Settings › **Messages in the car** → on. The dialog says "On for this phone".
4. Have someone write in a chat about one of your loads. The car announces it, reads it on request, and offers Reply
   and Mark as read. A test without a car: Google's **Desktop Head Unit** (Android Studio → SDK Manager → Android Auto
   Desktop Head Unit) — on a machine that can take the load, not this one.

## How it is built

**On GitHub only** — [`.github/workflows/android-driver.yml`](../../.github/workflows/android-driver.yml), on every push
or pull request that touches this folder or that workflow, and by hand (Actions → Android driver app → Run workflow).
A Gradle build on the owner's machine is exactly the load that shuts it down, so it is never run there. The site's own
workflows (`deploy.yml`, `ci.yml`) leave this folder out: a change here never redeploys the site.

- **No Gradle wrapper.** `gradlew` needs `gradle/wrapper/gradle-wrapper.jar`, a binary that cannot be produced here
  without running Gradle. The workflow puts a pinned Gradle on the path instead (`gradle/actions/setup-gradle`,
  `GRADLE_VERSION` in the workflow). Someone building on a machine that can take it: install Gradle 8.14.6, JDK 17 and
  the Android SDK, then `gradle testDebugUnitTest assembleDebug` here — or `gradle wrapper --gradle-version 8.14.6`
  once to make a wrapper there (not committed).
- **What a run does:** the JVM unit tests (`testDebugUnitTest`), the debug APK (`assembleDebug`), and — with the upload
  key among the secrets, never on a pull request — the signed release bundle (`bundleRelease`, shrunk with R8). The
  APK and the bundle are kept as the run's artifacts (14 and 30 days); a failed run keeps its logs and test reports
  (7 days).
- **Reading a failure without the log.** Build logs need admin rights; a check run's **annotations** do not. The
  workflow saves Gradle's output to a file and, on a failure, [`ci/report.mjs`](ci/report.mjs) turns it into
  annotations: Kotlin and Java errors, resource and manifest errors at their file and line, Gradle's "What went wrong",
  R8 and lint errors, failed unit tests (from their JUnit XML) at the line of the test. GitHub shows ten error
  annotations a step and fifty a job, so the first annotation, **"Android build failed"**, lists every problem in one
  message, and the rest come ten a step. On success, the first ten Kotlin warnings are annotations too. Read them:

  ```sh
  curl -s https://api.github.com/repos/HvAalst/see-buy-get/commits/<commit>/check-runs     # the run's id
  curl -s https://api.github.com/repos/HvAalst/see-buy-get/check-runs/<id>/annotations
  ```

  The run's page also has a short summary: the result, the tests, the APK's size, the site, whether Firebase is set,
  the versions. `node ci/report.mjs --log <a saved log> --problems out.txt` reads a saved log anywhere, without a build.

## Versions, and why

| What | Version | Why |
|---|---|---|
| Android Gradle Plugin | 8.13.2 | The last of the 8 line: the DSL and the Kotlin plugin as they have worked for years. AGP 9 builds Kotlin itself and changes the DSL — a move to make on purpose, not on a first build nobody can watch. |
| Kotlin | 2.3.21 | Tested by JetBrains with AGP 8.2.2–9.0.0 and Gradle up to 9.3; out since the spring. |
| Gradle | 8.14.6 | The 8.14 line's latest fix (8 October 2026), the line AGP 8.13 is made for. |
| JDK | 17 (Temurin) | What AGP 8 needs; Java and Kotlin compile for 17. |
| compileSdk / targetSdk | 36 | Google Play has required API 36 of new apps and updates since 31 August 2026. |
| minSdk | 24 | Android 7, what the libraries ask; Messages in the car checks for Android 9 itself (Android Auto needs it), the web app does not. |
| androidbrowserhelper | 2.7.4 | Google's Trusted Web Activity launcher, 6 October 2026. |
| firebase-messaging | 26.0.0 | Firebase BoM 35.0.0, 7 October 2026 (its one breaking change: minSdk 24). |
| androidx.core | 1.17.0 | MessagingStyle, Person, RemoteInput, the channel; the same the browser helper asks for (1.18 is built against API 36.1). |
| JUnit / org.json (tests) | 4.13.2 / 20240303 | org.json: on a phone it is Android's own; in a JVM test Android's copy is a stub. |
| GitHub actions | checkout v7, setup-java v6, setup-gradle v6, upload-artifact v7 | The current majors. setup-gradle's cache is set to `basic` (open source): its default is a commercial component under Gradle's own terms, which are the owner's to accept or not. |

Every version is at least two weeks old. HTTP is the platform's own `HttpURLConnection`: four small JSON calls do not
need a library — nothing more to keep up with each year, nothing more for Google's review to read.

## The code

```
app/src/main/java/com/seebuyget/driver/
  car/                      what the tests run: no Android in it
    CarContract.kt          the contract, in one place
    CarLink.kt              reading the car link, strictly
    CarRequests.kt          the four requests, as data
    CarReplies.kt           the server's answer: taken, or why not
    ChatModel.kt            the chat → the notification's lines; the line after a reply
    IsoTime.kt, Json.kt, Paths.kt, LaunchUrls.kt
  DriverApp.kt              Firebase started by hand; the channel made
  DriverLauncherActivity.kt the Trusted Web Activity, `app=android` on every page
  CarLinkActivity.kt        turning it on or off for this phone
  DriverMessagingService.kt the wake-up
  ChatNotifier.kt           the MessagingStyle notification and its two actions
  CarActionReceiver.kt      Reply and Mark as read, in the background
  CarMessages.kt            the work: fetch, show, reply, mark read, register
  CarKeyStore.kt            the key, encrypted with the Android Keystore
  Push.kt, HttpTransport.kt
app/src/test/java/com/seebuyget/driver/car/   the JVM unit tests
ci/report.mjs                                  a failed build → annotations and a summary
```
