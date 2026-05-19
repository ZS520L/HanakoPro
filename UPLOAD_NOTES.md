# GitHub Upload Notes

This folder contains the source files intended for publishing the project to GitHub.

## Included

- Source code and runtime code: `core/`, `desktop/`, `hub/`, `lib/`, `packages/`, `plugins/`, `server/`, `shared/`
- Build and maintenance scripts: `scripts/`, `build/`
- Tests: `tests/`
- Built-in examples and skill/plugin resources: `examples/`, `skills2set/`
- Project metadata and configuration: `package.json`, `package-lock.json`, `.npmrc`, Vite/TypeScript/Vitest/ESLint config files
- Documentation and community files: `README*`, `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, plugin docs, `.github/`

## Excluded

- Dependencies: `node_modules/`
- Build outputs: `dist/`, `dist-server/`, `dist-server-bundle/`, `dist-sandbox/`, `dist-computer-use/`, `desktop/dist-renderer/`
- Caches and runtime state: `.cache/`, `.pi/`, `agents/`, `user/`
- Logs and temporary files: `*.log`, `*.err`, `*.obj`, `tmp/`, `test-results/`
- Secrets and credentials: `.env*`, `*.key`, `*.pem`, `*.p12`, `*.crt`, `credentials.json`, `secrets.json`, `secrets.yaml`, `auth.json`
- Large third-party runtime bundles: `vendor/`

## Important packaging note

The Windows build configuration references `vendor/git-portable`. This upload folder intentionally does not include `vendor/`. Before building Windows installers from a clean clone, document or provide a script to prepare `vendor/git-portable`.
