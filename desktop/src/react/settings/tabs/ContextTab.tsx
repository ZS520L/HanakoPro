import { useState, useEffect, useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../store';
import { t, autoSaveConfig, formatContext } from '../helpers';
import { Toggle } from '../widgets/Toggle';
import { ModelWidget } from '../widgets/ModelWidget';
import { SettingsSection } from '../components/SettingsSection';
import { SettingsRow } from '../components/SettingsRow';
import { NumberInput } from '../components/NumberInput';
import { COMPRESSION_MODES, BUILTIN_MODE_PROMPTS, DEFAULT_CONTEXT_COMPRESSION } from '../../../../../shared/context-compression.js';
import styles from '../Settings.module.css';

type ContextConfig = typeof DEFAULT_CONTEXT_COMPRESSION;
type ModelRef = { id: string; provider: string };

function SliderRow({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <SettingsRow
      label={label}
      hint={hint}
      control={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 220 }}>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={{ minWidth: 42, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {format(value)}
          </span>
        </div>
      }
    />
  );
}

export function ContextTab() {
  const { settingsConfig } = useSettingsStore(
    useShallow((s) => ({ settingsConfig: s.settingsConfig })),
  );

  // 从 agent config 派生当前值
  const saved: ContextConfig = useMemo(() => {
    const raw = settingsConfig?.context;
    const merged = { ...DEFAULT_CONTEXT_COMPRESSION, ...raw, protect: { ...DEFAULT_CONTEXT_COMPRESSION.protect, ...raw?.protect } };
    if (merged.compressionModel === 'utility') merged.compressionModel = 'custom';
    if (!merged.compressionCustomModel?.id || !merged.compressionCustomModel?.provider) {
      merged.compressionCustomModel = null;
    }
    return merged;
  }, [settingsConfig]);

  // 本地 draft 状态
  const [enabled, setEnabled] = useState(saved.enabled);
  const [threshold, setThreshold] = useState(saved.threshold);
  const [recentTurns, setRecentTurns] = useState(saved.recentTurnsProtected);
  const [mode, setMode] = useState(saved.mode);
  const [customPrompt, setCustomPrompt] = useState(saved.customPrompt);
  const [compressionModel, setCompressionModel] = useState(saved.compressionModel);
  const [compressionCustomModel, setCompressionCustomModel] = useState<ModelRef | null>(saved.compressionCustomModel);
  const [protectSystem, setProtectSystem] = useState(saved.protect.systemPrompt);
  const [protectToolResults, setProtectToolResults] = useState(saved.protect.recentToolResults);

  // 当远端 config 变化时同步（如 agent 切换）
  useEffect(() => {
    setEnabled(saved.enabled);
    setThreshold(saved.threshold);
    setRecentTurns(saved.recentTurnsProtected);
    setMode(saved.mode);
    setCustomPrompt(saved.customPrompt);
    setCompressionModel(saved.compressionModel);
    setCompressionCustomModel(saved.compressionCustomModel);
    setProtectSystem(saved.protect.systemPrompt);
    setProtectToolResults(saved.protect.recentToolResults);
  }, [saved]);

  const save = useCallback(
    (patch: Partial<ContextConfig>) => {
      const next: ContextConfig = {
        enabled,
        threshold,
        recentTurnsProtected: recentTurns,
        mode,
        customPrompt,
        compressionModel,
        compressionCustomModel,
        protect: {
          systemPrompt: protectSystem,
          pinnedMemory: true,
          recentToolResults: protectToolResults,
        },
        ...patch,
      };
      autoSaveConfig({ context: next });
    },
    [enabled, threshold, recentTurns, mode, customPrompt, compressionModel, compressionCustomModel, protectSystem, protectToolResults],
  );

  const modelOptions = useMemo(
    () => [
      { value: 'custom', label: t('settings.context.modelCustom') },
      { value: 'chat', label: t('settings.context.modelChat') },
    ],
    [],
  );

  return (
    <div className={`${styles['settings-tab-content']} ${styles['active']}`} data-tab="context">

      {/* ── 上下文压缩 ── */}
      <SettingsSection title={t('settings.context.compression')}>
        <SettingsRow
          label={t('settings.context.enableCompression')}
          hint={t('settings.context.enableCompressionHint')}
          control={
            <Toggle
              on={enabled}
              onChange={(v) => {
                setEnabled(v);
                save({ enabled: v });
              }}
            />
          }
        />

        <SliderRow
          label={t('settings.context.threshold')}
          hint={t('settings.context.thresholdHint')}
          value={threshold}
          min={0.5}
          max={0.9}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          disabled={!enabled}
          onChange={(v) => {
            setThreshold(v);
            save({ threshold: v });
          }}
        />

        <SettingsRow
          label={t('settings.context.recentTurns')}
          hint={t('settings.context.recentTurnsHint')}
          control={
            <NumberInput
              value={recentTurns}
              min={1}
              max={30}
              step={1}
              disabled={!enabled}
              onChange={(v) => {
                setRecentTurns(v);
                save({ recentTurnsProtected: v });
              }}
            />
          }
        />

        <SettingsRow
          label={t('settings.context.compressionModel')}
          hint={t('settings.context.compressionModelHint')}
          control={
            <div style={{ display: 'flex', gap: 8 }}>
              {modelOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`${styles['settings-pill-btn']}${compressionModel === opt.value ? ` ${styles['settings-pill-btn-active']}` : ''}`}
                  disabled={!enabled}
                  onClick={() => {
                    setCompressionModel(opt.value);
                    save({ compressionModel: opt.value });
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          }
        />
        {compressionModel === 'custom' && (
          <SettingsRow
            label={t('settings.context.customModel')}
            hint={t('settings.context.customModelHint')}
            control={
              <div className={styles['context-custom-model-control']}>
                <ModelWidget
                  value={compressionCustomModel}
                  onSelect={(ref) => {
                    setCompressionCustomModel(ref);
                    save({ compressionModel: 'custom', compressionCustomModel: ref });
                  }}
                  placeholder={t('settings.context.customModelPlaceholder')}
                  formatContext={formatContext}
                />
              </div>
            }
          />
        )}
      </SettingsSection>

      {/* ── 压缩模式 ── */}
      <SettingsSection title={t('settings.context.modeTitle')}>
        <div className={styles['context-mode-grid']}>
          {COMPRESSION_MODES.map((m: { id: string; nameKey: string; descKey: string }) => (
            <label
              key={m.id}
              className={`${styles['context-mode-card']}${mode === m.id ? ` ${styles['context-mode-card-active']}` : ''}${!enabled ? ` ${styles['context-mode-card-disabled']}` : ''}`}
            >
              <input
                type="radio"
                name="context-mode"
                value={m.id}
                checked={mode === m.id}
                disabled={!enabled}
                onChange={() => {
                  setMode(m.id);
                  save({ mode: m.id });
                }}
                style={{ display: 'none' }}
              />
              <span className={styles['context-mode-card-name']}>{t(m.nameKey)}</span>
              <span className={styles['context-mode-card-desc']}>{t(m.descKey)}</span>
            </label>
          ))}
        </div>

        {/* 提示词预览区：内置模式只读，自定义模式可编辑 */}
        {mode === 'custom' ? (
          <div className={styles['settings-form-field']} style={{ marginTop: 12 }}>
            <label className={styles['settings-form-label']}>{t('settings.context.customPromptLabel')}</label>
            <textarea
              className={styles['settings-textarea']}
              rows={10}
              spellCheck={false}
              disabled={!enabled}
              value={customPrompt}
              placeholder={t('settings.context.customPromptPlaceholder')}
              onChange={(e) => setCustomPrompt(e.target.value)}
              onBlur={() => save({ customPrompt })}
            />
            <span className={styles['settings-form-hint']}>{t('settings.context.customPromptHint')}</span>
          </div>
        ) : (
          (BUILTIN_MODE_PROMPTS as Record<string, string>)[mode] && (
            <div className={styles['settings-form-field']} style={{ marginTop: 12 }}>
              <label className={styles['settings-form-label']}>{t('settings.context.modePromptPreview')}</label>
              <textarea
                className={`${styles['settings-textarea']} ${styles['settings-textarea-readonly']}`}
                rows={10}
                spellCheck={false}
                readOnly
                value={(BUILTIN_MODE_PROMPTS as Record<string, string>)[mode]}
              />
            </div>
          )
        )}
      </SettingsSection>

      {/* ── 保护设置 ── */}
      <SettingsSection title={t('settings.context.protectTitle')}>
        <SettingsRow
          label={t('settings.context.protectSystem')}
          hint={t('settings.context.protectSystemHint')}
          control={
            <Toggle
              on={protectSystem}
              disabled={!enabled}
              onChange={(v) => {
                setProtectSystem(v);
                save({ protect: { systemPrompt: v, pinnedMemory: true, recentToolResults: protectToolResults } });
              }}
            />
          }
        />
        <SettingsRow
          label={t('settings.context.protectToolResults')}
          hint={t('settings.context.protectToolResultsHint')}
          control={
            <Toggle
              on={protectToolResults}
              disabled={!enabled}
              onChange={(v) => {
                setProtectToolResults(v);
                save({ protect: { systemPrompt: protectSystem, pinnedMemory: true, recentToolResults: v } });
              }}
            />
          }
        />
      </SettingsSection>

    </div>
  );
}
