# Notification sender repair — October 18, 2026

> Historical record. Dates, deployment versions, service status, costs and approvals below apply only to the recorded work. They are not current setup instructions or authorization to operate services. See the [documentation index](../README.md).


The live Summoning Eye notification form failed with `Deploy and authorize using
the configured sender account.` A credential-free POST to the existing web app
reproduced that error at `2026-10-19T03:23:05Z` (October 18 in America/New_York).
The backend checks its effective execution identity before validating the
requesting Firebase user, so this was a deployment issue rather than a user's
Google sign-in problem.

Using the existing signed-in `sender@example.com` account, the existing Apps
Script deployment was updated with the **same version 21**. Its deployment ID,
URL, anonymous transport setting and source version were retained. No code,
scope, script property, signing key, trigger, cloud service, budget or expiration
was changed. The sender's existing authorization was sufficient; no new consent
was requested.

The deployment is `<apps-script-deployment-id>`.
Google confirmed the update, and the same anonymous probe then returned
`Sign in with the verified Google account.` at `2026-10-19T03:23:36Z`. That proves
the live request passed the configured sender check while retaining the
authenticated mutation boundary. The existing read-only `diagnostics` function
also completed successfully as the sender at 11:25 PM Eastern, exercising its
MailApp quota and Firestore access without sending a message.
The sender's Triggers page showed its one existing `scheduledPaidMinuteTick`
time-based trigger, most recently run at 11:25:12 PM Eastern. It was not edited.

The user's open form retained the sample baseline, **15% upward** target and
empty downward target. One authenticated retry passed the sender check but was
rejected with `Wait for a fresh valid price sample to enable this baseline.`
The alert was **not saved or enabled**, and no test or confirmation email was
sent. Capturing a sample still requires the existing fresh-price window; this
repair does not weaken that guard or force collection.

## Release check

Run this after every Apps Script deployment, even when the editor displays
`Execute as Me (sender@example.com)`:

```powershell
node scripts/verify-notification-deployment.mjs https://script.google.com/macros/s/<apps-script-deployment-id>/exec
```

It sends no credential or holding identifier, cannot create an alert, and fails
unless the request reaches the expected identity-validation boundary. This
checks deployment configuration, not actual email delivery or market freshness.
Google documents the execution setting in the [web app manifest reference](https://developers.google.com/apps-script/manifest/web-app-api-executable).

The October 16 release record's statement that the execution account was
preserved was not backed by a live protected-endpoint check. This incident and
repair supersede that assertion. Local before/after probe receipts are retained
under `.local/notification-sender-before.json` and
`.local/notification-sender-after.json`.
