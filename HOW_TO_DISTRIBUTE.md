# How to distribute TailorUsage to the team

## One-time install (per machine)

Send your team this message:

---

**Hey team — TailorUsage is now installable via Homebrew. Run these two commands:**

```sh
brew tap TailorHub-Mad/tailorusage
brew install --cask tailorusage
```

That's it. The app will appear in your Applications folder and can be launched from there.

---

## Getting future updates

When a new version is released, team members update with:

```sh
brew upgrade --cask tailorusage
```

## Releasing a new version (for maintainers)

1. Make your changes and bump the version in both:
   - `src-tauri/Cargo.toml` → `version = "x.y.z"`
   - `src-tauri/tauri.conf.json` → `"version": "x.y.z"`

2. Commit, push, and create a GitHub release:
   ```sh
   git add -A && git commit -m "chore: release vx.y.z"
   git push origin main
   gh release create vx.y.z --title "vx.y.z" --notes "What changed"
   ```

3. Build the DMG:
   ```sh
   brew install create-dmg  # only needed once
   rm -rf src-tauri/target/release/bundle  # clean stale bundle dir to avoid DMG errors
   pnpm tauri build
   # Output: src-tauri/target/release/bundle/dmg/TailorUsage_x.y.z_aarch64.dmg
   ```

4. Get the SHA256 and upload the DMG to the release:
   ```sh
   shasum -a 256 src-tauri/target/release/bundle/dmg/TailorUsage_x.y.z_aarch64.dmg
   gh release upload vx.y.z src-tauri/target/release/bundle/dmg/TailorUsage_x.y.z_aarch64.dmg
   ```

5. Update the Homebrew cask with the new version and SHA256:
   ```sh
   git clone https://github.com/TailorHub-Mad/homebrew-tailorusage.git /tmp/homebrew-tailorusage
   # Edit /tmp/homebrew-tailorusage/Casks/tailorusage.rb:
   #   version "x.y.z"
   #   sha256 "<new sha256>"
   cd /tmp/homebrew-tailorusage
   git add . && git commit -m "chore: update tailorusage to vx.y.z"
   git push origin main
   ```

Team members will get the update next time they run `brew upgrade --cask tailorusage`.
