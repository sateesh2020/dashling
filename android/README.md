# Dashling for Android

A thin kiosk wrapper around the Dashling panel. It opens your panel full screen in a WebView:

- **Landscape only** (both landscape directions), fullscreen, no address bar.
- **Screen always on** while the app is open (`FLAG_KEEP_SCREEN_ON`; no browser secure-origin rules involved).
- Handles camera cut-outs (the panel's `env(safe-area-inset-*)` padding applies).
- Back button does nothing (kiosk). Links to any host other than your panel are ignored.
- If the panel can't be reached it shows "Can't reach the panel, retrying…" and retries every 5 s.

It is a plain Java app built with the Android command-line tools: no Gradle, no Android Studio.

## Build

One-time SDK setup (about 140 MB download, ~470 MB on disk), then build:

```bash
# 1. command-line tools from https://developer.android.com/studio#command-line-tools-only
#    unzip into ~/Library/Android/sdk/cmdline-tools/latest, then:
export JAVA_HOME=$(/usr/libexec/java_home)          # JDK 17+ recommended
yes | ~/Library/Android/sdk/cmdline-tools/latest/bin/sdkmanager --licenses
~/Library/Android/sdk/cmdline-tools/latest/bin/sdkmanager "platforms;android-34" "build-tools;34.0.0"

# 2. build
./android/build.sh              # -> android/dist/dashling.apk
```

`build.sh` signs the APK with a key it creates once in `~/.dashling-android/` (outside the repo, never committed).
Keep that folder: an update only installs over an existing app if it is signed with the same key.
Optional: `DASHLING_URL=192.168.1.20:8787 ./android/build.sh` bakes in a default address for your own build. It is not stored in the repo, and the app still lets you change it.

## Install

```bash
adb install -r android/dist/dashling.apk        # USB debugging on
```

or copy `dashling.apk` to the phone and open it (allow "install unknown apps" for your file manager or browser once).

## Set or change the address

On first launch the app asks for the panel address, e.g. `192.168.1.20:8787` (the port defaults to 8787; a full `http://` or `https://` URL also works). It is saved on the device.

To change it later: **press and hold the top-left corner for 1.5 seconds**, or **tap the screen with three fingers**. When the panel is unreachable there is also a "Change address" button.

The first time the panel opens, pair it with the 6-digit code from `docker compose logs -f dashling`. The pairing is kept in the app's storage. If you change the address to a different host or port, the app is a new origin and needs pairing again.

## Notes

- The app allows plain `http://` because the panel runs on your LAN, but it only ever loads the one address you entered.
- Google Safe Browsing is switched off for the WebView so your LAN address is not sent to Google.
- The system font scale is ignored (text zoom fixed at 100%) so the layout stays predictable.
- It does not auto-start on boot (Android restricts that). Open it once; with the screen kept on it stays up.
