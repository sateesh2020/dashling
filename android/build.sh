#!/usr/bin/env bash
# Builds dist/dashling.apk with the Android command-line tools only (no Gradle, no Android Studio).
# Optional: DASHLING_URL=192.168.1.20:8787 ./build.sh   (bakes in a default address; the app still lets you change it)
set -euo pipefail
cd "$(dirname "$0")"

SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BT="$SDK/build-tools/34.0.0"
JAR="$SDK/platforms/android-34/android.jar"
[ -x "$BT/aapt2" ] && [ -f "$JAR" ] || { echo "Missing Android SDK pieces in $SDK. Install: sdkmanager \"platforms;android-34\" \"build-tools;34.0.0\" (see README)." >&2; exit 1; }
export JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home 2>/dev/null || true)}"
[ -n "$JAVA_HOME" ] && export PATH="$JAVA_HOME/bin:$PATH"

KEYDIR="$HOME/.dashling-android"; KS="$KEYDIR/release.keystore"; PASS="$KEYDIR/ks.pass"
if [ ! -f "$KS" ]; then
  mkdir -p "$KEYDIR"; chmod 700 "$KEYDIR"
  ( umask 077; openssl rand -hex 24 > "$PASS" )
  keytool -genkeypair -keystore "$KS" -storepass:file "$PASS" -keypass:file "$PASS" -alias dashling \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Dashling" >/dev/null 2>&1
  chmod 600 "$KS"
  echo "Created signing key in $KEYDIR (keep it: updates must be signed with the same key)."
fi

rm -rf build; mkdir -p build/res build/gen build/classes build/dex dist
cp -R res/. build/res/
URL_ESC=$(printf '%s' "${DASHLING_URL:-}" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e "s/'/\\\\'/g")
printf '<?xml version="1.0" encoding="utf-8"?>\n<resources><string name="default_url" translatable="false">%s</string></resources>\n' "$URL_ESC" > build/res/values/default_url.xml

"$BT/aapt2" compile --dir build/res -o build/compiled.zip
"$BT/aapt2" link -o build/base.apk -I "$JAR" --manifest AndroidManifest.xml --java build/gen \
  --min-sdk-version 24 --target-sdk-version 34 --version-code "${VERSION_CODE:-1}" --version-name "${VERSION_NAME:-1.0}" build/compiled.zip
javac -source 8 -target 8 -Xlint:-options -bootclasspath "$JAR" -d build/classes $(find src build/gen -name '*.java')
"$BT/d8" --lib "$JAR" --min-api 24 --output build/dex $(find build/classes -name '*.class')
cp build/base.apk build/unaligned.apk
( cd build/dex && zip -q -j ../unaligned.apk classes.dex )
"$BT/zipalign" -f -p 4 build/unaligned.apk build/aligned.apk
"$BT/apksigner" sign --ks "$KS" --ks-pass "file:$PASS" --out dist/dashling.apk build/aligned.apk
"$BT/apksigner" verify dist/dashling.apk
echo "Built android/dist/dashling.apk ($(du -h dist/dashling.apk | cut -f1))"
