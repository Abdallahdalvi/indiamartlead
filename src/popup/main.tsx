import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/index.css';
import App from './App';

const container = document.getElementById('root');
if (!container) throw new Error('[LeadSync] Root element #root not found in popup.html');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
