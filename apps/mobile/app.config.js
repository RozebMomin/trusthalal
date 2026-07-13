// Dynamic Expo config. Everything lives in app.json; this file only layers
// on the Android Google Maps SDK key at build time so the secret never gets
// committed to the repo.
//
// react-native-maps on Android requires a Maps SDK for Android key, written
// into the manifest as com.google.android.geo.API_KEY. Expo sources that from
// android.config.googleMaps.apiKey — which we inject from the environment here.
//
// The key is created in the "HalalTrust" Google Cloud project as
// "trusthalal-mobile Android", restricted to package org.trusthalal.consumer
// plus the app-signing and upload signing SHA-1s, so it's only usable by our
// signed builds (safe to embed in the APK; not safe to leave in source).
//
// Set GOOGLE_MAPS_ANDROID_API_KEY:
//   * EAS cloud builds → add it as an EAS environment variable
//       eas env:create --name GOOGLE_MAPS_ANDROID_API_KEY --value <key> \
//         --environment production --environment preview --visibility sensitive
//   * Local prebuild/dev → put it in apps/mobile/.env.local (gitignored):
//       GOOGLE_MAPS_ANDROID_API_KEY=<key>
//
// iOS uses Apple Maps (no key needed), so a missing value only affects Android.

export default ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    config: {
      ...(config.android?.config ?? {}),
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY,
      },
    },
  },
});
