/** OnboardingApp.tsx — Orchestration layer (6 steps, each in ./steps/) */

import { useState, useEffect, useRef, useCallback } from 'react';
import { TOTAL_STEPS } from './constants';
import type { HanaFetch } from './onboarding-actions';
import { LocaleStep } from './steps/LocaleStep';
import { NameStep } from './steps/NameStep';
import { ProviderStep } from './steps/ProviderStep';
import { ModelStep } from './steps/ModelStep';
import { ThemeStep } from './steps/ThemeStep';
import { WorkspaceStep } from './steps/WorkspaceStep';
import { TutorialStep } from './steps/TutorialStep';
import {
  appendConnectionAuth,
  buildConnectionUrl,
  createLocalServerConnection,
  type ServerConnection,
} from '../services/server-connection';

interface OnboardingAppProps { preview: boolean; skipToTutorial: boolean }
export function OnboardingApp({ preview, skipToTutorial }: OnboardingAppProps) {
  const [serverConnection, setServerConnection] = useState<ServerConnection | null>(null);
  const [step, setStep] = useState(skipToTutorial ? 6 : 0);
  const [stepKey, setStepKey] = useState(0);
  const [agentName, setAgentName] = useState('Hanako');
  const [avatarSrc, setAvatarSrc] = useState('assets/Hanako.png');
  const [locale, setLocale] = useState('zh-CN');
  const [i18nReady, setI18nReady] = useState(false);

  // Provider info passed from ProviderStep to ModelStep
  const [providerName, setProviderName] = useState('');
  const [providerUrl, setProviderUrl] = useState('');
  const [providerApi, setProviderApi] = useState('openai-completions');
  const [apiKey, setApiKey] = useState('');

  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localeLoadSeq = useRef(0);

  const hanaFetch: HanaFetch = useCallback((path, opts = {}) => {
    if (!serverConnection) {
      throw new Error(`onboarding hanaFetch ${path}: server connection not ready`);
    }
    const headers = appendConnectionAuth(serverConnection, opts.headers);
    return fetch(buildConnectionUrl(serverConnection, path), { ...opts, headers });
  }, [serverConnection]);

  const showError = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 3000);
  }, []);

  const goToStep = useCallback((index: number) => {
    if (index < 0 || index >= TOTAL_STEPS) return;
    setStepKey(k => k + 1);
    setStep(index);
  }, []);

  const onLocaleChange = useCallback(async (loc: string) => {
    const seq = localeLoadSeq.current + 1;
    localeLoadSeq.current = seq;
    setLocale(loc);
    setI18nReady(false);
    try {
      await i18n.load(loc);
    } catch (err) {
      console.error('[onboarding] locale load failed:', err);
    } finally {
      if (localeLoadSeq.current === seq) {
        setI18nReady(true);
      }
    }
  }, []);

  const onProviderReady = useCallback((name: string, url: string, api: string, key: string) => {
    setProviderName(name);
    setProviderUrl(url);
    setProviderApi(api);
    setApiKey(key);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const port = await window.hana.getServerPort();
        const token = await window.hana.getServerToken();
        setServerConnection(createLocalServerConnection({ serverPort: port, serverToken: token }));
        const splashInfo = await window.hana.getSplashInfo?.();
        const loc = splashInfo?.locale || 'zh-CN';
        const name = splashInfo?.agentName || 'Hanako';
        setLocale(loc);
        setAgentName(name);
        await i18n.load(loc);
        i18n.defaultName = name;
        setI18nReady(true);
        try {
          const localPath = await window.hana.getAvatarPath?.('agent');
          if (localPath) setAvatarSrc(window.platform?.getFileUrl?.(localPath) ?? '');
        } catch { /* ignore */ }
      } catch (err) {
        console.error('[onboarding] init failed:', err);
      }
    })();
  }, []);

  if (!i18nReady) return null;

  return (
    <div className="onboarding">
      <div className="onboarding-progress">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div key={`dot-${i}`} className={`onboarding-dot${i === step ? ' active' : ''}${i < step ? ' done' : ''}`} />
        ))}
      </div>

      {step === 0 && <LocaleStep key={`step-0-${stepKey}`} preview={preview} hanaFetch={hanaFetch} avatarSrc={avatarSrc} initialLocale={locale} goToStep={goToStep} showError={showError} onLocaleChange={onLocaleChange} />}
      {step === 1 && <NameStep key={`step-1-${stepKey}`} preview={preview} hanaFetch={hanaFetch} goToStep={goToStep} showError={showError} />}
      {step === 2 && <ProviderStep key={`step-2-${stepKey}`} preview={preview} hanaFetch={hanaFetch} goToStep={goToStep} showError={showError} onProviderReady={onProviderReady} />}
      {step === 3 && <ModelStep key={`step-3-${stepKey}`} preview={preview} hanaFetch={hanaFetch} providerName={providerName} providerUrl={providerUrl} providerApi={providerApi} apiKey={apiKey} goToStep={goToStep} showError={showError} />}
      {step === 4 && <ThemeStep key={`step-4-${stepKey}`} goToStep={goToStep} />}
      {step === 5 && <WorkspaceStep key={`step-5-${stepKey}`} preview={preview} hanaFetch={hanaFetch} goToStep={goToStep} showError={showError} />}
      {step === 6 && <TutorialStep key={`step-6-${stepKey}`} preview={preview} showError={showError} />}

      {toastMsg && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: 'var(--coral, #c66)', color: '#fff', padding: '8px 20px', borderRadius: 8, fontSize: '0.82rem', zIndex: 999 }}>
          {toastMsg}
        </div>
      )}
    </div>
  );
}
