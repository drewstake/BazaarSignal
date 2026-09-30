export function isOwner(
  auth: { uid: string; token: { email_verified?: boolean } } | undefined,
  ownerUid: string,
) {
  return (
    !!ownerUid &&
    !!auth &&
    auth.uid === ownerUid &&
    auth.token.email_verified === true
  );
}
