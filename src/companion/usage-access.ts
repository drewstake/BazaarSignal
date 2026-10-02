import type { User } from 'firebase/auth';
// Visibility hint only. The API independently verifies the signed token and owner.
export function ownerCandidate(user:User|null) {
  return user?.email==='drewstake3@gmail.com' && user.emailVerified && user.providerData.some(p=>p.providerId==='google.com');
}
