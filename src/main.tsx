import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

const Admin = lazy(() => import('./pages/Admin').then(module => ({ default: module.Admin })));
const Overlay = lazy(() => import('./pages/Overlay').then(module => ({ default: module.Overlay })));
const TestCenter = lazy(() => import('./pages/TestCenter').then(module => ({ default: module.TestCenter })));
const Catchphrases = lazy(() => import('./pages/Catchphrases').then(module => ({ default: module.Catchphrases })));
const path = window.location.pathname;
const app = /^\/admin\/teste/.test(path) ? <TestCenter />
  : path.startsWith('/admin/bordoes') ? <Catchphrases />
  : path.startsWith('/admin') ? <Admin mode="admin" />
  : path.startsWith('/monitor') ? <Admin mode="monitor" />
  : <Overlay />;

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Suspense fallback={<main className="loading-screen"><div className="loader" /><p>Preparando a arena…</p></main>}>{app}</Suspense></React.StrictMode>);
