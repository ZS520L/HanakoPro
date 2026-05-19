import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSettingsStore, type SkillInfo } from '../store';
import { hanaFetch } from '../api';
import { t } from '../helpers';
import { SkillBundleTree, type SkillBundleInfo } from './skills/SkillBundleTree';
import { SkillCapabilities } from './skills/SkillCapabilities';
import { CompatPathDrawer } from './skills/CompatPathDrawer';
import { LearnedSkillsBlock } from './skills/LearnedSkillsBlock';
import { AgentSelect } from './bridge/AgentSelect';
import { SettingsSection } from '../components/SettingsSection';
import styles from '../Settings.module.css';

const platform = window.platform;

type BundleDialogState =
  | { type: 'create'; name: string }
  | { type: 'rename'; bundle: SkillBundleInfo; name: string }
  | { type: 'delete'; bundle: SkillBundleInfo };

interface ExternalPathsData {
  configured: string[];
  discovered: { dirPath: string; label: string; exists: boolean }[];
}

export function SkillsTab() {
  const settingsConfig = useSettingsStore(s => s.settingsConfig);
  const showToast = useSettingsStore(s => s.showToast);
  const currentAgentId = useSettingsStore(s => s.currentAgentId);

  const [skillsViewAgentId, setSkillsViewAgentId] =
    useState<string | null>(currentAgentId);
  const skillsViewAgentIdRef = useRef(skillsViewAgentId);
  skillsViewAgentIdRef.current = skillsViewAgentId;

  const [skillsList, setSkillsList] = useState<SkillInfo[]>([]);
  const [skillBundles, setSkillBundles] = useState<SkillBundleInfo[]>([]);
  const [bundleDialog, setBundleDialog] = useState<BundleDialogState | null>(null);

  useEffect(() => {
    if (skillsViewAgentId) return;
    if (currentAgentId) setSkillsViewAgentId(currentAgentId);
  }, [currentAgentId]); // eslint-disable-line react-hooks/exhaustive-deps -- sticky selector only hydrates from currentAgentId while empty

  const [externalPathsData, setExternalPathsData] = useState<ExternalPathsData>({
    configured: [],
    discovered: [],
  });

  const loadSkills = useCallback(async () => {
    const agentId = skillsViewAgentIdRef.current;
    if (!agentId) return;
    try {
      const snapshotAgentId = agentId;
      const [skillsRes, bundlesRes] = await Promise.all([
        hanaFetch(`/api/skills?agentId=${encodeURIComponent(agentId)}`),
        hanaFetch(`/api/skills/bundles?agentId=${encodeURIComponent(agentId)}`),
      ]);
      const data = await skillsRes.json();
      const bundleData = await bundlesRes.json();
      if (data.error) throw new Error(data.error);
      if (bundleData.error) throw new Error(bundleData.error);
      if (skillsViewAgentIdRef.current !== snapshotAgentId) return;
      setSkillsList(data.skills || []);
      setSkillBundles(bundleData.bundles || []);
    } catch (err) {
      console.error('[skills] load failed:', err);
    }
  }, []);

  const loadExternalPaths = useCallback(async () => {
    try {
      const res = await hanaFetch('/api/skills/external-paths');
      const data = await res.json();
      setExternalPathsData({
        configured: data.configured || [],
        discovered: data.discovered || [],
      });
    } catch (err) {
      console.error('[skills] load external paths failed:', err);
    }
  }, []);

  useEffect(() => {
    loadSkills();
    loadExternalPaths();
  }, [loadSkills, loadExternalPaths, skillsViewAgentId]);

  const visible = skillsList.filter(s => !s.hidden);
  const userSkills = visible.filter(s => s.source !== 'learned' && s.source !== 'external');
  const learnedSkills = visible.filter(s => s.source === 'learned');
  const externalSkills = visible.filter(s => s.source === 'external');

  // 后台翻译技能名
  const [nameHints, setNameHints] = useState<Record<string, string>>({});
  useEffect(() => {
    const locale = window.i18n?.locale || 'zh';
    if (locale === 'en' || visible.length === 0) return;
    const agentId = skillsViewAgentIdRef.current;
    if (!agentId) return;
    const names = visible.map(s => s.name);
    if (names.length === 0) return;
    hanaFetch('/api/skills/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, names, lang: locale }),
    })
      .then(r => r.json())
      .then(map => { if (map && typeof map === 'object') setNameHints(prev => ({ ...prev, ...map })); })
      .catch(err => console.warn('[skills] translate failed:', err));
  }, [skillsList, skillsViewAgentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 全局安装：只注册 skill 到 engine.skillsDir，不自动对任何 agent 启用。
  // 原则：全局的管全局的。装完后用户到 Section 3 "Agent 配置" 自己打开开关。
  const installSkillFromPath = async (filePath: string) => {
    try {
      const res = await hanaFetch('/api/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showToast(t('settings.skills.installSuccess', { name: data.skill?.name || '' }), 'success');
      await loadSkills();
    } catch (err: unknown) {
      showToast(t('settings.skills.installError') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  };

  const installSkill = async () => {
    const selectedPath = await platform?.selectSkill?.();
    if (!selectedPath) return;
    await installSkillFromPath(selectedPath);
  };

  const deleteSkill = async (name: string) => {
    const agentId = skillsViewAgentIdRef.current;
    if (!agentId) {
      showToast(t('settings.saveFailed') + ': no agent selected', 'error');
      return;
    }
    const msg = t('settings.skills.deleteConfirm', { name });
    if (!confirm(msg)) return;
    try {
      const res = await hanaFetch(
        `/api/skills/${encodeURIComponent(name)}?agentId=${encodeURIComponent(agentId)}`,
        { method: 'DELETE' },
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showToast(t('settings.autoSaved'), 'success');
      await loadSkills();
    } catch (err: unknown) {
      showToast(t('settings.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  };

  const createBundle = () => {
    setBundleDialog({ type: 'create', name: 'New Bundle' });
  };

  const submitCreateBundle = async (name: string) => {
    const agentId = skillsViewAgentIdRef.current;
    if (!agentId) return;
    try {
      const res = await hanaFetch(`/api/skills/bundles?agentId=${encodeURIComponent(agentId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, skillNames: [] }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBundleDialog(null);
      showToast(t('settings.autoSaved'), 'success');
      await loadSkills();
    } catch (err: unknown) {
      showToast(t('settings.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  };

  const renameBundle = (bundle: SkillBundleInfo) => {
    setBundleDialog({ type: 'rename', bundle, name: bundle.name });
  };

  const submitRenameBundle = async (bundle: SkillBundleInfo, name: string) => {
    const agentId = skillsViewAgentIdRef.current;
    if (!agentId) return;
    if (!name || name === bundle.name) return;
    try {
      const res = await hanaFetch(`/api/skills/bundles/${encodeURIComponent(bundle.id)}?agentId=${encodeURIComponent(agentId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBundleDialog(null);
      showToast(t('settings.autoSaved'), 'success');
      await loadSkills();
    } catch (err: unknown) {
      showToast(t('settings.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  };

  const deleteBundle = (bundle: SkillBundleInfo) => {
    setBundleDialog({ type: 'delete', bundle });
  };

  const exportBundle = async (bundle: SkillBundleInfo) => {
    try {
      const res = await hanaFetch(`/api/skills/bundles/${encodeURIComponent(bundle.id)}/export`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const skipped = Array.isArray(data.warnings) ? data.warnings.length : 0;
      const suffix = skipped > 0 ? `，跳过 ${skipped} 个缺失 Skill` : '';
      showToast(`已导出 ${data.fileName || bundle.name}${suffix}`, 'success');
      if (data.filePath) {
        window.platform?.showInFinder?.(data.filePath);
      }
    } catch (err: unknown) {
      showToast(t('settings.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  };

  const submitDeleteBundle = async (bundle: SkillBundleInfo) => {
    try {
      const res = await hanaFetch(`/api/skills/bundles/${encodeURIComponent(bundle.id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBundleDialog(null);
      showToast(t('settings.autoSaved'), 'success');
      await loadSkills();
    } catch (err: unknown) {
      showToast(t('settings.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  };

  const updateBundleSkillNames = async (bundle: SkillBundleInfo, skillNames: string[]) => {
    const agentId = skillsViewAgentIdRef.current;
    if (!agentId) return;
    const res = await hanaFetch(`/api/skills/bundles/${encodeURIComponent(bundle.id)}?agentId=${encodeURIComponent(agentId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillNames }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
  };

  const reorderBundles = async (bundleIds: string[]) => {
    const agentId = skillsViewAgentIdRef.current;
    if (!agentId) return;
    try {
      const res = await hanaFetch(`/api/skills/bundles/order?agentId=${encodeURIComponent(agentId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundleIds }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSkillBundles(data.bundles || []);
      showToast(t('settings.autoSaved'), 'success');
      await loadSkills();
    } catch (err: unknown) {
      showToast(t('settings.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
      await loadSkills();
    }
  };

  const moveSkillToBundle = async (skillName: string, targetBundle: SkillBundleInfo, targetIndex?: number) => {
    try {
      const updates: Promise<void>[] = [];
      for (const bundle of skillBundles) {
        const hasSkill = bundle.skillNames.includes(skillName);
        const withoutSkill = bundle.skillNames.filter(name => name !== skillName);
        let nextSkillNames = withoutSkill;
        if (bundle.id === targetBundle.id) {
          const insertAt = typeof targetIndex === 'number'
            ? Math.max(0, Math.min(targetIndex, withoutSkill.length))
            : withoutSkill.length;
          nextSkillNames = [
            ...withoutSkill.slice(0, insertAt),
            skillName,
            ...withoutSkill.slice(insertAt),
          ];
        }
        if (hasSkill || bundle.id === targetBundle.id) {
          const changed = nextSkillNames.length !== bundle.skillNames.length
            || nextSkillNames.some((name, index) => name !== bundle.skillNames[index]);
          if (changed) updates.push(updateBundleSkillNames(bundle, nextSkillNames));
        }
      }
      await Promise.all(updates);
      showToast(t('settings.autoSaved'), 'success');
      await loadSkills();
    } catch (err: unknown) {
      showToast(t('settings.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  };

  const submitBundleDialog = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!bundleDialog) return;
    if (bundleDialog.type === 'delete') {
      await submitDeleteBundle(bundleDialog.bundle);
      return;
    }
    const name = bundleDialog.name.trim();
    if (!name) return;
    if (bundleDialog.type === 'create') {
      await submitCreateBundle(name);
      return;
    }
    await submitRenameBundle(bundleDialog.bundle, name);
  };

  const removeSkillFromBundles = async (skillName: string) => {
    try {
      const updates = skillBundles
        .filter(bundle => bundle.skillNames.includes(skillName))
        .map(bundle => updateBundleSkillNames(bundle, bundle.skillNames.filter(name => name !== skillName)));
      await Promise.all(updates);
      showToast(t('settings.autoSaved'), 'success');
      await loadSkills();
    } catch (err: unknown) {
      showToast(t('settings.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  };

  const toggleSkill = async (name: string, enable: boolean) => {
    const agentId = skillsViewAgentIdRef.current;
    if (!agentId) return;
    const snapshotAgentId = agentId;

    const updated = skillsList.map(s => s.name === name ? { ...s, enabled: enable } : s);
    setSkillsList(updated);

    try {
      const freshRes = await hanaFetch(`/api/skills?agentId=${encodeURIComponent(agentId)}`);
      const freshData = await freshRes.json();
      if (freshData.error) throw new Error(freshData.error);
      if (skillsViewAgentIdRef.current !== snapshotAgentId) return;
      const freshSkills = (freshData.skills || []) as Array<{ name: string; enabled: boolean }>;
      const enabledList = freshSkills
        .map(s => s.name === name ? { ...s, enabled: enable } : s)
        .filter(s => s.enabled)
        .map(s => s.name);

      const res = await hanaFetch(`/api/agents/${agentId}/skills`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enabledList }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (skillsViewAgentIdRef.current === snapshotAgentId) {
        showToast(t('settings.autoSaved'), 'success');
        await loadSkills();
      }
    } catch (err: unknown) {
      if (skillsViewAgentIdRef.current === snapshotAgentId) {
        const reverted = skillsList.map(s => s.name === name ? { ...s, enabled: !enable } : s);
        setSkillsList(reverted);
        showToast(t('settings.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
      }
    }
  };

  const toggleBundle = async (bundle: SkillBundleInfo, enable: boolean) => {
    const agentId = skillsViewAgentIdRef.current;
    if (!agentId) return;
    const snapshotAgentId = agentId;
    const bundleSkillNames = new Set(bundle.skillNames);
    const updated = skillsList.map(s => bundleSkillNames.has(s.name) ? { ...s, enabled: enable } : s);
    setSkillsList(updated);
    setSkillBundles(prev => prev.map(item => item.id === bundle.id
      ? {
          ...item,
          skills: item.skills?.map(skill => bundleSkillNames.has(skill.name)
            ? { ...skill, enabled: enable }
            : skill),
        }
      : item));

    try {
      const freshRes = await hanaFetch(`/api/skills?agentId=${encodeURIComponent(agentId)}`);
      const freshData = await freshRes.json();
      if (freshData.error) throw new Error(freshData.error);
      if (skillsViewAgentIdRef.current !== snapshotAgentId) return;
      const enabledList = ((freshData.skills || []) as Array<{ name: string; enabled: boolean }>)
        .map(s => bundleSkillNames.has(s.name) ? { ...s, enabled: enable } : s)
        .filter(s => s.enabled)
        .map(s => s.name);

      const res = await hanaFetch(`/api/agents/${agentId}/skills`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enabledList }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (skillsViewAgentIdRef.current === snapshotAgentId) {
        showToast(t('settings.autoSaved'), 'success');
        await loadSkills();
      }
    } catch (err: unknown) {
      if (skillsViewAgentIdRef.current === snapshotAgentId) {
        setSkillsList(skillsList);
        showToast(t('settings.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
        await loadSkills();
      }
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove(styles['drag-over']);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const filePath = platform?.getFilePath?.(file) || (file as File & { path?: string })?.path;
    if (filePath) await installSkillFromPath(filePath);
  };

  const addExternalPath = async () => {
    const folder = await platform?.selectFolder?.();
    if (!folder) return;
    const newPaths = [...externalPathsData.configured, folder];
    try {
      await hanaFetch('/api/skills/external-paths', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: newPaths }),
      });
      await loadExternalPaths();
      await loadSkills();
      showToast(t('settings.autoSaved'), 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const removeExternalPath = async (pathToRemove: string) => {
    const newPaths = externalPathsData.configured.filter(p => p !== pathToRemove);
    try {
      await hanaFetch('/api/skills/external-paths', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: newPaths }),
      });
      await loadExternalPaths();
      await loadSkills();
      showToast(t('settings.autoSaved'), 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const learnCfg = settingsConfig?.capabilities?.learn_skills || {};
  const discoveredPaths = externalPathsData.discovered;
  const configuredOnlyPaths = externalPathsData.configured.filter(
    p => !discoveredPaths.some(d => d.dirPath === p),
  );

  return (
    <div className={`${styles['settings-tab-content']} ${styles['active']}`} data-tab="skills">

      {/* Section 1: 管理技能 — Dropzone 虚线卡 + skill list 实线卡都自带视觉，flush 不再套白卡 */}
      <SettingsSection title={t('settings.skills.manageTitle')} variant="flush">
        <div
          className={styles['skills-dropzone']}
          onClick={installSkill}
          onDragOver={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add(styles['drag-over']); }}
          onDragLeave={(e) => (e.currentTarget as HTMLElement).classList.remove(styles['drag-over'])}
          onDrop={handleDrop}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>{t('settings.skills.dropzone')}</span>
        </div>

        {userSkills.length === 0 && skillBundles.length === 0 ? (
          <p className={`${styles['settings-muted-note']} ${styles['skills-empty']}`}>{t('settings.skills.noUser')}</p>
        ) : (
          <SkillBundleTree
            mode="manage"
            bundles={skillBundles}
            skills={userSkills}
            nameHints={nameHints}
            emptyText={t('settings.skills.noUser')}
            onDeleteSkill={deleteSkill}
            onCreateBundle={createBundle}
            onRenameBundle={renameBundle}
            onExportBundle={exportBundle}
            onDeleteBundle={deleteBundle}
            onReorderBundles={reorderBundles}
            onMoveSkillToBundle={moveSkillToBundle}
            onRemoveSkillFromBundles={removeSkillFromBundles}
          />
        )}
      </SettingsSection>

      {/* Section 2: 全局能力（子组件，保持原样） */}
      <SkillCapabilities learnCfg={learnCfg} />

      {/* Section 3A: Agent Skills 开关（per-Agent 开关）
       * AgentSelect 作为 section context；skill list 直接作为 section body children，
       * 由 SettingsSection 白卡承担卡片视觉，避免卡中卡 */}
      <SettingsSection
        title={t('settings.skills.userSkillsTitle')}
        context={
          <AgentSelect
            value={skillsViewAgentId}
            onChange={setSkillsViewAgentId}
          />
        }
      >
        {userSkills.length === 0 && skillBundles.length === 0 ? (
          <p className={styles['agent-skill-empty']} style={{ padding: 'var(--space-md)', margin: 0 }}>
            {t('settings.skills.noUser')}
          </p>
        ) : (
          <SkillBundleTree
            mode="agent"
            bundles={skillBundles}
            skills={userSkills}
            nameHints={nameHints}
            emptyText={t('settings.skills.noUser')}
            onToggleSkill={toggleSkill}
            onToggleBundle={toggleBundle}
          />
        )}
      </SettingsSection>

      {/* Section 3B: 自学 Skill（per-Agent 资产，同受 AgentSelect 影响） */}
      <SettingsSection title={t('settings.skills.learnedSkillsTitle')}>
        <LearnedSkillsBlock
          learnedSkills={learnedSkills}
          nameHints={nameHints}
          onDelete={deleteSkill}
          onToggle={toggleSkill}
        />
      </SettingsSection>

      {/* Section 4: 外部兼容
       * flush：CompatPathDrawer 自带卡片视觉，外壳不再套白卡 */}
      <SettingsSection title={t('settings.skills.compatTitle')} variant="flush">
        <p style={{
          fontSize: '0.7rem',
          color: 'var(--text-muted)',
          lineHeight: 1.4,
          margin: '0 0 var(--space-md)',
        }}>
          {t('settings.skills.compatDesc')}
        </p>
        <div className={styles['compat-paths-group']}>
          {discoveredPaths.map(d => (
            <CompatPathDrawer
              key={d.dirPath}
              dirPath={d.dirPath}
              label={d.label}
              exists={d.exists}
              isCustom={false}
              skills={externalSkills.filter(s => s.externalPath === d.dirPath)}
              nameHints={nameHints}
              onToggle={toggleSkill}
              onRemove={removeExternalPath}
            />
          ))}
          {configuredOnlyPaths.map(p => (
            <CompatPathDrawer
              key={p}
              dirPath={p}
              label={null}
              exists={true}
              isCustom={true}
              skills={externalSkills.filter(s => s.externalPath === p)}
              nameHints={nameHints}
              onToggle={toggleSkill}
              onRemove={removeExternalPath}
            />
          ))}
          <button className={styles['compat-add-path']} onClick={addExternalPath}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>{t('settings.skills.compatAddPath')}</span>
          </button>
        </div>
      </SettingsSection>

      {bundleDialog ? (
        <div
          className={styles['skill-bundle-dialog-backdrop']}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setBundleDialog(null);
          }}
        >
          <form
            className={styles['skill-bundle-dialog']}
            role="dialog"
            aria-modal="true"
            aria-label={
              bundleDialog.type === 'create'
                ? '新建 Bundle'
                : bundleDialog.type === 'rename'
                  ? '重命名 Bundle'
                  : '打散 Bundle'
            }
            onSubmit={submitBundleDialog}
          >
            <div className={styles['skill-bundle-dialog-header']}>
              <h3>
                {bundleDialog.type === 'create'
                  ? '新建 Bundle'
                  : bundleDialog.type === 'rename'
                    ? '重命名 Bundle'
                    : '打散 Bundle'}
              </h3>
              <button
                type="button"
                title="取消"
                aria-label="取消"
                onClick={() => setBundleDialog(null)}
              >
                ×
              </button>
            </div>
            {bundleDialog.type === 'delete' ? (
              <p className={styles['skill-bundle-dialog-text']}>
                打散 {bundleDialog.bundle.name}？Skill 会保留在公共库里，并显示为散装 Skill。
              </p>
            ) : (
              <label className={styles['skill-bundle-dialog-field']}>
                <span>Bundle 名字</span>
                <input
                  value={bundleDialog.name}
                  autoFocus
                  onChange={(event) => setBundleDialog(prev => {
                    if (!prev || prev.type === 'delete') return prev;
                    return { ...prev, name: event.target.value };
                  })}
                />
              </label>
            )}
            <div className={styles['skill-bundle-dialog-actions']}>
              <button type="button" onClick={() => setBundleDialog(null)}>
                取消
              </button>
              <button type="submit" className={styles['skill-bundle-dialog-primary']}>
                {bundleDialog.type === 'create'
                  ? '创建'
                  : bundleDialog.type === 'rename'
                    ? '保存'
                    : '打散'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

    </div>
  );
}
