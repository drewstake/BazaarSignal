// Read-only deployment smoke check: no identity, portfolio IDs, targets or mail.
// Run after each Apps Script release; the editor's "Me" label is not proof of
// the identity used by the live endpoint.
const endpoint = process.argv[2];
if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint ?? "")) {
  console.error("Usage: node scripts/verify-notification-deployment.mjs <Apps Script /exec URL>");
  process.exitCode = 1;
} else {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        version: 1,
        origin: "https://bazaarsignal.web.app",
        action: "portfolio-notification",
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json();
    const passed = response.ok && result.ok === false &&
      result.error === "Sign in with the verified Google account.";
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      passed,
      httpStatus: response.status,
      error: result.error ?? null,
      checks: "Backend configuration, sender identity, origin and anonymous rejection only; no mail delivery test.",
    }, null, 2));
    if (!passed) process.exitCode = 1;
  } catch {
    console.error("Notification deployment check failed: no valid backend response.");
    process.exitCode = 1;
  }
}
