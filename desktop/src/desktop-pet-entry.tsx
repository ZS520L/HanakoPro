import { createRoot } from 'react-dom/client';
import { DesktopPetApp } from './react/desktop-pet/DesktopPetApp';

const el = document.getElementById('react-root');
if (el) {
  createRoot(el).render(<DesktopPetApp />);
}
