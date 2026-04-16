# macOS Signing + Notarization Plan (TailorUsage)

This document describes the simplest official path to remove the recurring:

```sh
xattr -dr com.apple.quarantine /Applications/TailorUsage.app
```

## Goal

Distribute TailorUsage to Tailor developers without post-install quarantine workarounds.

Recommended approach:

1. Sign with `Developer ID Application`.
2. Notarize with Apple (`notarytool`).
3. Staple notarization ticket to the DMG.
4. Upload notarized DMG to GitHub release.

Once this is in place, the extra `xattr` step should no longer be needed for normal installs/updates.

## Why This Works

- Unsigned or non-notarized downloads are quarantined by Gatekeeper.
- Properly signed + notarized DMGs are trusted by macOS.
- Homebrew Cask installs from notarized artifacts without manual quarantine removal.

## One-Time Team Setup

1. Apple Developer Program
- Enroll Tailor in Apple Developer Program (if not enrolled already).
- Cost: `$99/year`.

2. Assign ownership
- Pick one release owner (or two backups) with Apple Developer admin access.
- They manage cert rotation and notary credentials.

3. Create Developer ID certificate
- On a Mac with Keychain Access:
  - Create CSR (Certificate Signing Request).
  - In Apple Developer portal, create/download `Developer ID Application` certificate.
  - Install certificate into login keychain.
- Export cert + private key as `.p12` (password protected).

4. Prepare notarization auth (choose one)
- Option A (recommended for CI): App Store Connect API key (`.p8`, key id, issuer id).
- Option B (fastest to start): Apple ID + app-specific password + team id.

## Local Verification Commands

After installing certs, verify available signing identities:

```sh
security find-identity -v -p codesigning
```

You should see a `Developer ID Application: ...` identity.

## 10-Step Runbook (End-to-End)

Use these exact 10 steps for your first signed + notarized release.

1. Create `Developer ID Application` certificate in Apple Developer
- Apple Developer Portal → `Certificates` → `+` → `Developer ID Application`.
- Upload CSR from Keychain Access if prompted.

2. Install cert and export backup
- Open downloaded `.cer` to install in Keychain.
- In Keychain Access → `My Certificates`, export as `.p12` with a password.

3. Create notarization password and collect team info
- At `appleid.apple.com`, create an app-specific password.
- Note your Apple ID email and Team ID.

4. Store notary credentials locally
```sh
xcrun notarytool store-credentials "tailor-notary" \
  --apple-id "<APPLE_ID_EMAIL>" \
  --team-id "<TEAM_ID>" \
  --password "<APP_SPECIFIC_PASSWORD>"
```

5. Confirm signing identity exists
```sh
security find-identity -v -p codesigning
```

6. Build release app
```sh
pnpm tauri build
```

7. Sign the `.app`
```sh
codesign --force --deep --options runtime --timestamp \
  --sign "Developer ID Application: <ORG_NAME> (<TEAM_ID>)" \
  src-tauri/target/release/bundle/macos/TailorUsage.app
```

8. Verify signature and (if needed) create DMG
```sh
codesign --verify --deep --strict --verbose=2 src-tauri/target/release/bundle/macos/TailorUsage.app
spctl --assess --type execute -v src-tauri/target/release/bundle/macos/TailorUsage.app

hdiutil create -volname "TailorUsage" \
  -srcfolder src-tauri/target/release/bundle/macos/TailorUsage.app \
  -ov -format UDZO \
  src-tauri/target/release/bundle/dmg/TailorUsage_x.y.z_aarch64.dmg
```

9. Notarize the DMG
```sh
xcrun notarytool submit src-tauri/target/release/bundle/dmg/TailorUsage_x.y.z_aarch64.dmg \
  --keychain-profile "tailor-notary" \
  --wait
```

10. Staple, validate, Gatekeeper-check, and upload
```sh
xcrun stapler staple src-tauri/target/release/bundle/dmg/TailorUsage_x.y.z_aarch64.dmg
xcrun stapler validate src-tauri/target/release/bundle/dmg/TailorUsage_x.y.z_aarch64.dmg
spctl --assess --type open --context context:primary-signature -v \
  src-tauri/target/release/bundle/dmg/TailorUsage_x.y.z_aarch64.dmg
gh release upload vx.y.z src-tauri/target/release/bundle/dmg/TailorUsage_x.y.z_aarch64.dmg --clobber
```

## Manual Release Flow (Simple Starting Point)

Use this flow first for one release, then automate in CI.

1. Build release artifact
```sh
pnpm tauri build
```

Expected DMG path:
`src-tauri/target/release/bundle/dmg/TailorUsage_x.y.z_aarch64.dmg`

2. Submit DMG for notarization

API key auth:
```sh
xcrun notarytool submit src-tauri/target/release/bundle/dmg/TailorUsage_x.y.z_aarch64.dmg \
  --key /path/to/AuthKey_XXXXXX.p8 \
  --key-id <KEY_ID> \
  --issuer <ISSUER_ID> \
  --wait
```

Apple ID auth:
```sh
xcrun notarytool submit src-tauri/target/release/bundle/dmg/TailorUsage_x.y.z_aarch64.dmg \
  --apple-id "<APPLE_ID_EMAIL>" \
  --team-id "<TEAM_ID>" \
  --password "<APP_SPECIFIC_PASSWORD>" \
  --wait
```

3. Staple the ticket
```sh
xcrun stapler staple src-tauri/target/release/bundle/dmg/TailorUsage_x.y.z_aarch64.dmg
xcrun stapler validate src-tauri/target/release/bundle/dmg/TailorUsage_x.y.z_aarch64.dmg
```

4. Gatekeeper check
```sh
spctl --assess --type open --context context:primary-signature -v \
  src-tauri/target/release/bundle/dmg/TailorUsage_x.y.z_aarch64.dmg
```

5. Upload to GitHub release
```sh
gh release upload vx.y.z src-tauri/target/release/bundle/dmg/TailorUsage_x.y.z_aarch64.dmg --clobber
```

## CI Preparation Checklist

When moving this to GitHub Actions, add secrets:

- `APPLE_CERTIFICATE_P12_BASE64`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_TEAM_ID`

And notarization auth secrets:

Option A (API key):
- `APPLE_API_KEY_BASE64`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER_ID`

Option B (Apple ID):
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`

## Rollout Plan

1. Next release: run manual notarization flow above once and verify no `xattr` needed on a clean teammate machine.
2. After success: automate signing + notarization in GitHub Actions.
3. Update `HOW_TO_DISTRIBUTE.md` and remove `xattr -dr ...` guidance.

## Notes / Caveats

- If app contents change after notarization, notarize again.
- Certificate expiration/rotation must be tracked by release owners.
- Notarization can take a few minutes; do not upload DMG before it succeeds and is stapled.
