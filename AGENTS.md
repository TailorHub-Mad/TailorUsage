# Repository Instructions

- Always run the tests when changing already existing features or flows. We want to make sure new implementations don't break old existing features over time. If the tests do not pass, we CANNOT have the implementation without having them all green and passing. Refactor as many times as you need while monitoring them.

- When asked to do a GitHub release (manually):
  - 1. Bump the version to <version_number> specified by the user in tauri.conf.json, Cargo.toml, package.json
  - 2. Then commit and push                                                                 
  - 3. `gh release create v${version_number}`
  - 4. Then run ./scripts/release.sh 
  - 5. Ensure the distributable is cleanly signed with:
    ```sh
    spctl --assess --type open --context context:primary-signature -v \
    src-tauri/target/release/bundle/dmg/TailorUsage_0.8.0_aarch64.dmg
    ```

    You want to see:
    TailorUsage_0.8.0_aarch64.dmg: accepted
    source=Notarized Developer ID

    If it says accepted + Notarized Developer ID, it's clean — Gatekeeper will let it
    through on any Mac without the xattr workaround. Any other output means something
    went wrong.

    If the local approach fails with the script, we have a GitHub Action that you can recommend users to launch. The workflow is called "Release"