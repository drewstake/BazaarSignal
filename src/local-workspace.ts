/** A local Firestore workspace using the existing Google sign-in identity.
 * Production builds always ignore this flag. */
export const localWorkspace =
  import.meta.env.DEV && import.meta.env.VITE_LOCAL_WORKSPACE === "true";
