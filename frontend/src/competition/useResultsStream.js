import { useEffect, useState } from 'react';
import { results } from '../api.js';

// Subscribes to /api/competitions/<slug>/results/stream via EventSource.
// Returns { state, error } — state is the redacted public payload.
export function useResultsStream(slug) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setState(null);
    setError(null);

    // Initial fetch in case SSE takes a moment.
    results.publicGet(slug).then((s) => { if (!cancelled) setState(s); }).catch(() => {});

    const es = new EventSource(results.streamUrl(slug), { withCredentials: true });
    es.addEventListener('state', (ev) => {
      if (cancelled) return;
      try { setState(JSON.parse(ev.data)); } catch { /* ignore */ }
    });
    es.onerror = () => {
      if (cancelled) return;
      // EventSource will auto-reconnect; surface a soft error so UI can show a "connecting…" hint.
      setError('connecting');
    };
    return () => { cancelled = true; es.close(); };
  }, [slug]);

  return { state, error };
}
