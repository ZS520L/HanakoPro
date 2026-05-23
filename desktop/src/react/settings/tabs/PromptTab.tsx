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
  DEFAULT_PROMPT_BLOCK_ORDER,
  SYSTEM_GENERATED_PROMPT_BLOCK_IDS,
  composePromptFromBlocks,
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

type PromptRuntimeInjections = {
  workspace: boolean;
  currentTime: boolean;
  memory: boolean;
  appendSystemPrompt: boolean;
  skills: boolean;
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
  runtimeInjections: PromptRuntimeInjections;
  routes: PromptRoute[];
  toolOverrides: ToolOverride[];
};

type PromptSourceBlock = {
  id: string;
  label?: string;
  title?: string;
  content: string;
};

type ToolSource = {
  name: string;
  label: string;
  description: string;
  parameters: Array<{ path: string; description: string }>;
};

type PromptComposerSource = {
  promptBlocks: PromptSourceBlock[];
  tools: ToolSource[];
};

type SystemPromptPreview = {
  markdown: string;
  content: string;
  cwd?: string;
  model?: { id?: string; provider?: string; name?: string } | null;
};


const RUNTIME_INJECTION_ROWS: Array<{
  key: keyof PromptRuntimeInjections;
  label: string;
  hint: string;
}> = [
  {
    key: 'workspace',
    label: '动态工作空间',
    hint: '控制主 system.content 中的 Workspace，以及 SDK 末尾的 Current working directory；会话级工作区范围由“会话级追加规则”控制。',
  },
  {
    key: 'currentTime',
    label: '动态时间',
    hint: '控制主 system.content 中的 Current date and time / 日期边界说明，以及 SDK 末尾的 Current date。',
  },
  {
    key: 'memory',
    label: '记忆上下文',
    hint: '控制记忆使用规则、置顶记忆和长期记忆注入。关闭后不会把已编译记忆写入 system.content；不等于清空记忆。',
  },
  {
    key: 'appendSystemPrompt',
    label: '会话级追加规则',
    hint: '控制后台任务规则、工作区范围、模型 provider 追加规则等 SessionCoordinator 追加段。',
  },
  {
    key: 'skills',
    label: 'Skills 可用列表',
    hint: '控制 <available_skills> 注入。关闭后模型不会在系统提示词中看到 skill 列表。',
  },
];

const SYSTEM_GENERATED_PROMPT_BLOCK_ID_SET = new Set(SYSTEM_GENERATED_PROMPT_BLOCK_IDS);
const SIMPLE_PROMPT_TEMPLATES = BUILTIN_SIMPLE_PROMPT_TEMPLATES as BuiltinSimplePromptTemplate[];

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeDraft(value: unknown): PromptComposerConfig {
  return normalizePromptComposerConfig(value) as PromptComposerConfig;
}

function hasOwn(value: object | undefined, key: string) {
  return !!value && Object.prototype.hasOwnProperty.call(value, key);
}

function isDefaultRoute(id: string) {
  return id === 'default';
}

function isSystemGeneratedPromptBlock(id: string) {
  return SYSTEM_GENERATED_PROMPT_BLOCK_ID_SET.has(id);
}

function getPromptBlockHint(id: string) {
  if (id === 'memory-rules') {
    return '这是记忆使用规则，属于可编辑的 system.content。实际置顶记忆和长期记忆内容会在后面的只读变量块中由系统注入。';
  }
  if (id === 'pinned-memory') {
    return '这是置顶记忆变量，来源于用户主动保存的置顶记忆，只读展示；保存配置不会覆盖它。';
  }
  if (id === 'memory') {
    return '这是长期记忆变量，来源于记忆编译结果，只读展示；后台记忆更新后新建会话会使用新的快照。';
  }
  if (id === 'workspace') {
    return '这是当前工作空间变量，来源于会话 cwd，只读展示；切换工作目录或新建会话时会自动刷新。';
  }
  if (id === 'current-time') {
    return '这是当前时间变量，由系统按时间和时区运行时生成，只读展示；新建会话时会自动刷新。';
  }
  if (isSystemGeneratedPromptBlock(id)) {
    return '这是系统运行时生成的 system.content 片段，只读展示；保存配置不会覆盖它，新建会话时会自动刷新。';
  }
  return '这是当前项目实际拆分出的 system.content 片段。保存并新建会话后生效。';
}

