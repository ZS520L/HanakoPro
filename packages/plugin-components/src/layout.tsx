import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './classnames';

export interface CardShellProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}

export function CardShell({
  title,
  description,
  actions,
  footer,
  children,
  className,
  ...sectionProps
}: CardShellProps) {
  return (
    <section {...sectionProps} className={cx('hana-plugin-card', className)}>
      {(title || description || actions) && (
        <header className="hana-plugin-card-header">
          <div className="hana-plugin-card-heading">
            {title && <h2 className="hana-plugin-card-title">{title}</h2>}
            {description && <p className="hana-plugin-card-description">{description}</p>}
          </div>
          {actions && <div className="hana-plugin-card-actions">{actions}</div>}
        </header>
      )}
      <div className="hana-plugin-card-body">{children}</div>
      {footer && <footer className="hana-plugin-card-footer">{footer}</footer>}
    </section>
  );
}

export interface SettingRowProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  hint?: ReactNode;
  control: ReactNode;
  layout?: 'inline' | 'stacked';
}

export function SettingRow({
  label,
  hint,
  control,
  layout = 'inline',
  className,
  ...rowProps
}: SettingRowProps) {
  return (
    <div
      {...rowProps}
      className={cx(
        'hana-plugin-setting-row',
        layout === 'stacked' ? 'hana-plugin-setting-row-stacked' : 'hana-plugin-setting-row-inline',
        className,
      )}
    >
      <div className="hana-plugin-setting-text">
        <div className="hana-plugin-setting-label">{label}</div>
        {hint && <div className="hana-plugin-setting-hint">{hint}</div>}
      </div>
      <div className="hana-plugin-setting-control">{control}</div>
    </div>
  );
}

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action, className, ...rootProps }: EmptyStateProps) {
  return (
    <div {...rootProps} className={cx('hana-plugin-empty', className)}>
      {icon && <div className="hana-plugin-empty-icon">{icon}</div>}
      <div className="hana-plugin-empty-title">{title}</div>
      {description && <div className="hana-plugin-empty-description">{description}</div>}
      {action && <div className="hana-plugin-empty-action">{action}</div>}
    </div>
  );
}

export interface ListItem {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}

export interface ListProps extends HTMLAttributes<HTMLUListElement> {
  items: ListItem[];
}

export function List({ items, className, ...listProps }: ListProps) {
  return (
    <ul {...listProps} className={cx('hana-plugin-list', className)}>
      {items.map((item) => (
        <li key={item.id} className="hana-plugin-list-item">
          {item.icon && <div className="hana-plugin-list-icon">{item.icon}</div>}
          <div className="hana-plugin-list-main">
            <div className="hana-plugin-list-line">
              <span className="hana-plugin-list-title">{item.title}</span>
              {item.meta && <span className="hana-plugin-list-meta">{item.meta}</span>}
            </div>
            {item.description && <div className="hana-plugin-list-description">{item.description}</div>}
          </div>
          {item.action && <div className="hana-plugin-list-action">{item.action}</div>}
        </li>
      ))}
    </ul>
  );
}
