# Repository cleanup — October 30, 2026

Implemented on `feature/repo-cleanup`, starting from `4bdf8bb`, which matched fetched `origin/main`. The initial tracked working tree was clean. Ignored local data, environment files, credentials and existing backups were preserved. Nothing was deployed or pushed; no email, collection, cloud configuration, budget or schedule was changed.

## Changes

- Rewrote the root README around implemented product behavior and accurate development modes. Current setup, architecture, features and operating procedures now have a small [documentation index](README.md). Existing release/incident records, including old `SETUP.md` and `GMAIL_SETUP.md`, moved to `history/` with explicit historical notices. Personal narrative examples use placeholders; production configuration and machine evidence are unchanged.
- Removed `Claude outputs/`, root `preview-*.png`, `Price-Alerts-UI/`, `Sky-Island-UI-Assets/`, `design-concepts/`, duplicate ZIPs, the unused public gallery and unused night-market background/account studies. Every removed file was first copied and checksum-verified into ignored `.local/repo-cleanup/archive/`; the local baseline and change manifest identify original paths and hashes.
- Relocated the 15 runtime icon originals and three night-market PNG sources, with useful prompts, into `assets/artwork/`. Generators now read that canonical source location. Runtime paths, optimized files, font license, item-artwork attribution and catalog inputs remain available. Full-resolution originals for the 27 separately generated item icons were never tracked here and remain a provenance limitation.
- Kept referenced audit logs, screenshots, JSON and manifests at stable `docs/measurements/` paths. Future automatic profiles/cost reports now write under ignored `.local/`; benchmarks create the requested output directory rather than touching documentation.
- Pinned development Node in `.nvmrc`, documented the separate market-backend install, corrected environment examples, added narrowly scoped ignores and minimal isolated CI, and added offline link/asset/build checks. Dependency versions and functional application behavior are unchanged.

## Size and verification

“Tracked tree” measures the intended new file set, including new files awaiting commit; it does not measure `.git` storage. Asset totals include images, fonts and ZIPs across the tree, including retained source artwork and audit screenshots.

| Measure | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Tracked assets | 118,044,747 bytes (112.58 MiB), 172 files | 30,678,798 bytes (29.26 MiB), 92 files | 87,365,949 bytes (83.32 MiB), 74.0% |
| All `public/` files copied into builds | 41,746,660 bytes (39.81 MiB), 101 files | 9,768,807 bytes (9.32 MiB), 70 files | 31,977,853 bytes (30.50 MiB), 76.6% |

102 files were archived and removed, and 69 files were relocated. No identical asset hashes remain in the intended tracked tree. All retained public assets, relocated source PNGs, catalog inputs, machine-readable audit evidence and functional production configuration match the baseline hashes. The root lockfile changes only the development engine metadata. Removing files does not remove them from Git history; the ignored local archive also still consumes local disk space.

Verification ran in a fresh local snapshot with only tracked/nonignored project files, no `.env.local`, no production environment files and no copied databases or credentials. Root and market backend `npm ci` both passed. The root install reported 25 advisories (8 moderate, 17 high), and the market install reported 4 moderate advisories. These are dependency-audit findings, not an exploitability assessment. The root install also reported the retained legacy Node 22 engine mismatch and install-script approval notices; neither prevented the following checks.

| Check | Result |
| --- | --- |
| `npm test` | 931 passed; 1 opt-in performance benchmark skipped, both in the working tree and clean snapshot |
| `npm run build` | Passed frontend and Apps Script checks/bundles, including a build without environment files |
| `npm run build:collector` | Passed in the clean snapshot |
| `npm run build:market-functions` | Passed in the clean snapshot after its separate install |
| `npm run test:rules` | 31 passed against isolated Firestore |
| `npm run test:browser` | 38 desktop/mobile checks passed against isolated Auth/Firestore |
| Search Playwright configuration | 54 desktop/mobile search, order-book, history and recovery checks passed |
| Actual `dev:preview` / `dev:preview:offline` launchers | Both opened without Firebase values; desktop/mobile checks verified search, disabled sign-in, no broken images/overflow or page errors; empty offline cache showed unavailable data |
| Artwork generation | 30 icons regenerated with identical decoded pixels; original compressed bytes retained to avoid encoder-only churn. All three night-market exports passed exact RGBA checks and retained their original bytes |
| Catalog builder | Rebuilt 1,866 names offline from retained inventory/exclusions |
| Repository checker | Local Markdown targets/anchors, literal and dynamic runtime paths, source inputs, font license and copied build assets passed; no source prompts, galleries or ZIPs in the new build |
| `git diff --check` | Passed |

All browser checks used isolated data; external Google Fonts requests were blocked during preview inspection and fallback typography remained usable. Screenshots were visually inspected at 1440px and 390px. Live verification was limited to an HTTP 200 response for the hosted website; authentication, collection, notification delivery and deployed revisions were not reverified. CI was added but was not run on GitHub because nothing was pushed.

No build/test prerequisite was unavailable: the existing ignored Java 21 runtime and installed Chromium were used. Signed-in local development still requires the existing BazaarSignal Firebase configuration. Exact originals for the separately generated 27 item icons are absent from the repository, as previously documented. Build warnings about large chunks and future Vite native-loader import extensions remain. Detailed logs, manifests and screenshots stay in ignored `.local/repo-cleanup/`.

## Prioritized follow-ups

1. **Resolve the service lifecycle deliberately.** `shared/paid-pilot.ts` fixes expiry at November 1, 2026, 07:00 UTC. The launcher and browser schedules depend on that identity/deadline. Decide renewal or retirement through a separately authorized operational change; current availability was not inferred from source or old receipts.
2. **Review dependency advisories separately.** The fresh installs reported 25 root advisories and 4 market-package advisories, consistent with remaining issues in the [October 29 dependency evidence](measurements/app-audit-fixes-2026-10-29/npm-audit-root.json). Assess reachable runtime paths before a focused upgrade; this cleanup did not change dependency versions or claim those findings are all exploitable.
3. **Decide the project license and complete source-art retention.** No repository license exists; choosing one requires the owner. The item-artwork review records 27 external originals that are not reproducible from this checkout alone. Preserve those inputs with their provenance if exact future re-export is needed.
4. **Review legacy runtime and operator-tool maintenance.** `functions/package.json` still declares Node 22 while the supported local toolchain and market backend use Node 24. Numerous dated operator scripts and fixed test deadlines remain. Consider consolidating supported entry points and time-independent fixtures in a separate change; retain existing guards and historical evidence.
