# Automatic portfolio price recovery — October 27, 2026

> Historical record. Dates, deployment versions, service status, costs and approvals below apply only to the recorded work. They are not current setup instructions or authorization to operate services. See the [documentation index](../README.md).


Published to Firebase Hosting at 09:43 Eastern (13:43 UTC), version
`df75d5a80c0d3ce1`. Previous version: `7aaf1f4d6f223ecd`.

The reported portfolio showed no price while the live price endpoint returned a
valid Summoning Eye book. Reloading restored its valuation. Investigation found
that visibility cancellation counted as a completed check, postponing a new read
until the next scheduled window. A timed-out initial request also left no useful
error because the portfolio ignored every aborted signal.

The shared scheduler now resumes unfinished visibility-cancelled reads when the
page returns, including a return before the cancellation promise settles.
Completed reads retain their normal schedule. Portfolio requests opt into retries
after failure or timeout: one, two, four, eight, then at most fifteen minutes
between attempts under the paid pilot. Successful reads restore scheduled polling.
The portfolio reports timeouts and passes failures back to the scheduler while
retaining any already displayed prices.

Server recovery deadlines and slower server policies take precedence. Hidden
pages do not request prices; unmount, explicit pauses, and expiry stop retries.
The release does not resume terminal budget pauses or change collection, mail,
backend services, holdings, the allowance, or the November 1 expiry.

Validation: 54 focused unit tests; eight signed-in browser checks across desktop
and mobile using isolated Firebase emulators and intercepted market responses.
Browser cases cover visibility cancellation, network failure, timeout, temporary
503 recovery, and the next scheduled update. TypeScript and the production build
pass. Tests do not contact the live collector or send email.

The release was staged from the retained, previously deployed source. Its baseline
build reproduced the archived files and matched the live website. Only
`src/companion/polling.ts` and `src/companion/Workspace.tsx` changed in the shipped
application; unrelated workspace changes were excluded. Published HTML, JavaScript,
and CSS were checked by SHA-256 against the staged build. The user's open portfolio
was reloaded once to load the new code.

Release source, manifests, Hosting receipts, and verification are retained in
`.local/portfolio-auto-recovery-oct27/`. Browser screenshots are in the staging
site's `.local/portfolio-auto-*.png` files. This is a Hosting-only change; the
previous Hosting version is retained for rollback.
