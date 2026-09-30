# Gmail and MailApp setup

The free backend sends as `bazaarsignal@gmail.com` using Apps Script **MailApp**. The project administrator is `drew@theinnovativeowl.com`; the public app accepts any verified Google/Firebase user. The explicitly authorized real test recipient is `drewstake3@gmail.com`; ordinary alerts always use the creating user's verified Google/Firebase email.

## Authorization

The sender authorized the private BazaarSignal Free Backend script to send mail, fetch external data, access Firestore through Google OAuth and manage its time-driven trigger. The deployment tool separately received Apps Script project/deployment scopes. No inbox-reading scope is required by the application. Google may show an unverified-app notice for this private script; future authorization must still be performed by the sender account.

No Google access token or SMTP password is sent to the website, added to a URL, printed by application logging or included in source/build output. Server-side exceptions use sanitized messages. OAuth tool credentials live outside the repository; `.local`, `.clasp.json` and generated build files are ignored.

## Delivery and quota

Google currently documents **100 email recipients per day** for consumer Apps Script accounts. The quota is per user and resets 24 hours after the first request, not necessarily at midnight. This quota is shared across all app users. Confirmation emails count just like target emails, so one normal completed alert consumes two recipients from that budget. Other scripts on the sender account share it. Check the current [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas) and [MailApp remaining quota API](https://developers.google.com/apps-script/reference/mail/mail-app#getRemainingDailyQuota()).

The worker checks the remaining recipient budget before each send, persists delivery state, and defers queued messages when exhausted. Failure backoff is bounded, and known successful messages are not resent. MailApp acceptance cannot guarantee inbox receipt, and a crash after acceptance but before a persisted receipt can still cause a duplicate retry. See README.md and SETUP.md for the verification record.

## Existing encrypted app password

The previous SMTP experiment's encrypted app password remains untouched at:

`C:\Users\drews\Development\BazaarSignal\.local\bazaarsignal-gmail-password.dpapi`

It is protected by Windows DPAPI for this Windows account. MailApp does not read, decrypt, upload, log or reuse it. No Secret Manager or Firebase Blaze upgrade is needed. If you choose to retire the old SMTP credential, revoke that app password manually in the sender's [Google App passwords](https://myaccount.google.com/apppasswords); this migration did not change it or the account's two-step verification.

