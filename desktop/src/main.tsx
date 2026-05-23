import { createRoot } from 'react-dom/client';
import App from './react/App';
import zhLocale from './locales/zh.json';

if (window.i18n && (!window.i18n._data || Object.keys(window.i18n._data).length === 0)) {
  window.i18n._data = zhLocale as Record<string, unknown>;
  window.i18n.locale = 'zh';
}

const el = document.getElementById('react-root');
if (el) {
  createRoot(el).render(<App />);
}
