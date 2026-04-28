#!/usr/bin/env bash
# release.sh — build, sign, notarize, and upload TailorUsage
#
# Usage:
#   ./scripts/release.sh               # builds, signs, notarizes, uploads
#   ./scripts/release.sh --skip-build  # skip pnpm tauri build (use existing DMG)
#
# Prerequisites:
#   - Developer ID Application cert + private key in login keychain
#   - notarytool credentials stored: xcrun notarytool store-credentials "tailor-notary" ...
#   - gh CLI authenticated

set -euo pipefail

SIGN_IDENTITY="Developer ID Application: Tailor Hub SL (HRSMP2Z328)"
NOTARY_PROFILE="tailor-notary"
SKIP_BUILD=false

for arg in "$@"; do
  [[ "$arg" == "--skip-build" ]] && SKIP_BUILD=true
done

# ── Resolve version and paths ─────────────────────────────────────────────────
VERSION=$(python3 -c "import json,sys; print(json.load(open('src-tauri/tauri.conf.json'))['version'])")
ARCH=$(uname -m | sed 's/x86_64/x86_64/;s/arm64/aarch64/')
APP_NAME="TailorUsage"
DMG_NAME="${APP_NAME}_${VERSION}_${ARCH}.dmg"
DMG_PATH="src-tauri/target/release/bundle/dmg/${DMG_NAME}"
TMP_APP="/tmp/${APP_NAME}.app"

echo "▶ Release: v${VERSION} (${ARCH})"

# ── Preflight checks ──────────────────────────────────────────────────────────
echo "▶ Checking signing identity..."
if ! security find-identity -v -p codesigning | grep -qF "$SIGN_IDENTITY"; then
  echo "✗ Signing identity not found: $SIGN_IDENTITY"
  echo "  Run: security find-identity -v -p codesigning"
  exit 1
fi

# Resolve the cert hash to avoid ambiguity when duplicates exist
CERT_HASH=$(security find-identity -v -p codesigning \
  | grep -F "$SIGN_IDENTITY" \
  | head -1 \
  | awk '{print $2}')
echo "  Using cert hash: $CERT_HASH"

echo "▶ Checking notarytool profile..."
if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" &>/dev/null; then
  echo "✗ Notarytool profile '$NOTARY_PROFILE' not found."
  echo "  Run: xcrun notarytool store-credentials \"$NOTARY_PROFILE\" ..."
  exit 1
fi

# ── Build ─────────────────────────────────────────────────────────────────────
if [[ "$SKIP_BUILD" == false ]]; then
  echo "▶ Building..."
  pnpm tauri build
fi

if [[ ! -f "$DMG_PATH" ]]; then
  echo "✗ DMG not found at $DMG_PATH"
  exit 1
fi

# ── Extract .app from DMG ─────────────────────────────────────────────────────
echo "▶ Extracting .app from DMG..."
rm -rf "$TMP_APP"
MOUNT_DIR=$(mktemp -d "/tmp/${APP_NAME}.dmg.XXXXXX")
cleanup_mount() {
  hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
  rm -rf "$MOUNT_DIR"
}
trap cleanup_mount EXIT
hdiutil attach "$DMG_PATH" -readonly -nobrowse -mountpoint "$MOUNT_DIR" >/dev/null
cp -R "${MOUNT_DIR}/${APP_NAME}.app" "$TMP_APP"
hdiutil detach "$MOUNT_DIR" -quiet
rm -rf "$MOUNT_DIR"
trap - EXIT

# ── Sign .app ─────────────────────────────────────────────────────────────────
echo "▶ Signing .app..."
codesign --force --deep --options runtime --timestamp \
  --sign "$CERT_HASH" \
  "$TMP_APP"
codesign --verify --deep --strict "$TMP_APP"
echo "  .app signature OK"

# ── Recreate DMG from signed .app ─────────────────────────────────────────────
echo "▶ Creating signed DMG..."
hdiutil create -volname "$APP_NAME" \
  -srcfolder "$TMP_APP" \
  -ov -format UDZO \
  "$DMG_PATH"

# ── Sign DMG ─────────────────────────────────────────────────────────────────
echo "▶ Signing DMG..."
codesign --force --sign "$CERT_HASH" "$DMG_PATH"

# ── Notarize ─────────────────────────────────────────────────────────────────
echo "▶ Notarizing (this takes ~1 min)..."
xcrun notarytool submit "$DMG_PATH" \
  --keychain-profile "$NOTARY_PROFILE" \
  --wait

# ── Staple ───────────────────────────────────────────────────────────────────
echo "▶ Stapling notarization ticket..."
xcrun stapler staple "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"

# ── Gatekeeper check ──────────────────────────────────────────────────────────
echo "▶ Gatekeeper check..."
spctl --assess --type open --context context:primary-signature -v "$DMG_PATH"

# ── Upload to GitHub release ──────────────────────────────────────────────────
echo "▶ Uploading to GitHub release v${VERSION}..."
gh release upload "v${VERSION}" "$DMG_PATH" --clobber

echo ""
echo "✓ Done — v${VERSION} signed, notarized, and uploaded."
echo "  DMG: $DMG_PATH"
