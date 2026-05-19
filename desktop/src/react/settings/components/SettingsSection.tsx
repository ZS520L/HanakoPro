import React from 'react';
import styles from './settings-components.module.css';

type Variant = 'default' | 'hero' | 'double-column' | 'flush';

interface SettingsSectionProps {
  title?: React.ReactNode;
  /** Section 的上下文（如 agent 选择器），渲染在 title 右侧。
   *  用于表达"这个 section 针对哪个对象"——context 选中什么，section 内的配置就作用于什么。 */
  context?: React.ReactNode;
  variant?: Variant;
  children: React.ReactNode;
  className?: string;
}

interface FooterProps {
  children: React.ReactNode;
}

function Footer({ children }: FooterProps) {
  return <div className={styles.sectionFooter}>{children}</div>;
}

interface SubBlockProps {
  title?: React.ReactNode;
  children: React.ReactNode;
}

function SubBlock({ title, children }: SubBlockProps) {
  return (
    <div className={styles.subBlock}>
      {title && <h3 className={styles.subBlockTitle}>{title}</h3>}
      {children}
    </div>
  );
}

interface WarningProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

function Note({ children, className, ...rest }: WarningProps) {
  return <div className={[styles.sectionNote, className].filter(Boolean).join(' ')} {...rest}>{children}</div>;
}

function Warning({ children, className, ...rest }: WarningProps) {
  return <div className={[styles.sectionWarning, className].filter(Boolean).join(' ')} {...rest}>{children}</div>;
}

function SettingsSectionBase({ title, context, variant = 'default', children, className }: SettingsSectionProps) {
  const rootClass = [
    styles.section,
    variant === 'hero' && styles.sectionHero,
    variant === 'double-column' && styles.sectionDoubleColumn,
    variant === 'flush' && styles.sectionFlush,
    className,
  ].filter(Boolean).join(' ');

  const hasHeader = (title || context) && variant !== 'hero';

  return (
    <section className={rootClass}>
      {hasHeader && (
        <div className={styles.sectionHeader}>
          {title && <h2 className={styles.sectionTitle}>{title}</h2>}
          {context && <div className={styles.sectionContext}>{context}</div>}
        </div>
      )}
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

export const SettingsSection = Object.assign(SettingsSectionBase, {
  Footer,
  Note,
  SubBlock,
  Warning,
});
