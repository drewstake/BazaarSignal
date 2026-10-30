# Automatic portfolio price recovery — October 20, 2026

> Historical record. Dates, deployment versions, service status, costs and approvals below apply only to the recorded work. They are not current setup instructions or authorization to operate services. See the [documentation index](../README.md).


A temporary Firestore write throttle returns HTTP 503 with a one-minute
`retryAt`, while retaining the normal hourly `pollMs`. The browser previously
selected the later of that retry and the next hourly clock slot, leaving a
portfolio with no saved prices unavailable until the hourly check or a reload.

The visible-page scheduler now uses each server retry deadline once, including
when it falls before the next regular slot. Repeated throttles can supply a new
deadline; successful recovery restores normal hourly polling. An unchanged,
expired deadline cannot create a retry loop. Hidden pages wait until visible,
and unmounting, a terminal pause or release expiration still cancels recovery.

The public price cache retains saved prices and their original sample times
during a retryable 503, as it already did for a budget deferral. At recovery,
cached data saved before the retry deadline must be revalidated even within the
same hourly slot. A newer shared cache response can still avoid a duplicate GET.

## Verification

- Ten new integration regressions exercise the real scheduler, portfolio request
  and cache path: empty-cache recovery, repeated throttles, saved prices,
  same-slot revalidation, hidden pages, mounting during a wait, shared readers,
  expired deadlines, pause, unmount and release expiration.
- Full unit suite: 618 passed, one existing opt-in benchmark skipped.
- Desktop and mobile emulator browser tests both passed. Each injected a 503,
  advanced the clock one minute, observed restored holding prices and totals
  without a reload, and verified no additional request over the next ten minutes.
- Paid production frontend typecheck/build and `git diff --check` passed.

Run the regression with the existing Java 21 emulator setup:

```powershell
npx vitest run tests/portfolio-price-retry.test.ts
npx firebase emulators:exec --config firebase.test.json --only auth,firestore --project demo-bazaar-watch "npx playwright test --config playwright.retry.config.ts"
```

## Deployment scope

Firebase Hosting only, using `node scripts/build-paid-site.mjs` to preserve the
current paid release configuration. No collector, API, notification backend,
rules, schedules, budget settings or permissions change. The previous Hosting
version is retained as `sites/bazaarsignal/versions/dccdeee3bafa97c9`.

Deployed implementation commit `c65abf5` to Hosting version
`sites/bazaarsignal/versions/6a044b5ff03b3f06`, verified October 20 at 8:05 PM
America/New_York (October 21, 00:05 UTC). Published HTML and all five JavaScript
files matched the tested local build by SHA-256. The existing signed-in browser
loaded the new release and showed the Summoning Eye price, portfolio totals and
two chart observations with no captured JavaScript errors. The service-error
recovery itself was tested with intercepted responses in isolated emulators;
no production failure was induced. Before/after release receipts are saved under
ignored `.local/automatic-retry-release-{before,after}.json`.
