import { json } from '../../lib/http';
import { requireAuth } from '../auth';
import { getCreditBalance } from '../../lib/credits';

const handleCreditsMe = requireAuth(async (_request, user) => {
  return json({ credits: getCreditBalance(user) });
}, { allowSuspended: true, allowPolicyPending: true });

export { handleCreditsMe };
