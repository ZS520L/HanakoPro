import { useState, useMemo } from 'react';
import { hanaUrl } from '../../hooks/use-hana-fetch';
import { usePluginIframe } from '../../hooks/use-plugin-iframe';
import { useStore } from '../../stores';
import type { PluginCardDetails } from '../../types';
import s from './PluginCardBlock.module.css';
import { DEFAULT_THEME } from '../../../shared/theme-registry';

interface Props {
  card: PluginCardDetails;
  agentId?: string | null;
}

const MAX_W = 400;
const MAX_H = 600;
const EMPTY_CAPABILITY_GRANTS: readonly string[] = [];

function parseRatio(raw?: string): number {
  if (!raw) return 0;
  const [w, h] = raw.split(':').map(Number);
  return (w && h) ? w / h : 0;
}

export function PluginCardBlock({ card, agentId }: Props) {
  const [error, setError] = useState(false);
  const capabilityGrants = useStore(st => st.pluginUiHostCapabilities[card.pluginId] ?? EMPTY_CAPABILITY_GRANTS);

  // Compute initial size from aspectRatio hint; 0 means unknown
  const ratio = parseRatio(card.aspectRatio);
  const defaultW = MAX_W;
  const defaultH = ratio > 0
    ? Math.min(Math.round(defaultW / ratio), MAX_H)
    : Math.round(defaultW * 0.75); // 4:3 fallback for old cards

  const isIframe = !card.type || card.type === 'iframe';

  const src = useMemo(() => {
    if (!isIframe) return '';
    const theme = document.documentElement.dataset.theme || DEFAULT_THEME;
    const cssUrl = hanaUrl(`/api/plugins/theme.css?theme=${encodeURIComponent(theme)}`);
    const base = hanaUrl(`/api/plugins/${card.pluginId}${card.route}`);
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}agentId=${encodeURIComponent(agentId || '')}&hana-theme=${encodeURIComponent(theme)}&hana-css=${encodeURIComponent(cssUrl)}`;
  }, [card.pluginId, card.route, isIframe, agentId]);
  const { iframeRef, status, size } = usePluginIframe(isIframe ? src : null, {
    pluginId: card.pluginId,
    agentId,
    slot: 'card',
    capabilityGrants,
    initialSize: { width: defaultW, height: defaultH },
    readyOnTimeout: true,
  });
  const ready = status === 'ready';

  if (!isIframe || error) {
    if (!card.description) return null;
    return (
      <div className={s.container}>
        {card.title && <div className={s.title}>{card.title}</div>}
        <div className={s.description}>{card.description}</div>
      </div>
    );
  }

  return (
    <div className={s.container}>
      <iframe
        ref={iframeRef}
        className={s.iframe}
        src={src}
        sandbox="allow-scripts allow-same-origin"
        style={{
          width: size.width ?? defaultW,
          height: size.height ?? defaultH,
          opacity: ready ? 1 : 0.3,
        }}
        onError={() => setError(true)}
      />
    </div>
  );
}