export function PromptTab() {
  const { settingsConfig, agentId } = useSettingsStore(
    useShallow(s => ({ settingsConfig: s.settingsConfig, agentId: s.getSettingsAgentId() }))
  );
  const showToast = useSettingsStore(s => s.showToast);
  const [draft, setDraft] = useState<PromptComposerConfig>(() => normalizeDraft(settingsConfig?.promptComposer));
  const [source, setSource] = useState<PromptComposerSource>({ promptBlocks: [], tools: [] });
  const [sourceLoading, setSourceLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<SystemPromptPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);

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
          promptBlocks: Array.isArray(data.promptBlocks) ? data.promptBlocks : [],
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

  const activeRoute = useMemo(
    () => draft.routes.find(route => route.id === draft.activeRouteId) || draft.routes[0],
    [draft.activeRouteId, draft.routes]
  );
  const previewHtml = useMemo(
    () => preview?.markdown ? renderMarkdownPreview(preview.markdown) : '',
    [preview?.markdown]
  );
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

  const setRuntimeInjection = (key: keyof PromptRuntimeInjections, enabled: boolean) => {
    const nextDraft = normalizeDraft({
      ...draft,
      runtimeInjections: {
        ...draft.runtimeInjections,
        [key]: enabled,
      },
    });
    setDraft(nextDraft);
    void saveDraft(nextDraft);
  };

  const buildSimpleContentFromBlocks = (baseDraft: PromptComposerConfig = draft) => {
    const builtInBlocks = source.promptBlocks.map(block => ({ id: block.id, content: block.content }));
    const runtimeBlockIds = new Set(['workspace', 'memory-rules', 'pinned-memory', 'memory', 'current-time']);
    const content = composePromptFromBlocks({
      config: {
        ...baseDraft,
        enabled: true,
        mode: 'blocks',
        runtimeInjections: {
          ...baseDraft.runtimeInjections,
          workspace: false,
          currentTime: false,
          memory: false,
        },
      },
      builtInBlocks,
    });
    return content || builtInBlocks
      .filter(block => !runtimeBlockIds.has(block.id))
      .map(block => block.content)
      .filter(content => content.trim())
      .join('\n\n');
  };

  const setSimpleMode = (simple: boolean) => {
    const nextDraft = normalizeDraft({
      ...draft,
      enabled: simple ? true : draft.enabled,
      mode: simple ? 'simple' : 'blocks',
      simpleContent: simple && !draft.simpleContent.trim()
        ? buildSimpleContentFromBlocks(draft)
        : draft.simpleContent,
    });
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
    const nextPreset = { id, name, content: baseContent || buildSimpleContentFromBlocks(draft) };
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

  const addBlock = () => {
    const id = createId('custom');
    updateDraft({
      blocks: [
        ...draft.blocks,
        { id, title: '新的提示词模块', content: '## 新的提示词模块\n\n在这里写入提示词内容。', enabled: true },
      ],
    }, { enableComposer: true });
  };

  const updateBlock = (id: string, patch: Partial<PromptBlock>) => {
    updateDraft({ blocks: draft.blocks.map(block => block.id === id ? { ...block, ...patch } : block) }, { enableComposer: true });
  };

  const deleteBlock = (id: string) => {
    updateDraft({
      blocks: draft.blocks.filter(block => block.id !== id),
      routes: draft.routes.map(route => ({ ...route, blockIds: route.blockIds.filter(blockId => blockId !== id) })),
    }, { enableComposer: true });
  };

  const getGlobalBlockOverride = (id: string) => draft.blockOverrides.find(block => block.id === id);
  const getRouteBlockOverride = (id: string) => activeRoute?.blockOverrides?.find(block => block.id === id);
  const getBlockOverride = (id: string) => {
    const routeOverride = getRouteBlockOverride(id);
    if (routeOverride) return routeOverride;
    return activeRoute && !isDefaultRoute(activeRoute.id) ? undefined : getGlobalBlockOverride(id);
  };

  const updateRouteBlockOverride = (routeId: string, id: string, content: string) => {
    updateDraft({
      routes: draft.routes.map(route => {
        if (route.id !== routeId) return route;
        const blockOverrides = route.blockOverrides || [];
        const existing = blockOverrides.find(block => block.id === id);
        return {
          ...route,
          blockOverrides: existing
            ? blockOverrides.map(block => block.id === id ? { ...block, content } : block)
            : [...blockOverrides, { id, content, enabled: true }],
        };
      }),
    }, { enableComposer: true });
  };

  const updateBlockOverride = (id: string, content: string) => {
    if (activeRoute && !isDefaultRoute(activeRoute.id)) {
      updateRouteBlockOverride(activeRoute.id, id, content);
      return;
    }
    const existing = getGlobalBlockOverride(id);
    updateDraft({
      blockOverrides: existing
        ? draft.blockOverrides.map(block => block.id === id ? { ...block, content } : block)
        : [...draft.blockOverrides, { id, content, enabled: true }],
    }, { enableComposer: true });
  };

  const resetBlockOverride = (id: string) => {
    if (activeRoute && !isDefaultRoute(activeRoute.id)) {
      updateDraft({
        routes: draft.routes.map(route => route.id === activeRoute.id
          ? { ...route, blockOverrides: (route.blockOverrides || []).filter(block => block.id !== id) }
          : route),
      });
      return;
    }
    updateDraft({ blockOverrides: draft.blockOverrides.filter(block => block.id !== id) });
  };

  const addRoute = () => {
    const id = createId('route');
    const usedNames = new Set(draft.routes.map(route => route.name));
    let index = draft.routes.length + 1;
    let name = `新的组合路线 ${index}`;
    while (usedNames.has(name)) {
      index += 1;
      name = `新的组合路线 ${index}`;
    }
    updateDraft({
      activeRouteId: id,
      routes: [
        ...draft.routes,
        { id, name, blockIds: [...DEFAULT_PROMPT_BLOCK_ORDER] },
      ],
    }, { enableComposer: true });
  };

  const updateRoute = (id: string, patch: Partial<PromptRoute>) => {
    updateDraft({ routes: draft.routes.map(route => route.id === id ? { ...route, ...patch } : route) }, { enableComposer: true });
  };

  const deleteRoute = (id: string) => {
    if (isDefaultRoute(id)) {
      showToast('默认路线不能删除', 'error');
      return;
    }
    const routes = draft.routes.filter(route => route.id !== id);
    if (!routes.length) {
      showToast('至少保留一条组合路线', 'error');
      return;
    }
    updateDraft({ routes, activeRouteId: draft.activeRouteId === id ? routes[0].id : draft.activeRouteId }, { enableComposer: true });
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
          hint="简化模式只编辑一份完整 system.content；高级模式可按模块精细编辑。保存后新会话生效，点击“完整预览”可查看实际发送给模型的系统提示词。"
          control={null}
        />
      </SettingsSection>

      <SettingsSection
        title="组合开关"
        context={<button type="button" className={styles['settings-save-btn-sm']} disabled={previewLoading} onClick={() => void openSystemPromptPreview()}>{previewLoading ? '生成预览中…' : '完整预览'}</button>}
      >
        <SettingsRow
          label="启用自定义 system.content"
          hint="关闭时完全使用 OpenHanako 默认 system.content；开启后使用下方选择的简化模式或高级分块模式生成 system.content。工具描述覆盖不受这个开关影响。"
          control={<Toggle on={draft.enabled} onChange={setComposerEnabled} />}
        />
        <SettingsRow
          label="简化编辑模式"
          hint="开启后只编辑一个完整 system.content 大文本框；关闭后回到高级分块/路线编辑。运行时注入开关仍然独立生效。"
          control={<Toggle on={draft.mode === 'simple'} onChange={setSimpleMode} />}
        />
        {draft.mode !== 'simple' && (
          <>
          <SettingsRow
          label="当前路线"
          control={
            <div className={styles['prompt-editor-header']}>
              <select
                className={styles['settings-input']}
                value={draft.activeRouteId}
                onChange={(event) => updateDraft({ activeRouteId: event.target.value }, { enableComposer: true })}
              >
                {draft.routes.map(route => <option key={route.id} value={route.id}>{route.name}</option>)}
              </select>
              <button type="button" className={styles['settings-save-btn-sm']} onClick={addRoute}>新建路线</button>
              <button
                type="button"
                className={styles['prompt-danger-btn']}
                onClick={() => {
                  if (activeRoute) deleteRoute(activeRoute.id);
                }}
                disabled={!activeRoute || draft.routes.length <= 1 || isDefaultRoute(activeRoute.id)}
              >
                删除当前
              </button>
            </div>
          }
        />
        <SettingsRow
          label="路线名称"
          hint="这里修改的是当前选中的路线名称，底部保存后写入配置。"
          control={
            <input
              className={styles['settings-input']}
              value={activeRoute?.name || ''}
              onChange={(event) => {
                if (activeRoute) updateRoute(activeRoute.id, { name: event.target.value });
              }}
              disabled={!activeRoute}
            />
          }
        />
          </>
        )}
        {previewError && <div className={styles['prompt-preview-error']}>{previewError}</div>}
      </SettingsSection>

      <SettingsSection title="运行时注入">
        <SettingsSection.Note>这些内容由系统在新会话创建或请求发送前动态加入。关闭后会从完整预览和新会话系统提示词中移除。</SettingsSection.Note>
        {RUNTIME_INJECTION_ROWS.map(row => (
          <SettingsRow
            key={row.key}
            label={row.label}
            hint={row.hint}
            control={<Toggle on={draft.runtimeInjections[row.key] !== false} onChange={(enabled) => setRuntimeInjection(row.key, enabled)} />}
          />
        ))}
      </SettingsSection>

      {draft.mode === 'simple' ? (
        <SettingsSection title="简化 system.content">
          <SettingsSection.Note>下面内容会作为主 system.content。Skills、时间、工作空间、记忆和会话追加规则仍由“运行时注入”开关单独控制。</SettingsSection.Note>
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
            <span className={styles['settings-form-hint']}>
              支持变量：{'{{userName}}'}、{'{{agentName}}'}、{'{{agentId}}'}、{'{{cwd}}'}、{'{{currentDateTime}}'}。
              {activeBuiltinSimpleTemplate ? '内置模板只读，可复制为自定义模板后编辑。' : '自动保存后新建会话生效。'}
              {saving ? ' 正在保存…' : ''}
            </span>
          </div>
        </SettingsSection>
      ) : (
        <>
      <SettingsSection title="内置 system.content 模块">
        {sourceLoading && <span className={styles['settings-form-hint']}>正在加载当前实际拆分内容…</span>}
        <div className={styles['prompt-editor-list']}>
          {source.promptBlocks.map(block => {
            const override = getBlockOverride(block.id);
            const value = override ? override.content : block.content;
            const readOnly = isSystemGeneratedPromptBlock(block.id);
            return (
              <div className={styles['prompt-editor-card']} key={block.id}>
                <div className={styles['prompt-editor-header']}>
                  <strong>{block.id}</strong>
                  {readOnly ? (
                    <span className={`${styles['prompt-readonly-badge']} ${styles['prompt-header-action']}`}>系统生成</span>
                  ) : (
                    <button type="button" className={`${styles['settings-save-btn-sm']} ${styles['prompt-header-action']}`} onClick={() => resetBlockOverride(block.id)} disabled={!override}>恢复默认</button>
                  )}
                </div>
                <textarea
                  className={`${styles['settings-textarea']} ${styles['prompt-textarea']} ${readOnly ? styles['prompt-readonly-textarea'] : ''}`}
                  value={value}
                  onChange={(event) => {
                    if (!readOnly) updateBlockOverride(block.id, event.target.value);
                  }}
                  readOnly={readOnly}
                  spellCheck={false}
                />
                <span className={styles['settings-form-hint']}>{getPromptBlockHint(block.id)}</span>
              </div>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection
        title="自定义 system.content 模块"
        context={<button type="button" className={styles['settings-save-btn-sm']} onClick={addBlock}>新建模块</button>}
      >
        {draft.blocks.length === 0 ? (
          <div className={styles['prompt-hint-card']}>还没有自定义模块。你可以先新建模块，再把模块 ID 加入某条组合路线。</div>
        ) : (
          <div className={styles['prompt-editor-list']}>
            {draft.blocks.map(block => (
              <div className={styles['prompt-editor-card']} key={block.id}>
                <div className={styles['prompt-editor-header']}>
                  <input
                    className={styles['settings-input']}
                    value={block.title}
                    onChange={(event) => updateBlock(block.id, { title: event.target.value })}
                  />
                  <Toggle on={block.enabled !== false} onChange={(enabled) => updateBlock(block.id, { enabled })} />
                  <button type="button" className={styles['prompt-danger-btn']} onClick={() => deleteBlock(block.id)}>删除</button>
                </div>
                <textarea
                  className={`${styles['settings-textarea']} ${styles['prompt-textarea']}`}
                  value={block.content}
                  onChange={(event) => updateBlock(block.id, { content: event.target.value })}
                  spellCheck={false}
                />
                <span className={styles['settings-form-hint']}>支持变量：{'{{userName}}'}、{'{{agentName}}'}、{'{{agentId}}'}、{'{{cwd}}'}、{'{{currentDateTime}}'}。</span>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
        </>
      )}

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
              <button type="button" className={styles['prompt-preview-close']} onClick={() => setPreview(null)}>✕</button>
            </div>
            <div className={styles['prompt-preview-body']}>
              <div
                className={`preview-markdown ${styles['prompt-preview-markdown']}`}
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          </div>
        </div>,
        document.body,
      )}

    </div>
  );
}
