import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../store';
import { autoSaveConfig } from '../helpers';
import { hanaFetch } from '../api';
import { SettingsSection } from '../components/SettingsSection';
import { SettingsRow } from '../components/SettingsRow';
import { Toggle } from '../widgets/Toggle';
import { renderMarkdownPreview } from '../../utils/markdown';
import styles from '../Settings.module.css';
import {
  BUILTIN_SIMPLE_PROMPT_TEMPLATES,
  normalizePromptComposerConfig,
} from '../../../../../shared/prompt-composer.js';

type PromptBlock = {
  id: string;
  title: string;
  content: string;
  enabled?: boolean;
};

type PromptBlockOverride = {
  id: string;
  content: string;
  enabled?: boolean;
};

type PromptRoute = {
  id: string;
  name: string;
  blockIds: string[];
  blockOverrides?: PromptBlockOverride[];
};

type ToolParameterOverride = {
  path: string;
  description: string;
};

type ToolOverride = {
  name: string;
  description?: string;
  parameters: ToolParameterOverride[];
};

type PromptSimplePreset = {
  id: string;
  name: string;
  content: string;
};

type BuiltinSimplePromptTemplate = {
  id: string;
  name: string;
  description: string;
  content: string;
};

type PromptComposerConfig = {
  enabled: boolean;
  mode: 'blocks' | 'simple';
  activeRouteId: string;
  activeSimplePresetId: string;
  simpleContent: string;
  simplePresets: PromptSimplePreset[];
  blockOverrides: PromptBlockOverride[];
  blocks: PromptBlock[];
  routes: PromptRoute[];
  toolOverrides: ToolOverride[];
};

type ToolSource = {
  name: string;
  label: string;
  description: string;
  parameters: Array<{ path: string; description: string }>;
};

type PromptComposerSource = {
  tools: ToolSource[];
};

type SystemPromptPreview = {
  markdown: string;
  content: string;
  cwd?: string;
  model?: { id?: string; provider?: string; name?: string } | null;
};


const SIMPLE_PROMPT_TEMPLATES = BUILTIN_SIMPLE_PROMPT_TEMPLATES as BuiltinSimplePromptTemplate[];
const PROMPT_VARIABLES = [
  '{{userName}}',
  '{{agentName}}',
  '{{agentId}}',
  '{{cwd}}',
  '{{workspace}}',
  '{{currentDate}}',
  '{{currentDateTime}}',
  '{{userProfile}}',
  '{{personality}}',
  '{{pinnedMemory}}',
  '{{memory}}',
  '{{skills}}',
  '{{appendSystemPrompt}}',
  '{{mood}}',
];
const PROMPT_VARIABLE_COPY_TEXT = PROMPT_VARIABLES.join('\n');
const PROMPT_VARIABLE_HINT = `支持变量：${PROMPT_VARIABLES.join('、')}。`;

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeDraft(value: unknown): PromptComposerConfig {
  const normalized = normalizePromptComposerConfig(value) as PromptComposerConfig;
  return { ...normalized, mode: 'simple' };
}

function hasOwn(value: object | undefined, key: string) {
  return !!value && Object.prototype.hasOwnProperty.call(value, key);
}

