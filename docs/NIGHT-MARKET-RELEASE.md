# Night-market interface and portfolio value history

The October 4, 2026 source release includes the landing-page redesign, a separate signed-in courtyard, compact Account preferences, notification cards with threshold and state summaries, and a portfolio value chart above Holdings. Portfolio previews and feature cards are real components. The Account illustration was removed at the user's request. Generated artwork, prompts and the self-hosted font license are checked in.

The chart records observed complete portfolio estimates, without inventing historical prices. Local history is scoped to the signed-in user and portfolio, retained for up to 90 days and bounded to 5,000 points. Repeated reads of one price sample do not create new points. Purchases and holding revisions preserve earlier observations. Partial totals and development fixtures are not added to history. The chart includes period selection, pointer inspection and native keyboard exploration. Device history is not synchronized between computers.

All other pending workspace changes are included in the authorized source release: quantity calculation, Usage & Costs presentation, read-only local usage caching, disabled capacity planning and production automation gates. Collection, notification evaluation, email sending and background work remain disabled in source. Local workspace records, credentials, environment files and deployment receipts are excluded from Git.

## Verification

- 377 unit tests passed.
- 27 isolated emulator ownership, schema, backend and cache checks passed.
- All 26 desktop/mobile browser journeys passed against isolated emulators.
- Frontend, Apps Script, collector and market-function builds passed.
- Account, notification and chart screenshots were inspected on desktop and mobile. Chart tests cover actual totals, purchases, reload persistence, keyboard exploration, identity switching and missing prices.

## Deployment scope

The user authorized commit, push and deployment of all pending work. Hosting and private Firestore use the existing `bazaarsignal` project; Apps Script uses the existing deployment. Deployed Apps Script version 13 was saved under ignored `.local/night-market-release-before/apps-script/`, and its manifest and scopes match the new build.

The market-service predeploy command `node scripts/guard-market-deploy.cjs` rejected deployment because scope-aware capacity evidence is incomplete. No market-service rollout, activation, ledger reset or permission change is part of this release. The market service source is committed for a later release after the guard's prerequisites are satisfied.

## Deployed result

Implementation commit `18d5db4` was pushed to `main`. Hosting at https://bazaarsignal.web.app and Firestore rules/indexes were released to `bazaarsignal`. The existing Apps Script deployment now serves version 14; its URL, manifest and OAuth scopes were preserved. Version 13 remains available for rollback.

Production verification at 19:13 UTC confirmed that the published HTML and JavaScript bundle match the tested production build. The landing page passed 1440-, 390- and 320-pixel checks without JavaScript errors, horizontal overflow or market/backend requests. The existing Apps Script URL passed its read-only GET smoke check. Signed-in workflows were tested against isolated emulators without creating production test holdings or notifications.

The market Scheduler remains `PAUSED` with its existing five-minute expression. Market functions were not deployed because the capacity guard rejected their rollout. No market-service image was uploaded, no scheduled collection or email was invoked, and no collection allowance was activated. Release receipts and production screenshots are under ignored `.local/night-market-release-after/`.
