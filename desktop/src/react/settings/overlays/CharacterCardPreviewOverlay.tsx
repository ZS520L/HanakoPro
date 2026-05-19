import { useState } from 'react';
import { createPortal } from 'react-dom';
import { hanaUrl } from '../api';
import { displayInitial } from '../../utils/grapheme';
import styles from '../Settings.module.css';

export type CharacterCardPlan = {
  token?: string;
  agentId?: string;
  mode?: 'import' | 'export';
  packageName: string;
  agent: {
    name: string;
    yuan: string;
    description?: string;
    identitySummary?: string;
  };
  prompts?: {
    identity?: string;
    ishiki?: string;
    publicIshiki?: string;
  };
  memory: {
    available: boolean;
    count: number;
    preview?: string;
    unavailableReason?: string;
    compiled?: {
      facts?: string;
      today?: string;
      week?: string;
      longterm?: string;
    };
  };
  skills: {
    count: number;
    bundles: Array<{
      name: string;
      skillCount: number;
      skills: Array<{ name: string }>;
    }>;
  };
  assets: Record<string, boolean>;
};

type Props = {
  plan: CharacterCardPlan;
  mode: 'import' | 'export';
  memoryChecked: boolean;
  processing: boolean;
  onMemoryChange: (checked: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

export function CharacterCardPreviewOverlay({
  plan,
  mode,
  memoryChecked,
  processing,
  onMemoryChange,
  onConfirm,
  onCancel,
}: Props) {
  const [detailOpen, setDetailOpen] = useState(false);
  const skillNames = plan.skills.bundles.flatMap(bundle => bundle.skills.map(skill => skill.name));
  const visibleSkillNames = skillNames.slice(0, 3);
  const hasMoreSkills = skillNames.length > visibleSkillNames.length;
  const memoryLabel = mode === 'export' ? '导出记忆' : '导入记忆';
  const memoryUnavailableLabel = mode === 'export' ? '无可导出记忆' : '无可导入记忆';
  const confirmLabel = processing ? (mode === 'export' ? '正在导出' : '正在导入') : '确定';
  const descriptionText = plan.agent.description || '这个角色卡没有写入 Description。';
  const ishikiText = plan.prompts?.ishiki || '未提供 Ishiki';
  const yuanKey = (plan.agent.yuan || 'hanako').toLowerCase();
  const memoryInputId = `character-card-memory-${plan.token || plan.agentId || 'preview'}`;
  const memoryAvailable = plan.memory.available;
  const memoryPreviewText = plan.memory.preview || '无记忆';
  const memoryDetailBlocks = [
    { key: 'facts', title: '重要事实', value: plan.memory.compiled?.facts || '' },
    { key: 'today', title: '今天', value: plan.memory.compiled?.today || '' },
    { key: 'week', title: '本周早些时候', value: plan.memory.compiled?.week || '' },
    { key: 'longterm', title: '长期情况', value: plan.memory.compiled?.longterm || '' },
  ];

  const assetUrl = (key: string) => (
    plan.assets?.[key]
      ? mode === 'export' && plan.agentId
        ? hanaUrl(`/api/character-cards/export/${encodeURIComponent(plan.agentId)}/assets/${key}`)
        : plan.token
          ? hanaUrl(`/api/character-cards/plans/${plan.token}/assets/${key}`)
          : ''
      : ''
  );
  const frontUrl = assetUrl('cardFront') || assetUrl('avatar');
  const backUrl = assetUrl('cardBack') || assetUrl('avatar') || frontUrl;
  const yuanIconUrl = assetUrl('yuanIcon') || backUrl;

  const overlay = (
    <div className={styles['character-card-preview-overlay']} data-yuan={yuanKey} role="dialog" aria-modal="true">
      {detailOpen ? (
        <section className={styles['character-card-detail-panel']}>
          <button
            className={styles['character-card-detail-close']}
            type="button"
            onClick={() => setDetailOpen(false)}
            disabled={processing}
          >
            ×
          </button>
          <div className={styles['character-card-detail-hero']}>
            {frontUrl ? <img src={frontUrl} draggable={false} /> : null}
            <div>
              <h3>{plan.agent.name}</h3>
              <p>{descriptionText}</p>
            </div>
          </div>
          <div className={styles['character-card-detail-grid']}>
            <section>
              <h4>Identity</h4>
              <p>{plan.prompts?.identity || plan.agent.identitySummary || '未提供 Identity'}</p>
            </section>
            <section>
              <h4>Ishiki</h4>
              <p>{ishikiText}</p>
            </section>
            <section>
              <h4>Yuan</h4>
              <p>{plan.agent.yuan}</p>
            </section>
            <section>
              <h4>Memory</h4>
              <p>{memoryAvailable ? `${plan.memory.count} 个记忆项目，可选${mode === 'export' ? '导出' : '导入'}` : memoryUnavailableLabel}</p>
              <div className={styles['character-card-memory-detail-list']}>
                {memoryDetailBlocks.map(block => (
                  <div className={styles['character-card-memory-detail-block']} key={block.key}>
                    <strong>{block.title}</strong>
                    <pre>{block.value || '无'}</pre>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <h4>Skills</h4>
              {plan.skills.bundles.length > 0 ? plan.skills.bundles.map((bundle) => (
                <div className={styles['character-card-detail-bundle']} key={bundle.name}>
                  <strong>{bundle.name}</strong>
                  <span>{bundle.skillCount} skills</span>
                  <ul>
                    {bundle.skills.map(skill => <li key={skill.name}>{skill.name}</li>)}
                  </ul>
                </div>
              )) : <p>未包含 Skill</p>}
            </section>
          </div>
        </section>
      ) : (
        <section className={styles['character-card-preview-shell']}>
          <div className={styles['character-card-preview-cards']}>
            <article className={styles['character-card-front']}>
              <div
                className={styles['character-card-visual']}
              >
                {frontUrl ? (
                  <img src={frontUrl} draggable={false} />
                ) : (
                  <span>{displayInitial(plan.agent.name, '?')}</span>
                )}
              </div>
              <div className={styles['character-card-face']}>
                <div className={styles['character-card-title-row']}>
                  <div className={styles['character-card-title-text']}>
                    <h3>{plan.agent.name}</h3>
                    <p>{descriptionText}</p>
                  </div>
                  <button
                    className={styles['character-card-detail-trigger']}
                    type="button"
                    aria-label="查看角色卡详情"
                    onClick={() => setDetailOpen(true)}
                    disabled={processing}
                  >
                    ...
                  </button>
                </div>
                <div className={styles['character-card-face-grid']}>
                  <div className={styles['character-card-face-cell']}>
                    <span className={styles['character-card-face-label']}>YUAN</span>
                    <span className={styles['character-card-face-line']} />
                    <span className={`${styles['character-card-face-value']} ${styles['character-card-yuan-value']}`}>
                      {yuanIconUrl ? (
                        <img className={styles['character-card-yuan-icon']} src={yuanIconUrl} draggable={false} />
                      ) : null}
                      {plan.agent.yuan}
                    </span>
                  </div>
                  <div className={styles['character-card-face-cell']}>
                    <span className={styles['character-card-face-label']}>MEMORY</span>
                    <span className={styles['character-card-face-line']} />
                    <span className={`${styles['character-card-face-value']} ${styles['character-card-memory-value']}`}>
                      <span className={styles['character-card-memory-preview']}>{memoryPreviewText}</span>
                      <label
                        className={`${styles['character-card-memory-toggle']} ${!memoryAvailable ? styles['character-card-memory-toggle-disabled'] : ''}`}
                        htmlFor={memoryInputId}
                        title={!memoryAvailable ? (plan.memory.unavailableReason || memoryUnavailableLabel) : undefined}
                      >
                        <input
                          id={memoryInputId}
                          className={styles['character-card-memory-checkbox']}
                          type="checkbox"
                          checked={memoryChecked}
                          disabled={!memoryAvailable || processing}
                          onChange={(event) => onMemoryChange(event.target.checked)}
                        />
                        {memoryAvailable ? memoryLabel : memoryUnavailableLabel}
                      </label>
                    </span>
                  </div>
                  <div className={styles['character-card-face-cell']}>
                    <span className={styles['character-card-face-label']}>SKILLS</span>
                    <span className={styles['character-card-face-line']} />
                    <span className={`${styles['character-card-face-value']} ${styles['character-card-skills-value']}`}>
                      {visibleSkillNames.length > 0 ? (
                        <span className={styles['character-card-skill-list']}>
                          {visibleSkillNames.map(name => <span key={name}>{name}</span>)}
                          {hasMoreSkills ? <span>...</span> : null}
                        </span>
                      ) : '无'}
                    </span>
                  </div>
                </div>
              </div>
            </article>
            <article className={`${styles['character-card-front']} ${styles['character-card-back']}`}>
              {backUrl ? <img src={backUrl} draggable={false} /> : <span>{plan.agent.yuan}</span>}
            </article>
          </div>
          <div className={styles['character-card-preview-actions']}>
            <button
              className={styles['character-card-primary-action']}
              type="button"
              onClick={onConfirm}
              disabled={processing}
            >
              {confirmLabel}
            </button>
            <button
              className={styles['character-card-secondary-action']}
              type="button"
              onClick={onCancel}
              disabled={processing}
            >
              取消
            </button>
          </div>
        </section>
      )}
    </div>
  );

  return createPortal(overlay, document.body);
}
