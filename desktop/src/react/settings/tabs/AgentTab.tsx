import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../store';
import { hanaFetch } from '../api';
import { t, autoSaveConfig } from '../helpers';
import { SelectWidget } from '@/ui';
import { browseAgent, switchToAgent, loadSettingsConfig, loadAgents } from '../actions';
import { AgentCardStack } from './agent/AgentCardStack';
import { YuanSelector } from './agent/YuanSelector';
import { MemorySection } from './agent/AgentMemory';
import { AgentToolsSection } from './agent/AgentToolsSection';
import { CharacterCardPreviewOverlay, type CharacterCardPlan } from '../overlays/CharacterCardPreviewOverlay';
import { SettingsSection } from '../components/SettingsSection';
import { SettingsRow } from '../components/SettingsRow';
import { Toggle } from '../widgets/Toggle';
import styles from '../Settings.module.css';
import {
  type ExpCategory, parseExperience,
  ExperienceBlock, putExperience,
} from './agent/AgentExperience';

export function AgentTab() {
  const {
    agents, currentAgentId, settingsAgentId, settingsConfig, currentPins,
    globalModelsConfig,
  } = useSettingsStore(
    useShallow(s => ({
      agents: s.agents,
      currentAgentId: s.currentAgentId,
      settingsAgentId: s.settingsAgentId,
      settingsConfig: s.settingsConfig,
      currentPins: s.currentPins,
      globalModelsConfig: s.globalModelsConfig,
    }))
  );
  const showToast = useSettingsStore(s => s.showToast);
  const set = useSettingsStore(s => s.set);
  const getSettingsAgentId = useSettingsStore(s => s.getSettingsAgentId);

  const hasUtilityModel = !!(globalModelsConfig?.models?.utility && globalModelsConfig?.models?.utility_large);
  const selectedSettingsAgentId = settingsAgentId || currentAgentId;

  const [agentName, setAgentName] = useState('');
  const [identity, setIdentity] = useState('');
  const [ishiki, setIshiki] = useState('');
  const [expCategories, setExpCategories] = useState<ExpCategory[]>([]);
  const [exportPlanningAgentId, setExportPlanningAgentId] = useState<string | null>(null);
  const [exportingCharacterCard, setExportingCharacterCard] = useState(false);
  const [exportPlan, setExportPlan] = useState<CharacterCardPlan | null>(null);
  const [exportMemory, setExportMemory] = useState(false);

  useEffect(() => {
    if (settingsConfig) {
      setAgentName(settingsConfig.agent?.name || '');
      setIdentity(settingsConfig._identity || '');
      setIshiki(settingsConfig._ishiki || '');
      setExpCategories(parseExperience(settingsConfig._experience || ''));
    }
  }, [settingsConfig]);

  const isViewingOther = selectedSettingsAgentId !== currentAgentId;
  const currentYuan = settingsConfig?.agent?.yuan || 'hanako';

  // 用 "provider/id" 复合键作为 SelectWidget 的 value，区分多 provider 下同名模型。
  // 展示层可仍用 id/name；value/onChange payload 必须带 provider。
  const chatRaw = settingsConfig?.models?.chat;
  const currentModel = (() => {
    if (!chatRaw) return '';
    if (typeof chatRaw === 'object' && chatRaw?.id && chatRaw?.provider) {
      return `${chatRaw.provider}/${chatRaw.id}`;
    }
    // 半成品对象或裸字符串：migration #5 之后不应出现，这里仅作渡期兜底展示
    if (typeof chatRaw === 'object' && chatRaw?.id) return chatRaw.id;
    if (typeof chatRaw === 'string') return chatRaw;
    return '';
  })();

  // 从唯一信源 /api/models 获取模型列表（和聊天页一致）
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string; provider: string }>>([]);
  useEffect(() => {
    hanaFetch('/api/models').then(r => r.json()).then(data => {
      setAvailableModels(data.models || []);
    }).catch(() => {});
  }, [settingsConfig]); // settingsConfig 变化时刷新

  const modelOptions = useMemo(() => {
    const opts = availableModels.map(m => ({
      value: `${m.provider}/${m.id}`,
      label: m.name || m.id,
      group: m.provider,
    }));
    if (currentModel && !opts.some(o => o.value === currentModel)) {
      opts.unshift({ value: currentModel, label: t('settings.agent.modelUnavailable', { model: currentModel }), group: '' });
    }
    return opts;
  }, [availableModels, currentModel]);
  const currentModelUnavailable = !!currentModel && !availableModels.some(m => `${m.provider}/${m.id}` === currentModel);

  const memoryEnabled = settingsConfig?.memory?.enabled !== false;
  const experienceEnabled = settingsConfig?.experience?.enabled === true;
  const hasAvailableToolsField = !!settingsConfig && Object.prototype.hasOwnProperty.call(settingsConfig, 'availableTools');
  const availableTools = hasAvailableToolsField ? settingsConfig?.availableTools : undefined;

  const saveAgent = async () => {
    try {
      const agentId = getSettingsAgentId()!;
      const agentBase = `/api/agents/${agentId}`;
      const isActive = agentId === currentAgentId;

      const configPartial: Record<string, unknown> = {};
      if (agentName && agentName !== (settingsConfig?.agent?.name || '')) {
        configPartial.agent = { name: agentName };
      }

      const identityChanged = identity !== (settingsConfig?._identity || '');
      const ishikiChanged = ishiki !== (settingsConfig?._ishiki || '');

      if (!Object.keys(configPartial).length && !identityChanged && !ishikiChanged) {
        showToast(t('settings.noChanges'), 'success');
        return;
      }

      const requests: Promise<Response>[] = [];
      if (Object.keys(configPartial).length) {
        requests.push(hanaFetch(`${agentBase}/config`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(configPartial),
        }));
      }
      if (identityChanged) {
        requests.push(hanaFetch(`${agentBase}/identity`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: identity }),
        }));
      }
      if (ishikiChanged) {
        requests.push(hanaFetch(`${agentBase}/ishiki`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: ishiki }),
        }));
      }

      const results = await Promise.all(requests);
      for (const res of results) {
        const data = await res.json();
        if (data.error) throw new Error(data.error);
      }

      showToast(t('settings.saved'), 'success');
      if (isActive && (configPartial as { agent?: { name: string } })?.agent?.name) {
        set({ agentName: (configPartial as { agent: { name: string } }).agent.name });
      }
      await loadSettingsConfig();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(t('settings.saveFailed') + ': ' + msg, 'error');
    }
  };

  const openAgentExportPreview = async (agentId: string) => {
    if (exportPlanningAgentId || exportingCharacterCard) return;
    setExportPlanningAgentId(agentId);
    try {
      const res = await hanaFetch('/api/character-cards/export/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
        timeout: 90_000,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setExportPlan(data.plan);
      setExportMemory(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(t('settings.saveFailed') + ': ' + msg, 'error');
    } finally {
      setExportPlanningAgentId(null);
    }
  };

  const confirmAgentExport = async () => {
    if (!exportPlan?.agentId || exportingCharacterCard) return;
    setExportingCharacterCard(true);
    try {
      const res = await hanaFetch('/api/character-cards/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: exportPlan.agentId,
          exportMemory: exportMemory && exportPlan.memory.available,
        }),
        timeout: 90_000,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setExportPlan(null);
      setExportMemory(false);
      if (typeof data.filePath === 'string' && data.filePath) {
        window.platform?.showInFinder?.(data.filePath);
      }
      showToast(`已导出到 ${data.filePath}`, 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(t('settings.saveFailed') + ': ' + msg, 'error');
    } finally {
      setExportingCharacterCard(false);
    }
  };

  return (
    <div className={`${styles['settings-tab-content']} ${styles['active']}`} data-tab="agent">
      {/* Agent 卡片堆叠 */}
      <section className={styles['settings-section']}>
        <h2 className={styles['settings-section-title']}>{t('settings.agent.title')}</h2>
        <AgentCardStack
          agents={agents}
          selectedId={selectedSettingsAgentId}
          currentAgentId={currentAgentId}
          onSelect={(id) => browseAgent(id)}
          onAvatarClick={() => {
            // eslint-disable-next-line no-restricted-syntax -- ephemeral file picker, not part of React tree
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/png,image/jpeg,image/webp';
            input.addEventListener('change', () => {
              if (input.files?.[0]) {
                window.dispatchEvent(new CustomEvent('hana-open-cropper', {
                  detail: { role: 'agent', file: input.files[0] },
                }));
              }
            });
            input.click();
          }}
          onSetActive={(id) => switchToAgent(id)}
          onDelete={(id) => window.dispatchEvent(new CustomEvent('hana-show-agent-delete', {
            detail: { agentId: id },
          }))}
          onExport={openAgentExportPreview}
          onAdd={() => window.dispatchEvent(new Event('hana-show-agent-create'))}
          exportingAgentId={exportPlanningAgentId}
        />

        <div className={`${styles['settings-form-field']} ${styles['settings-form-field-center']}`}>
          <input
            className={styles['agent-name-input']}
            type="text"
            value={agentName}
            placeholder={t('settings.agent.agentNameHint')}
            onChange={(e) => setAgentName(e.target.value)}
          />
        </div>
        <div className={`${styles['settings-form-field']} ${styles['settings-form-field-center']}`}>
          <div className={styles['model-capsule']}>
            <span className={styles['model-capsule-label']}>{t('settings.agent.chatModel')}</span>
            <SelectWidget
              className={styles['model-capsule-select']}
              triggerClassName={styles['model-capsule-trigger']}
              options={modelOptions}
              value={currentModel}
              onChange={async (refKey) => {
                // refKey 是 SelectWidget 传回的 value，格式 "provider/id"
                const slashIdx = refKey.indexOf('/');
                if (slashIdx <= 0 || slashIdx === refKey.length - 1) {
                  // 兜底：没有 / 的字符串是残留的老数据，此路径不应触发
                  console.warn('[AgentTab] 模型 value 缺少 provider 前缀，已忽略', refKey);
                  return;
                }
                const provider = refKey.slice(0, slashIdx);
                const id = refKey.slice(slashIdx + 1);
                await autoSaveConfig({ models: { chat: { id, provider } } });
              }}
              placeholder={t('settings.api.selectModel')}
            />
          </div>
          <span className={styles['settings-form-hint']}>{t('settings.agent.chatModelHint')}</span>
          {currentModelUnavailable && (
            <span className={styles['settings-form-hint']}>{t('settings.agent.modelUnavailableHint')}</span>
          )}
        </div>
        {/* 图片模型选择器暂时隐藏，后续重新设计 */}
      </section>

      {/* 关于 Ta（保持原样，不改） */}
      <section className={styles['settings-section']}>
        <h2 className={styles['settings-section-title']}>{t('settings.about.title')}</h2>
        <div className={`${styles['settings-form-field']} ${styles['settings-form-field-center']}`}>
          <span className={styles['settings-form-hint']}>{t('settings.agent.yuanHint')}</span>
          <YuanSelector
            currentYuan={currentYuan}
            onChange={async (key) => {
              const agentId = getSettingsAgentId()!;
              try {
                await hanaFetch(`/api/agents/${agentId}/config`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ agent: { yuan: key } }),
                });
                if (agentId === currentAgentId) set({ agentYuan: key });
                await loadSettingsConfig();
                await loadAgents();
              } catch (err) {
                console.error('[yuan] switch failed:', err);
              }
            }}
          />
        </div>
        <div className={styles['settings-form-field']}>
          <label className={styles['settings-form-label']}>{t('settings.agent.identity')}</label>
          <textarea
            className={styles['settings-textarea']}
            rows={3}
            spellCheck={false}
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
          />
          <span className={styles['settings-form-hint']}>{t('settings.agent.identityHint')}</span>
        </div>
        <div className={styles['settings-form-field']}>
          <label className={styles['settings-form-label']}>{t('settings.agent.ishiki')}</label>
          <textarea
            className={styles['settings-textarea']}
            rows={10}
            spellCheck={false}
            value={ishiki}
            onChange={(e) => setIshiki(e.target.value)}
          />
          <span className={styles['settings-form-hint']}>{t('settings.agent.ishikiHint')}</span>
        </div>
        <div className={styles['settings-form-field']} style={{ display: 'flex', justifyContent: 'center' }}>
          <button className={styles['settings-save-btn-sm']} onClick={saveAgent}>
            {t('settings.save')}
          </button>
        </div>
      </section>

      {/* 以下是本 phase 需要改造的部分：Memory / Experience / Tools */}

      <MemorySection
        hasUtilityModel={hasUtilityModel}
        memoryEnabled={memoryEnabled}
        isViewingOther={isViewingOther}
        currentPins={currentPins}
      />

      {/* 经验 */}
      <SettingsSection title={t('settings.experience.title')}>
        <SettingsRow
          label={t('settings.experience.toggleLabel')}
          hint={t('settings.experience.toggleHint')}
          control={<Toggle
            on={experienceEnabled}
            onChange={async (on) => {
              const saved = await autoSaveConfig({ experience: { enabled: on } }, { silent: true });
              if (saved) await loadSettingsConfig();
            }}
          />}
        />
        <div style={{ padding: 'var(--space-sm) var(--space-md)' }}>
          {!experienceEnabled ? (
            <div className={styles['exp-empty']}>{t('settings.experience.paused')}</div>
          ) : expCategories.length === 0 ? (
            <div className={styles['exp-empty']}>{t('settings.experience.empty')}</div>
          ) : (
            <div className={styles['exp-list']}>
              {expCategories.map((cat) => (
                <ExperienceBlock
                  key={cat.name}
                  category={cat}
                  onSave={(updated) => {
                    const next = expCategories.map(c => c.name === cat.name ? updated : c);
                    setExpCategories(next);
                    putExperience({ getSettingsAgentId, showToast }, next);
                  }}
                  onDelete={() => {
                    const next = expCategories.filter(c => c.name !== cat.name);
                    setExpCategories(next);
                    putExperience({ getSettingsAgentId, showToast }, next);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </SettingsSection>

      {/* 默认关闭 update_settings 和 dm，与后端 DEFAULT_DISABLED_TOOL_NAMES 保持同步 */}
      <AgentToolsSection
        availableTools={availableTools}
        disabled={settingsConfig?.tools?.disabled ?? ["update_settings", "dm"]}
      />

      {exportPlanningAgentId && createPortal((
        <div className={styles['character-card-preview-overlay']} role="dialog" aria-modal="true">
          <div className={styles['character-card-loading-card']}>正在生成角色卡预览</div>
        </div>
      ), document.body)}
      {exportPlan && (
        <CharacterCardPreviewOverlay
          plan={exportPlan}
          mode="export"
          memoryChecked={exportMemory}
          processing={exportingCharacterCard}
          onMemoryChange={(checked) => {
            if (exportPlan.memory.available) setExportMemory(checked);
          }}
          onConfirm={confirmAgentExport}
          onCancel={() => {
            setExportPlan(null);
            setExportMemory(false);
          }}
        />
      )}

    </div>
  );
}
