import React from 'react';
import { createRoot } from 'react-dom/client';
import './app/globals.css';
import './app/workspace-ui.css';
import './app/aws-roa.css';
import './app/roa-evidence-layout.css';

async function start() {
  const result = await fetch('/api/bootstrap', {cache:'no-store'});
  if (!result.ok) throw Error('資料尚未載入，請稍後重新整理。');
  (window as any).__NTPC_DATA__ = await result.json();
  const {DashboardClient} = await import('./app/dashboard-client');
  createRoot(document.getElementById('root')!).render(<DashboardClient />);
}
start().catch(error => { document.getElementById('root')!.textContent = error.message; });
