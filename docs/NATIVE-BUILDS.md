# Native iOS & Android builds (Capacitor)

Postcards is one web codebase shipped as a **PWA** and wrapped natively with
[Capacitor](https://capacitorjs.com). The web build in `dist/` is the app; the native projects are
thin shells that load it.

## What's in the repo

- `capacitor.config.ts` — appId `coop.samourai.postcards`, appName `Postcards`, `webDir: dist`.
- `@capacitor/core` + `@capacitor/cli` + `@capacitor/android` + `@capacitor/ios` (installed).
- `android/` — the Android project, **scaffolded and committed** (`npx cap add android`). Build
  outputs (`*.apk`, `build/`, `.gradle`, copied web assets) are git-ignored; only source is tracked.
- npm scripts: `cap:sync`, `cap:copy`, `cap:add:ios`, `cap:open:android`, `cap:open:ios`,
  `native:android`, `native:ios`, **`apk:debug`** (headless APK, below).

## Android — get an APK

### Easiest: download the APK

The newest build of `main` is always at one permanent URL:

**<https://github.com/offware-apps/Postcards/releases/download/android-latest/postcards.apk>**

Open it on the phone, open the downloaded file, and allow "install unknown apps" for the browser if
Android asks. The [`Android APK`](../.github/workflows/android-apk.yml) workflow builds it on every
push to `main` and republishes the rolling `android-latest` release, so the tag always points at the
current commit while the URL never changes. It links to the tag rather than to
`releases/latest/download/…`, which follows whichever release GitHub marks latest and breaks the day
a versioned release without a `postcards.apk` asset is published.

Every push (to `main`, any `claude/**` branch, or a manual run from Actions → **Android APK** →
*Run workflow*) also uploads the APK as the run's **`postcards-apk`** artifact.

Each build carries `versionCode` = the workflow run number (it only grows) and `versionName` =
`<package.json version>-<short sha>`. Locally both default to `1` / `1.0`; pass
`-PversionCode=… -PversionName=…` to `gradlew` to set them.

### Signing: one key, so updates install over the previous app

Android installs an APK as an update only when it is signed with the same key as the installed app
and its `versionCode` is not lower; otherwise the user must uninstall first, and uninstalling deletes the
app's data (`allowBackup` is off). The debug keystore is generated fresh on every CI runner, so debug
builds cannot update one another.

When the four repository secrets below exist, CI builds `assembleRelease` signed with that key.
Without them (forks, or before the secrets are set) it builds the debug APK, as before. Create the
key once, keep the `.jks` file and its password somewhere safe outside the repo (losing it means
every user has to uninstall to get the next version), and set the secrets:

```bash
# PKCS12 keystores use one password for the store and the key.
read -rs -p "Keystore password: " KS_PASS; echo
keytool -genkeypair -v -storetype PKCS12 -keystore postcards-release.jks \
  -alias postcards -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Postcards, O=offware-apps" \
  -storepass "$KS_PASS" -keypass "$KS_PASS"

base64 -w0 postcards-release.jks | gh secret set ANDROID_KEYSTORE_BASE64 -R offware-apps/Postcards
printf '%s' "$KS_PASS" | gh secret set ANDROID_KEYSTORE_PASSWORD -R offware-apps/Postcards
printf '%s' "$KS_PASS" | gh secret set ANDROID_KEY_PASSWORD -R offware-apps/Postcards
printf '%s' postcards | gh secret set ANDROID_KEY_ALIAS -R offware-apps/Postcards
unset KS_PASS
```

(`base64 -w0` is GNU; on macOS use `base64 -i postcards-release.jks`.) The first signed APK cannot
install over a debug build already on a phone: export your data (Settings → Your data), uninstall,
install the signed APK, import the file. Every later build updates in place.

To sign a release build locally with the same key, export `POSTCARDS_KEYSTORE_FILE` (path to the
`.jks`), `POSTCARDS_KEYSTORE_PASSWORD`, `POSTCARDS_KEY_ALIAS` and `POSTCARDS_KEY_PASSWORD`, then run
`./gradlew assembleRelease` in `android/`.

### Launcher icon

The launcher icons in `android/app/src/main/res/mipmap-*` are generated once from the PWA's
maskable icon, whose pin already sits inside Android's 66 dp adaptive-icon safe zone: the
adaptive foreground (108 dp, 108–432 px) is that icon full-bleed, and the legacy square and round
icons (48–192 px, Android 7.1 and older) are it cut to a rounded square and a circle. The adaptive
background, `values/ic_launcher_background.xml`, is the icon's own indigo `#4338CA`. After changing
`public/icons/maskable-512.png`, re-run from `apps/postcards` (ImageMagick 7; the output is
byte-identical on a re-run):

```bash
src=public/icons/maskable-512.png
res=android/app/src/main/res
png="-strip -define png:exclude-chunks=date,time"
for d in mdpi:48:108 hdpi:72:162 xhdpi:96:216 xxhdpi:144:324 xxxhdpi:192:432; do
  IFS=: read -r name legacy fg <<< "$d"
  magick "$src" -resize "${fg}x${fg}" $png "$res/mipmap-$name/ic_launcher_foreground.png"
  magick "$src" -alpha set \( -size 512x512 xc:none -fill white -draw "roundrectangle 0,0 511,511 88,88" \) \
    -compose DstIn -composite -resize "${legacy}x${legacy}" $png "PNG32:$res/mipmap-$name/ic_launcher.png"
  magick "$src" -alpha set \( -size 512x512 xc:none -fill white -draw "circle 256,256 256,0" \) \
    -compose DstIn -composite -resize "${legacy}x${legacy}" $png "PNG32:$res/mipmap-$name/ic_launcher_round.png"
done
```

### Build the APK locally, headless (no Android Studio)

Needs **JDK 17** + the **Android SDK / command-line tools** with `ANDROID_HOME` (or
`ANDROID_SDK_ROOT`) set — but *not* Android Studio:

```bash
pnpm --filter postcards apk:debug
# = pnpm build → cap sync android → android/ ./gradlew assembleDebug
# → apps/postcards/android/app/build/outputs/apk/debug/app-debug.apk
```

### With Android Studio (interactive)

```bash
pnpm --filter postcards native:android   # build → cap sync android → cap open android → Run / Build APK/AAB
```

If `android/` is ever missing or you want to regenerate it: `pnpm --filter postcards cap:add:android`.

> **APK size (~25 MB).** `cap sync` copies all of `dist/` into the app assets, including the 17 MB
> full gazetteer (`reference/cities-all.json`). On the web that file is downloaded on demand to keep
> the install small; bundling it into the native app is harmless — it just means the native app is
> **fully offline out of the box**. A leaner APK would need a dedicated build variant that excludes it
> *and* verifies the on-demand fetch works inside the Capacitor `https` scheme — a separate change.

## iOS (macOS only)

Requires Xcode + CocoaPods. The `ios/` project isn't committed because it can't be generated off
macOS — create it once on a Mac:

```bash
pnpm --filter postcards build
pnpm --filter postcards cap:add:ios    # generates ios/ (Xcode project + pods)
pnpm --filter postcards cap:open:ios   # open in Xcode → set a signing team → Run
# or, after ios/ exists:
pnpm --filter postcards native:ios
```

## Notes

- **Offline-first carries over.** The PWA already precaches the app shell + reference data; inside
  the native shell the same assets load with no network. The opt-in online OSM basemap needs a
  connection; the offline overview and (when installed) the offline PMTiles streets pack do not.
- **Vite `base`** is `/` (default), which is correct for the native shell (served from root). Only
  change it if you also host the PWA under a sub-path.
- **Native file export.** On device, the browser download used by *Your data → Export* should be
  swapped for `@capacitor/filesystem` + `@capacitor/share` to write/share the portable JSON. Add
  those plugins when implementing native export; the web path is unchanged.
- **Shared Offline Map Store.** The `OfflineMapStore` seam (see
  [`OFFLINE-MAPS.md`](OFFLINE-MAPS.md)) is where a native `SharedOfflineMapStore` plugin (iOS App
  Group / Android SAF) plugs in, so map packs are device-global across the ecosystem.
- **CI.** The `Android APK` workflow builds on GitHub's Ubuntu runners (JDK 17 + the runner's
  Android SDK; `gradlew` self-bootstraps Gradle): a signed release APK when the signing secrets are
  set, the debug APK otherwise. A Play Store AAB and iOS (a macOS runner with an Apple signing team)
  are out of scope.
