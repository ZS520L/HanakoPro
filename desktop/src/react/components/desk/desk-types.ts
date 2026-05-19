/**
 * desk-types — DeskSection 子组件共用的类型、常量、工具函数
 */

import type { ContextMenuItem } from '../../ui';
import type { DeskFile } from '../../types';
import { extOfName, inferKindByExt } from '../../utils/file-kind';

// ── SVG 图标 ──

export const ICONS = {
  folder: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  doc: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>',
  image: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  code: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  pdf: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  file: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  finderOpen: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  back: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
  settings: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  refresh: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><polyline points="3 20 3 14 9 14"/><polyline points="21 4 21 10 15 10"/></svg>',
  sort: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/></svg>',
  filter: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.5 10 20 14 22 14 12.5 22 3"/></svg>',
} as const;

// ── 排序 ──

export const DESK_SORT_KEY = 'hana-desk-sort';

export type SortMode = 'mtime-desc' | 'name-asc' | 'name-desc' | 'size-desc' | 'type-asc';
export type FileTypeFilter = 'image' | 'text' | 'video';

function tr(key: string, vars?: Record<string, string | number>): string {
  return window.t ? window.t(key, vars) : key;
}

export function getSortOptions(): Array<{ key: SortMode; label: string }> {
  return [
    { key: 'mtime-desc', label: tr('desk.sort.mtime') },
    { key: 'name-asc', label: tr('desk.sort.nameAsc') },
    { key: 'name-desc', label: tr('desk.sort.nameDesc') },
    { key: 'size-desc', label: tr('desk.sort.size') },
    { key: 'type-asc', label: tr('desk.sort.type') },
  ];
}

export function getSortShort(mode: string): string {
  const map: Record<string, string> = {
    'mtime-desc': tr('desk.sort.mtimeShort'),
    'name-asc': tr('desk.sort.nameAscShort'),
    'name-desc': tr('desk.sort.nameDescShort'),
    'size-desc': tr('desk.sort.sizeShort'),
    'type-asc': tr('desk.sort.typeShort'),
  };
  return map[mode] || tr('desk.sort.label');
}

export function getFileTypeFilterOptions(): Array<{ key: FileTypeFilter; label: string }> {
  return [
    { key: 'image', label: tr('desk.filter.images') },
    { key: 'text', label: tr('desk.filter.text') },
    { key: 'video', label: tr('desk.filter.videos') },
  ];
}

export function getFilterShort(filters: readonly FileTypeFilter[]): string {
  if (filters.length === 0) return tr('desk.filter.label');
  if (filters.length === 1) {
    const found = getFileTypeFilterOptions().find(item => item.key === filters[0]);
    return found?.label || tr('desk.filter.label');
  }
  return tr('desk.filter.activeShort', { count: filters.length });
}

export function fileMatchesTypeFilters(file: DeskFile, filters: readonly FileTypeFilter[]): boolean {
  if (file.isDir || filters.length === 0) return true;
  const kind = inferKindByExt(extOfName(file.name));
  return filters.some(filter => {
    if (filter === 'image') return kind === 'image' || kind === 'svg';
    if (filter === 'video') return kind === 'video';
    if (filter === 'text') return kind === 'markdown' || kind === 'code' || kind === 'doc' || kind === 'pdf';
    return false;
  });
}

export function getFileIcon(name: string): string {
  const ext = extOfName(name) || '';
  if (['md', 'txt'].includes(ext)) return ICONS.doc;
  if (ext === 'pdf') return ICONS.pdf;
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return ICONS.image;
  if (['js', 'ts', 'py', 'json', 'yaml', 'yml', 'html', 'css'].includes(ext)) return ICONS.code;
  return ICONS.file;
}

export function sortDeskFiles(files: DeskFile[], mode: SortMode): DeskFile[] {
  const filtered = files.filter(f => f.name !== 'jian.md');
  const dirs = filtered.filter(f => f.isDir);
  const regular = filtered.filter(f => !f.isDir);

  const cmp = (a: DeskFile, b: DeskFile): number => {
    switch (mode) {
      case 'name-asc': return a.name.localeCompare(b.name, 'zh');
      case 'name-desc': return b.name.localeCompare(a.name, 'zh');
      case 'size-desc':
        if (a.isDir) return a.name.localeCompare(b.name, 'zh');
        return (b.size ?? 0) - (a.size ?? 0);
      case 'type-asc': {
        const extA = a.name.includes('.') ? a.name.split('.').pop()! : '';
        const extB = b.name.includes('.') ? b.name.split('.').pop()! : '';
        return extA.localeCompare(extB) || a.name.localeCompare(b.name, 'zh');
      }
      case 'mtime-desc':
      default:
        return new Date(b.mtime ?? 0).getTime() - new Date(a.mtime ?? 0).getTime();
    }
  };

  dirs.sort(cmp);
  regular.sort(cmp);
  return [...dirs, ...regular];
}

// ── 共享 context menu 状态类型 ──

export interface CtxMenuState {
  items: ContextMenuItem[];
  position: { x: number; y: number };
}