export function PromptTab() {
  const { settingsConfig, agentId } = useSettingsStore(
    useShallow(s => ({ settingsConfig: s.settingsConfig, agentId: s.getSettingsAgentId() }))
  );
  const showToast = useSettingsStore(s => s.showToast);
  const [draft, setDraft] = useState<PromptComposerConfig>(() => normalizeDraft(settingsConfig?.promptComposer));
  const [source, setSource] = useState<PromptComposerSource>({ tools: [] });
  const [sourceLoading, setSourceLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<SystemPromptPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRawMode, setPreviewRawMode] = useState(false);
  const autosaveTimerRef = useRef<number | null>(null);

  const copyPromptVariables = async () => {
    try {
      await navigator.clipboard.writeText(PROMPT_VARIABLE_COPY_TEXT);
      showToast('已复制变量列表', 'success');
    } catch (err: any) {
      showToast(`复制失败: ${err?.message || err}`, 'error');
    }
  };

  const renderVariableHint = (suffix?: string) => (
    <div className={styles['prompt-variable-hint-row']}>
      <span className={`${styles['settings-form-hint']} ${styles['prompt-variable-hint-text']}`}>
        {PROMPT_VARIABLE_HINT}
        {suffix}
        {saving ? ' 正在保存…' : ''}
      </span>
      <button type="button" className={styles['prompt-variable-copy-btn']} onClick={copyPromptVariables}>复制</button>
    </div>
  );

  useEffect(() => {
    setDraft(normalizeDraft(settingsConfig?.promptComposer));
  }, [settingsConfig?.promptComposer]);

  useEffect(() => () => {
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
  }, []);

  useEffect(() => {
    if (!agentId) return;
    const ac = new AbortController();
    setSourceLoading(true);
    hanaFetch(`/api/agents/${agentId}/prompt-composer-source`, { signal: ac.signal })
      .then(res => res.json())
      .then(data => {
        if (ac.signal.aborted) return;
        if (data.error) throw new Error(data.error);
        setSource({
          tools: Array.isArray(data.tools) ? data.tools : [],
        });
      })
      .catch((err) => {
        if (!ac.signal.aborted) showToast(`加载提示词源失败: ${err.message}`, 'error');
      })
      .finally(() => {
        if (!ac.signal.aborted) setSourceLoading(false);
      });
    return () => ac.abort();
  }, [agentId, showToast]);

  const previewHtml = useMemo(
    () => preview?.markdown ? renderMarkdownPreview(preview.markdown) : '',
    [preview?.markdown]
  );
  const previewRawText = preview?.content || preview?.markdown || '';
  const activeBuiltinSimpleTemplate = useMemo(
    () => SIMPLE_PROMPT_TEMPLATES.find(template => template.id === draft.activeSimplePresetId) || null,
    [draft.activeSimplePresetId]
  );
  const activeCustomSimplePreset = useMemo(
    () => draft.simplePresets.find(preset => preset.id === draft.activeSimplePresetId) || null,
    [draft.activeSimplePresetId, draft.simplePresets]
  );
  const activeSimplePresetDescription = activeBuiltinSimpleTemplate?.description
    || (activeCustomSimplePreset ? '自定义模板，可直接编辑并自动保存。' : '');

  const updateDraft = (patch: Partial<PromptComposerConfig>, options: { enableComposer?: boolean; autosave?: boolean } = {}) => {
    const nextDraft = normalizeDraft({ ...draft, ...patch, ...(options.enableComposer ? { enabled: true } : {}) });
    setDraft(nextDraft);
    if (options.autosave !== false) {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = window.setTimeout(() => {
        void saveDraft(nextDraft, { silent: true });
      }, 600);
    }
  };

  const saveDraft = async (nextDraft: PromptComposerConfig = draft, options: { silent?: boolean } = {}) => {
    setSaving(true);
    try {
      await autoSaveConfig({ promptComposer: nextDraft }, options);
    } finally {
      setSaving(false);
    }
  };

  const setComposerEnabled = (enabled: boolean) => {
    const nextDraft = normalizeDraft({ ...draft, enabled });
    setDraft(nextDraft);
    void saveDraft(nextDraft);
  };

  const updateSimpleContent = (content: string) => {
    if (!activeCustomSimplePreset) {
      updateDraft({ simpleContent: content, mode: 'simple' }, { enableComposer: true });
      return;
    }
    updateDraft({
      activeSimplePresetId: activeCustomSimplePreset.id,
      simpleContent: content,
      simplePresets: draft.simplePresets.map(preset => preset.id === activeCustomSimplePreset.id ? { ...preset, content } : preset),
      mode: 'simple',
    }, { enableComposer: true });
  };

  const selectSimplePreset = (id: string) => {
    const builtin = SIMPLE_PROMPT_TEMPLATES.find(template => template.id === id);
    const custom = draft.simplePresets.find(preset => preset.id === id);
    const content = builtin?.content || custom?.content || draft.simpleContent;
    const nextDraft = normalizeDraft({
      ...draft,
      enabled: true,
      mode: 'simple',
      activeSimplePresetId: id,
      simpleContent: content,
    });
    setDraft(nextDraft);
    void saveDraft(nextDraft);
  };

  const createSimplePreset = (baseContent = draft.simpleContent, baseName = '自定义模板') => {
    const id = createId('template');
    const usedNames = new Set(draft.simplePresets.map(preset => preset.name));
    let index = draft.simplePresets.length + 1;
    let name = baseName === '自定义模板' ? `自定义模板 ${index}` : baseName;
    while (usedNames.has(name)) {
      index += 1;
      name = `${baseName} ${index}`;
    }
    const nextPreset = { id, name, content: baseContent || '# 角色\n\n在这里写入你的 system.content 模板。' };
    const nextDraft = normalizeDraft({
      ...draft,
      enabled: true,
      mode: 'simple',
      activeSimplePresetId: id,
      simpleContent: nextPreset.content,
      simplePresets: [...draft.simplePresets, nextPreset],
    });
    setDraft(nextDraft);
    void saveDraft(nextDraft);
  };

  const duplicateActiveSimplePreset = () => {
    const name = activeBuiltinSimpleTemplate
      ? `${activeBuiltinSimpleTemplate.name} 副本`
      : activeCustomSimplePreset
        ? `${activeCustomSimplePreset.name} 副本`
        : '自定义模板';
    createSimplePreset(draft.simpleContent, name);
  };

  const updateSimplePresetName = (name: string) => {
    if (!activeCustomSimplePreset) return;
    updateDraft({
      simplePresets: draft.simplePresets.map(preset => preset.id === activeCustomSimplePreset.id ? { ...preset, name } : preset),
    }, { enableComposer: true });
  };

  const deleteActiveSimplePreset = () => {
    if (!activeCustomSimplePreset) {
      showToast('内置模板不能删除，可以先复制为自定义模板再编辑', 'error');
      return;
    }
    const simplePresets = draft.simplePresets.filter(preset => preset.id !== activeCustomSimplePreset.id);
    const fallback = simplePresets[0] || SIMPLE_PROMPT_TEMPLATES[0];
    const nextDraft = normalizeDraft({
      ...draft,
      activeSimplePresetId: fallback.id,
      simpleContent: fallback.content,
      simplePresets,
    });
    setDraft(nextDraft);
    void saveDraft(nextDraft);
  };

  const openSystemPromptPreview = async () => {
    if (!agentId) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await hanaFetch(`/api/agents/${agentId}/system-prompt-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promptComposer: draft,
          cwd: typeof settingsConfig?.last_cwd === 'string' ? settingsConfig.last_cwd : undefined,
          memoryEnabled: settingsConfig?.memory?.enabled !== false,
        }),
        timeout: 60_000,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPreviewRawMode(false);
      setPreview({
        markdown: typeof data.markdown === 'string' ? data.markdown : '',
        content: typeof data.content === 'string' ? data.content : '',
        cwd: typeof data.cwd === 'string' ? data.cwd : undefined,
        model: data.model || null,
      });
    } catch (err: any) {
      setPreviewError(err?.message || '加载完整预览失败');
    } finally {
      setPreviewLoading(false);
    }
  };

  const getToolOverride = (name: string) => draft.toolOverrides.find(tool => tool.name === name);

  const setAndSaveDraft = (nextDraft: PromptComposerConfig) => {
    const normalized = normalizeDraft(nextDraft);
    setDraft(normalized);
    void saveDraft(normalized);
  };

  const updateToolOverride = (name: string, patch: Partial<ToolOverride>) => {
    const existing = getToolOverride(name);
    setAndSaveDraft({
      ...draft,
      toolOverrides: existing
        ? draft.toolOverrides.map(tool => tool.name === name ? { ...tool, ...patch } : tool)
        : [...draft.toolOverrides, { name, parameters: [], ...patch }],
    });
  };

  const updateToolDescription = (name: string, description: string) => {
    updateToolOverride(name, { description });
  };

  const updateToolParameter = (name: string, path: string, description: string) => {
    const existing = getToolOverride(name);
    const parameters = existing?.parameters || [];
    const nextParameters = parameters.some(param => param.path === path)
      ? parameters.map(param => param.path === path ? { ...param, description } : param)
      : [...parameters, { path, description }];
    updateToolOverride(name, { parameters: nextParameters });
  };

  const resetToolDescription = (name: string) => {
    const existing = getToolOverride(name);
    if (!existing) return;
    const { description: _description, ...rest } = existing;
    if (rest.parameters.length === 0) {
      setAndSaveDraft({ ...draft, toolOverrides: draft.toolOverrides.filter(tool => tool.name !== name) });
      return;
    }
    updateToolOverride(name, rest);
  };

  const resetToolParameter = (name: string, path: string) => {
    const existing = getToolOverride(name);
    if (!existing) return;
    const parameters = existing.parameters.filter(param => param.path !== path);
    if (!hasOwn(existing, 'description') && parameters.length === 0) {
      setAndSaveDraft({ ...draft, toolOverrides: draft.toolOverrides.filter(tool => tool.name !== name) });
      return;
    }
    updateToolOverride(name, { parameters });
  };

  return (
    <div className={`${styles['settings-tab-content']} ${styles['active']}`} data-tab="prompt">
      <SettingsSection title="Agent 性能调优入口">
        <SettingsRow
          label="调整 system.content 和 tools 描述"
          hint="直接编辑一份完整 system.content 模板。保存后新会话生效，点击“完整预览”可查看实际发送给模型的系统提示词。"
          control={null}
        />
      </SettingsSection>

      <SettingsSection
        title="system.content"
        context={<button type="button" className={styles['settings-save-btn-sm']} disabled={previewLoading} onClick={() => void openSystemPromptPreview()}>{previewLoading ? '生成预览中…' : '完整预览'}</button>}
      >
        <SettingsRow
          label="启用自定义 system.content"
          hint="关闭时完全使用 OpenHanako 默认 system.content；开启后使用下方模板生成 system.content。工具描述覆盖不受这个开关影响。"
          control={<Toggle on={draft.enabled} onChange={setComposerEnabled} />}
        />
        {previewError && <div className={styles['prompt-preview-error']}>{previewError}</div>}
      </SettingsSection>

      <SettingsSection title="system.content 模板">
        <SettingsSection.Note>下面内容会作为完整 system.content。Skills、时间、工作空间、记忆、MOOD 和会话追加规则都通过变量插入；不写变量就不会注入。</SettingsSection.Note>
        <div className={styles['prompt-simple-card']}>
          <div className={styles['prompt-template-toolbar']}>
            <div className={styles['prompt-template-picker']}>
              <label className={styles['settings-form-hint']}>当前模板</label>
              <select
                className={styles['settings-input']}
                value={draft.activeSimplePresetId}
                onChange={(event) => selectSimplePreset(event.target.value)}
              >
                <optgroup label="内置模板">
                  {SIMPLE_PROMPT_TEMPLATES.map(template => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </optgroup>
                {draft.simplePresets.length > 0 && (
                  <optgroup label="自定义模板">
                    {draft.simplePresets.map(preset => (
                      <option key={preset.id} value={preset.id}>{preset.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div className={styles['prompt-template-actions']}>
              <button type="button" className={styles['settings-save-btn-sm']} onClick={() => createSimplePreset('# 角色\n\n在这里写入你的 system.content 模板。', '自定义模板')}>新建模板</button>
              <button type="button" className={styles['settings-save-btn-sm']} onClick={duplicateActiveSimplePreset}>复制当前</button>
              <button type="button" className={styles['prompt-danger-btn']} onClick={deleteActiveSimplePreset} disabled={!activeCustomSimplePreset}>删除自定义</button>
            </div>
          </div>
          {activeCustomSimplePreset && (
            <div className={styles['prompt-template-name-row']}>
              <label className={styles['settings-form-hint']}>模板名称</label>
              <input
                className={styles['settings-input']}
                value={activeCustomSimplePreset.name}
                onChange={(event) => updateSimplePresetName(event.target.value)}
              />
            </div>
          )}
          {activeSimplePresetDescription && (
            <div className={styles['prompt-template-description']}>{activeSimplePresetDescription}</div>
          )}
          <textarea
            className={`${styles['settings-textarea']} ${styles['prompt-textarea']} ${activeBuiltinSimpleTemplate ? styles['prompt-readonly-textarea'] : ''}`}
            value={draft.simpleContent}
            onChange={(event) => updateSimpleContent(event.target.value)}
            readOnly={!!activeBuiltinSimpleTemplate}
            spellCheck={false}
          />
          {renderVariableHint(activeBuiltinSimpleTemplate ? '内置模板只读，可复制为自定义模板后编辑。' : '自动保存后新建会话生效。')}
        </div>
      </SettingsSection>

      <SettingsSection title="工具描述覆盖">
        {sourceLoading && <span className={styles['settings-form-hint']}>正在加载当前工具 schema…</span>}
        <SettingsSection.Note>覆盖 tools 数组里每个工具的 description，以及 parameters.properties 中的 description。保存后新建会话生效。</SettingsSection.Note>
        <div className={styles['prompt-editor-list']}>
          {source.tools.map(tool => {
            const override = getToolOverride(tool.name);
            const toolDescription = override && hasOwn(override, 'description') ? (override.description || '') : tool.description;
            return (
              <details className={styles['prompt-editor-card']} key={tool.name}>
                <summary className={styles['prompt-editor-header']}>
                  <strong>{tool.name}</strong>
                  <button type="button" className={`${styles['settings-save-btn-sm']} ${styles['prompt-header-action']}`} onClick={(event) => {
                    event.preventDefault();
                    resetToolDescription(tool.name);
                  }} disabled={!override || !hasOwn(override, 'description')}>恢复工具描述</button>
                </summary>
                <textarea
                  className={`${styles['settings-textarea']} ${styles['prompt-route-textarea']}`}
                  value={toolDescription}
                  onChange={(event) => updateToolDescription(tool.name, event.target.value)}
                  spellCheck={false}
                />
                {tool.parameters.map(param => {
                  const paramOverride = override?.parameters.find(item => item.path === param.path);
                  const paramDescription = paramOverride ? paramOverride.description : param.description;
                  return (
                    <div className={styles['prompt-editor-card']} key={param.path}>
                      <div className={styles['prompt-editor-header']}>
                        <code className={styles['prompt-id']}>{param.path}</code>
                        <button type="button" className={`${styles['settings-save-btn-sm']} ${styles['prompt-header-action']}`} onClick={() => resetToolParameter(tool.name, param.path)} disabled={!paramOverride}>恢复参数描述</button>
                      </div>
                      <textarea
                        className={`${styles['settings-textarea']} ${styles['prompt-route-textarea']}`}
                        value={paramDescription}
                        onChange={(event) => updateToolParameter(tool.name, param.path, event.target.value)}
                        spellCheck={false}
                      />
                    </div>
                  );
                })}
              </details>
            );
          })}
        </div>
      </SettingsSection>

      {preview && createPortal(
        <div
          className={styles['prompt-preview-backdrop']}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreview(null);
          }}
        >
          <div className={styles['prompt-preview-dialog']} role="dialog" aria-modal="true" aria-label="系统提示词完整预览">
            <div className={styles['prompt-preview-header']}>
              <div>
                <h3>系统提示词完整预览</h3>
              </div>
              <div className={styles['prompt-preview-actions']}>
                <button
                  type="button"
                  className={`${styles['prompt-preview-mode-toggle']} ${previewRawMode ? styles['prompt-preview-mode-toggle-active'] : ''}`}
                  onClick={() => setPreviewRawMode(value => !value)}
                >
                  {previewRawMode ? 'Markdown 预览' : '原文'}
                </button>
                <button type="button" className={styles['prompt-preview-close']} onClick={() => setPreview(null)}>✕</button>
              </div>
            </div>
            <div className={styles['prompt-preview-body']}>
              {previewRawMode ? (
                <pre className={styles['prompt-preview-raw']}>{previewRawText}</pre>
              ) : (
                <div
                  className={`preview-markdown ${styles['prompt-preview-markdown']}`}
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

    </div>
  );
}
