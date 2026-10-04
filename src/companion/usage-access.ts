import type { User } from 'firebase/auth';
import { USAGE_OWNER_EMAIL } from '../../shared/published-usage';
// Visibility hint only. The API independently verifies the signed token and owner.
export function ownerCandidate(user:User|null) {
  return user?.email===USAGE_OWNER_EMAIL && user.emailVerified && user.providerData.some(p=>p.providerId==='google.com');
}
