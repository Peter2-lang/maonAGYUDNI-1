import { useEffect, useState } from 'react';

export function RequestFeedback() {
  const [pending, setPending] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ pending: number; error?: string }>).detail;
      setPending(detail.pending);
      if (detail.error) setError(detail.error);
    };
    window.addEventListener('api-request-state', listener);
    return () => window.removeEventListener('api-request-state', listener);
  }, []);
  return <div className="fixed bottom-4 left-4 z-[9999] max-w-sm space-y-2">
    {pending > 0 && <p role="status" className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow">Loading…</p>}
    {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 shadow">
      <p>{error}</p><button type="button" onClick={() => setError('')} className="mt-2 font-semibold underline">Dismiss</button>
    </div>}
  </div>;
}
