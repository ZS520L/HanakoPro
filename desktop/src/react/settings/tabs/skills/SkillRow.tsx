import React from 'react';
import type { SkillInfo } from '../../store';
import { t } from '../../helpers';
import styles from '../../Settings.module.css';

function truncateDesc(raw: string): string {
  const cnMatch = raw.match(/[\u4e00-\u9fff].*$/s);
  let desc = cnMatch ? cnMatch[0] : raw;
  desc = desc.replace(/\s*MANDATORY TRIGGERS:.*$/si, '').trim();
  if (desc.length > 80) desc = desc.slice(0, 80) + '\u2026';
  return desc;
}

interface SkillRowProps {
  skill: SkillInfo;
  nameHint?: string;
  deletable?: boolean;
  draggable?: boolean;
  className?: string;
  extraActions?: React.ReactNode;
  /** 传了就渲染 delete 按钮。Section 1 "技能管理" 传；Section 3 "Agent 配置" 不传。 */
  onDelete?: (name: string) => void;
  /** 传了就渲染 toggle 按钮。Section 3 "Agent 配置" 传；Section 1 "技能管理" 不传。 */
  onToggle?: (name: string, enabled: boolean) => void;
  onDragStart?: (event: React.DragEvent<HTMLDivElement>, name: string) => void;
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
}

export function SkillRow({
  skill,
  nameHint,
  deletable = true,
  draggable = false,
  className = '',
  extraActions,
  onDelete,
  onToggle,
  onDragStart,
  onDragOver,
  onDrop,
}: SkillRowProps) {
  const displayDesc = truncateDesc(skill.description || '');

  return (
    <div
      className={`${styles['skills-list-item']} ${className}`.trim()}
      draggable={draggable}
      onDragStart={(event) => onDragStart?.(event, skill.name)}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={() => {
        if (skill.baseDir) {
          window.platform?.openSkillViewer?.({
            name: skill.name,
            baseDir: skill.baseDir,
            filePath: skill.filePath,
            installed: true,
          });
        }
      }}
    >
      <div className={styles['skills-list-info']}>
        <span className={styles['skills-list-name']}>
          {skill.name}
          {nameHint && <span className={styles['skills-list-name-hint']}>{nameHint}</span>}
        </span>
        <span className={styles['skills-list-desc']}>{displayDesc}</span>
      </div>
      <div className={styles['skills-list-actions']}>
        {extraActions}
        {deletable && onDelete && (
          <button
            className={styles['skill-card-delete']}
            type="button"
            title={t('settings.skills.delete')}
            aria-label={t('settings.skills.delete')}
            onClick={(e) => { e.stopPropagation(); onDelete(skill.name); }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
        {onToggle && (
          <button
            className={`hana-toggle${skill.enabled ? ' on' : ''}`}
            type="button"
            title={skill.enabled ? '关闭 Skill' : '启用 Skill'}
            aria-label={skill.enabled ? `关闭 ${skill.name}` : `启用 ${skill.name}`}
            onClick={(e) => { e.stopPropagation(); onToggle(skill.name, !skill.enabled); }}
          />
        )}
      </div>
    </div>
  );
}
