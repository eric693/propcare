import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// 改版後舊分包檔已不存在：開著的分頁換頁時自動重新整理，載入新版
window.addEventListener('vite:preloadError', () => window.location.reload());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
