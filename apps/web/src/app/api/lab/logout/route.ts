import { redirectRelative } from '@/lib/http.ts';
import { LAB_COOKIE } from '@/lib/lab-auth.ts';

export const dynamic = 'force-dynamic';

export function POST() {
  const response = redirectRelative('/lab/login');
  response.cookies.delete(LAB_COOKIE);
  return response;
}
