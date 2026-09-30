export function signInErrorMessage(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error
    ? error.code
    : null;
  switch (code) {
    case "auth/popup-closed-by-user":
      return "Google sign-in closed before it finished. Try again and keep the sign-in window open. If it keeps closing, open this page in Chrome, Edge, or Safari and sign in there.";
    case "auth/popup-blocked":
      return "Your browser blocked the Google sign-in window. Allow popups for this site and try again. If you’re using an in-app browser, open this page in Chrome, Edge, or Safari.";
    case "auth/cancelled-popup-request":
      return "Another Google sign-in is already open. Complete that sign-in or try again.";
    case "auth/network-request-failed":
      return "Google sign-in couldn’t connect. Check your internet connection and try again.";
    case "auth/unauthorized-domain":
    case "auth/operation-not-allowed":
      return "Google sign-in is not available on this site yet. Please try again later.";
    case "auth/web-storage-unsupported":
      return "Google sign-in needs browser storage. Allow cookies and site storage, then try again.";
    default:
      return "Google sign-in couldn’t finish. Please try again.";
  }
}
