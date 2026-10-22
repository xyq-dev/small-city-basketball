import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react';
import './overlay.css';
const Source = lazy(() => import('./OverlaySource').then((m) => ({ default: m.OverlaySource })));
/** Kept outside the lazy source: fragment is removed before auth, fetch or visual loading. */
export function OverlayEntry({ fetcher }: { fetcher?: typeof fetch }) {
  const token = useRef<{ value: string | null } | null>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const roots = [document.documentElement, document.body, document.getElementById('root')];
    roots.forEach((root) => root?.classList.add('overlay-source-mode'));
    if (!token.current) {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      token.current = { value: fragment.has('token') ? (fragment.get('token') ?? '') : null };
      if (fragment.has('token'))
        window.history.replaceState(
          window.history.state,
          '',
          window.location.pathname + window.location.search,
        );
    }
    setReady(true);
    return () => roots.forEach((root) => root?.classList.remove('overlay-source-mode'));
  }, []);
  let id = '';
  try {
    id = decodeURIComponent(window.location.pathname.split('/')[2] ?? '');
  } catch {
    /* invalid opaque URL stays unavailable */
  }
  return (
    <main className="overlay-source-page">
      <Suspense
        fallback={
          <span className="overlay-source-loading" role="status">
            正在读取包装数据…
          </span>
        }
      >
        {ready && (
          <Source key={id} overlayId={id} token={token.current?.value ?? null} fetcher={fetcher} />
        )}
      </Suspense>
    </main>
  );
}
