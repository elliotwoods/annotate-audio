'use client';

import dynamic from 'next/dynamic';

// The editor is a browser-only single-page app (Web Audio, IndexedDB, workers, localStorage).
// Render it client-side only — no SSR — so module-level browser APIs never run on the server.
const App = dynamic(() => import('../src/App'), { ssr: false });

export default function Page() {
  return <App />;
}
