import { useState, useEffect, useCallback } from 'react';
import { t } from '../helpers';
import { Overlay } from '../../ui';

export function BridgeTutorial() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = () => setVisible(true);
    window.addEventListener('hana-show-bridge-tutorial', handler);
    return () => window.removeEventListener('hana-show-bridge-tutorial', handler);
  }, []);

  const close = useCallback(() => setVisible(false), []);

  const tgSteps: string[] = t('settings.bridge.tutorialTgSteps') || [];
  const fsSteps: string[] = t('settings.bridge.tutorialFsSteps') || [];

  return (
    <Overlay
      open={visible}
      onClose={close}
      backdrop="blur"
      zIndex={100}
      className="bridge-tutorial-panel"
      disableContainerAnimation
    >
        <div className="bridge-tutorial-header">
          <h3 className="bridge-tutorial-title">{t('settings.bridge.tutorialTitle')}</h3>
          <button className="bridge-tutorial-close" onClick={close}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="bridge-tutorial-body">
          <section className="bridge-tutorial-section">
            <h4 className="bridge-tutorial-section-title">Telegram</h4>
            <ol className="bridge-tutorial-steps">
              {Array.isArray(tgSteps) && tgSteps.map((step, i) => (
                <li key={`tg-step-${i}`} dangerouslySetInnerHTML={{ __html: step }} />
              ))}
            </ol>
          </section>
          <section className="bridge-tutorial-section">
            <h4 className="bridge-tutorial-section-title">{t('settings.bridge.feishu')}</h4>
            <ol className="bridge-tutorial-steps">
              {Array.isArray(fsSteps) && fsSteps.map((step, i) => (
                <li key={`fs-step-${i}`} dangerouslySetInnerHTML={{ __html: step }} />
              ))}
            </ol>
          </section>
        </div>
    </Overlay>
  );
}
