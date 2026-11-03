import { supabase } from '../lib/supabase';

let pending = 0;
function notify(detail: { pending: number; error?: string }) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('api-request-state', { detail }));
}

export class HttpError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

/** Shared boundary for HTTP status, malformed responses, session refresh and request feedback. */
export async function request(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const api = url.startsWith('/api/');
  const publicRequest = /^\/api\/(?:health$|auth\/(?:login|superadmin-login)$|public\/|landing-cms\/published$)/.test(url) ||
    ((!init.method || init.method === 'GET') && ['/api/barangays', '/api/legal-documents', '/api/landing-config', '/api/landing/settings'].includes(url));
  if (api) notify({ pending: ++pending });
  try {
    const headers = new Headers(init.headers);
    for (const key of [...headers.keys()]) if (key.startsWith('x-user-')) headers.delete(key);
    if (api && !publicRequest && supabase) {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw new Error('Unable to refresh your session. Please sign in again.');
      if (data.session) headers.set('Authorization', `Bearer ${data.session.access_token}`);
    }
    const signal = AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(60000)]);
    const response = await fetch(input, { ...init, headers, signal });
    if (!response.ok) {
      const data: unknown = await response.clone().json().catch(() => null);
      const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : `Request failed (HTTP ${response.status}).`;
      throw new HttpError(message, response.status);
    }
    if (api && response.status !== 204) {
      const data: unknown = await response.clone().json().catch(() => null);
      if (!data || typeof data !== 'object') throw new Error('The server returned an invalid response. Please reload and try again.');
      if ('success' in data && data.success === false) throw new Error('error' in data && typeof data.error === 'string' ? data.error : 'The request could not be completed.');
    }
    return response;
  } catch (error) {
    if (api && !(error instanceof DOMException && error.name === 'AbortError')) notify({ pending, error: error instanceof Error ? error.message : 'Unable to reach the server.' });
    throw error;
  } finally {
    if (api) notify({ pending: --pending });
  }
}
