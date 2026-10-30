# Notification sender

The current Apps Script backend uses **MailApp** under the configured sender account. Ordinary recipients come from verified Google/Firebase identity, not a client-supplied email address. The app does not need inbox-reading permission. `functions/` and its SMTP example describe a retained legacy backend, not a prerequisite for local development.

## Authorization and configuration

Use the existing sender-owned script and existing deployment. Sender reauthorization, when required, is performed by that account. Retain signing properties, Firebase configuration, exact origin allowlists, trigger identity and scope boundaries. Store account-specific IDs and credentials outside public documentation. Examples such as `sender@example.com` are placeholders, not production settings.

Inspect saved source and the versioned web endpoint separately: installed triggers run saved source, while HTTP calls use a deployed version. A successful account/settings request does not prove that a scheduled worker ran or mail was delivered. The [historical sender repair](../history/NOTIFICATION-SENDER-REPAIR-2026-10-18.md) illustrates that distinction; its version numbers are not current instructions.

## Delivery checks

Before investigating delivery, check the holding/portfolio, notification revision, opt-in preference, verified identity, sample timestamp, pause/expiry state and delivery status. Missing or stale market evidence must not be replaced with test prices. Local launchers validate configuration but never send mail; isolated tests mock delivery.

The worker checks remaining MailApp recipient quota before sending and persists claims/receipts. Quota deferral and bounded retries do not guarantee delivery time or inbox receipt. A crash after acceptance and before durable receipt storage can produce an ambiguous retry. Do not deliberately resend known successful events or erase receipts to clear errors. Any real test email requires explicit authorization and an agreed recipient.

Check the current [Apps Script quota documentation](https://developers.google.com/apps-script/guides/services/quotas) and [MailApp quota API](https://developers.google.com/apps-script/reference/mail/mail-app#getRemainingDailyQuota()) when operating the sender. Historical quota counts and cost calculations are not current guarantees. Previous SMTP credentials, if any, are an owner-managed account concern and are not read by MailApp.
