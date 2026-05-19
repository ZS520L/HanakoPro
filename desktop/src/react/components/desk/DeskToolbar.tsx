/**
 * DeskToolbar — 面包屑导航、排序按钮、Finder 打开按钮
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../stores';
import { jumpToDeskSearchResult, loadDeskFiles, searchDeskFiles } from '../../stores/desk-actions';
import type { DeskSearchResult } from '../../types';
import {
  ICONS,
  getSortOptions,
  getSortShort,
  getFileTypeFilterOptions,
  getFilterShort,
  type SortMode,
  type FileTypeFilter,
  type CtxMenuState,
} from './desk-types';
import s from './Desk.module.css';

// ── Open in Finder 按钮 ──

export function DeskOpenButton() {
  const handleClick = useCallback(() => {
    const s = useStore.getState();
    if (!s.deskBasePath) return;
    const target = s.deskCurrentPath
      ? s.deskBasePath + '/' + s.deskCurrentPath
      : s.deskBasePath;
    window.platform?.openFolder?.(target);
  }, []);

  return (
    <button className={s.openBtn} onClick={handleClick}>
      <span dangerouslySetInnerHTML={{ __html: ICONS.finderOpen }} />
      <span>{(window.t ?? ((p: string) => p))('desk.openInFinder')}</span>
    </button>
  );
}

export function DeskOpenIconButton() {
  const hasDesk = useStore(s => !!s.deskBasePath);
  const label = (window.t ?? ((p: string) => p))('desk.openInFinder');
  const handleClick = useCallback(() => {
    const s = useStore.getState();
    if (!s.deskBasePath) return;
    const target = s.deskCurrentPath
      ? s.deskBasePath + '/' + s.deskCurrentPath
      : s.deskBasePath;
    window.platform?.openFolder?.(target);
  }, []);

  return (
    <button className={`${s.sortBtn} ${s.iconBtn}`} onClick={handleClick} title={label} aria-label={label} disabled={!hasDesk}>
      <span dangerouslySetInnerHTML={{ __html: ICONS.finderOpen }} />
    </button>
  );
}

// ── 面包屑导航 ──

export function DeskBreadcrumb() {
  const deskCurrentPath = useStore(s => s.deskCurrentPath);

  const handleBack = useCallback(() => {
    const s = useStore.getState();
    const cur = s.deskCurrentPath;
    if (!cur) return;
    const parent = cur.includes('/')
      ? cur.substring(0, cur.lastIndexOf('/'))
      : '';
    loadDeskFiles(parent);
  }, []);

  if (!deskCurrentPath) return null;

  return (
    <div className={s.nav}>
      <button className={s.backBtn} onClick={handleBack}>
        <span dangerouslySetInnerHTML={{ __html: ICONS.back }} />
        <span>{deskCurrentPath}</span>
      </button>
    </div>
  );
}

// ── 手动刷新按钮 ──

export function DeskRefreshButton() {
  const hasDesk = useStore(s => !!s.deskBasePath);
  const handleClick = useCallback(() => {
    if (!useStore.getState().deskBasePath) return;
    void loadDeskFiles();
  }, []);
  const label = (window.t ?? ((p: string) => p))('desk.refresh');

  return (
    <button className={`${s.sortBtn} ${s.iconBtn}`} onClick={handleClick} title={label} aria-label={label} disabled={!hasDesk}>
      <span dangerouslySetInnerHTML={{ __html: ICONS.refresh }} />
    </button>
  );
}

// ── 排序按钮 ──

export function DeskSortButton({ sortMode, onSort, onShowMenu }: {
  sortMode: SortMode;
  onSort: (m: SortMode) => void;
  onShowMenu: (state: CtxMenuState) => void;
}) {
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onShowMenu({
      position: { x: rect.left, y: rect.bottom + 4 },
      items: getSortOptions().map(o => ({
        label: (o.key === sortMode ? '· ' : '   ') + o.label,
        action: () => {
          localStorage.setItem('hana-desk-sort', o.key);
          onSort(o.key);
        },
      })),
    });
  }, [sortMode, onSort, onShowMenu]);

  return (
    <button className={s.sortBtn} onClick={handleClick}>
      <span dangerouslySetInnerHTML={{ __html: ICONS.sort }} />
      <span>{getSortShort(sortMode)}</span>
    </button>
  );
}

// ── 类型过滤按钮 ──

export function DeskFilterButton({ filters, onFiltersChange, onShowMenu }: {
  filters: FileTypeFilter[];
  onFiltersChange: (filters: FileTypeFilter[]) => void;
  onShowMenu: (state: CtxMenuState) => void;
}) {
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onShowMenu({
      position: { x: rect.left, y: rect.bottom + 4 },
      items: [
        ...getFileTypeFilterOptions().map(o => ({
          label: o.label,
          checked: filters.includes(o.key),
          action: () => {
            const next = filters.includes(o.key)
              ? filters.filter(item => item !== o.key)
              : [...filters, o.key];
            onFiltersChange(next);
          },
        })),
        ...(filters.length > 0 ? [{
          divider: true as const,
        }, {
          label: (window.t ?? ((p: string) => p))('desk.filter.clear'),
          action: () => onFiltersChange([]),
        }] : []),
      ],
    });
  }, [filters, onFiltersChange, onShowMenu]);

  const label = (window.t ?? ((p: string) => p))('desk.filter.label');
  return (
    <button
      className={`${s.sortBtn}${filters.length > 0 ? ` ${s.filterBtnActive}` : ''}`}
      onClick={handleClick}
      aria-label={label}
      title={label}
    >
      <span dangerouslySetInnerHTML={{ __html: ICONS.filter }} />
      <span>{getFilterShort(filters)}</span>
    </button>
  );
}

// ── 工作区搜索 ──

export function DeskSearchBox() {
  const hasDesk = useStore(s => !!s.deskBasePath);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DeskSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const versionRef = useRef(0);
  const t = window.t ?? ((p: string) => p);

  useEffect(() => {
    const trimmed = query.trim();
    const version = ++versionRef.current;
    if (!trimmed || !hasDesk) {
      setResults([]);
      setOpen(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      void searchDeskFiles(trimmed).then((items) => {
        if (versionRef.current !== version) return;
        setResults(items);
        setOpen(true);
      });
    }, 180);
    return () => clearTimeout(timer);
  }, [hasDesk, query]);

  const handlePick = useCallback(async (result: DeskSearchResult) => {
    setOpen(false);
    await jumpToDeskSearchResult(result);
  }, []);

  return (
    <div className={s.searchWrap}>
      <input
        className={s.searchInput}
        value={query}
        placeholder={t('desk.search.placeholder')}
        aria-label={t('desk.search.label')}
        disabled={!hasDesk}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      />
      {open && query.trim() && (
        <div className={s.searchResults} role="listbox" aria-label={t('desk.search.results')}>
          {results.length === 0 ? (
            <div className={s.searchEmpty}>{t('desk.search.empty')}</div>
          ) : (
            results.map(result => (
              <button
                key={result.relativePath}
                type="button"
                className={s.searchResult}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void handlePick(result)}
              >
                <span className={s.searchResultName}>{result.name}</span>
                <span className={s.searchResultPath}>{result.parentSubdir || t('desk.search.root')}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
