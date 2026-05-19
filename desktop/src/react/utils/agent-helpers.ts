/**
 * agent-helpers.ts — Yuan 辅助纯函数
 *
 * 从 app-agents-shim.ts 提取。不依赖 ctx 注入，直接使用 Zustand store。
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- t() 返回值 + opts/patch 为动态 Record */

import { useStore } from '../stores';

function tr(key: string, vars?: Record<string, string>): any {
  const fn = (globalThis as any).t || (globalThis as any).window?.t;
  return typeof fn === 'function' ? fn(key, vars) : undefined;
}

export function yuanFallbackAvatar(yuan?: string): string {
  const types = tr('yuan.types') || {};
  const entry = types[yuan || 'hanako'];
  return `assets/${entry?.avatar || 'Hanako.png'}`;
}

export function randomWelcome(agentName?: string, yuan?: string): string {
  const s = useStore.getState();
  const name = agentName || s.agentName;
  const y = yuan || s.agentYuan;
  const yuanMsgs = tr(`yuan.welcome.${y}`);
  const msgs = Array.isArray(yuanMsgs) ? yuanMsgs : tr('welcome.messages');
  if (!Array.isArray(msgs) || msgs.length === 0) return '';
  const raw = msgs[Math.floor(Math.random() * msgs.length)];
  return raw.replaceAll('{name}', name);
}

export function yuanPlaceholder(yuan?: string): string {
  const s = useStore.getState();
  const y = yuan || s.agentYuan;
  const yuanPh = tr(`yuan.placeholder.${y}`);
  return (yuanPh && !yuanPh.startsWith('yuan.')) ? yuanPh : tr('input.placeholder');
}
