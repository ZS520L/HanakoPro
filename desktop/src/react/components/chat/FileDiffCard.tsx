/**
 * FileDiffCard — Windsurf-style inline diff card
 *
 * Renders a collapsible unified diff with syntax highlighting.
 * Receives oldContent / newContent from the write/edit tool details.
 */

import { memo, useMemo, useState } from 'react';
import { structuredPatch } from 'diff';
import hljs from 'highlight.js/lib/core';
import styles from './Chat.module.css';

// ── Register common languages (keep bundle small) ──
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import bash from 'highlight.js/lib/languages/bash';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import kotlin from 'highlight.js/lib/languages/kotlin';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import csharp from 'highlight.js/lib/languages/csharp';
import scss from 'highlight.js/lib/languages/scss';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('css', css);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('java', java);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', cpp);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('php', php);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('scss', scss);

// Aliases
const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', pyw: 'python',
  css: 'css', scss: 'scss',
  json: 'json', jsonl: 'json', json5: 'json',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  java: 'java',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp', c: 'c',
  go: 'go',
  rs: 'rust',
  yaml: 'yaml', yml: 'yaml',
  md: 'markdown', mdx: 'markdown',
  sql: 'sql',
  swift: 'swift',
  kt: 'kotlin', kts: 'kotlin',
  rb: 'ruby',
  php: 'php',
  cs: 'csharp',
};

function langFromFileName(name: string): string | undefined {
  const ext = name.split('.').pop()?.toLowerCase();
  if (!ext) return undefined;
  return EXT_TO_LANG[ext];
}

/** Highlight a line of code, returns HTML string */
function highlightLine(text: string, lang?: string): string {
  if (!text) return '';
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
    }
    return hljs.highlightAuto(text).value;
  } catch {
    return escapeHtml(text);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Types ──

interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  oldNum?: number;
  newNum?: number;
  text: string;
}

interface HunkGroup {
  lines: DiffLine[];
}

function computeDiff(oldContent: string, newContent: string, fileName: string): {
  hunks: HunkGroup[];
  additions: number;
  deletions: number;
} {
  const patch = structuredPatch(fileName, fileName, oldContent, newContent, '', '', { context: 3 });
  let additions = 0;
  let deletions = 0;
  const hunks: HunkGroup[] = [];

  for (const hunk of patch.hunks) {
    const group: HunkGroup = { lines: [] };
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;

    for (const raw of hunk.lines) {
      const text = raw.slice(1); // remove +/-/space prefix
      if (raw.startsWith('+')) {
        group.lines.push({ type: 'add', newNum: newLine++, text });
        additions++;
      } else if (raw.startsWith('-')) {
        group.lines.push({ type: 'del', oldNum: oldLine++, text });
        deletions++;
      } else {
        group.lines.push({ type: 'ctx', oldNum: oldLine++, newNum: newLine++, text });
      }
    }
    hunks.push(group);
  }

  return { hunks, additions, deletions };
}

// ── Component ──

interface Props {
  fileName: string;
  filePath: string;
  oldContent: string;
  newContent: string;
}

export const FileDiffCard = memo(function FileDiffCard({ fileName, filePath, oldContent, newContent }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const lang = useMemo(() => langFromFileName(fileName), [fileName]);

  const diff = useMemo(
    () => collapsed ? null : computeDiff(oldContent, newContent, fileName),
    [collapsed, oldContent, newContent, fileName],
  );

  if (diff && diff.hunks.length === 0) return null;

  const statsText = diff ? `+${diff.additions} -${diff.deletions}` : '';

  const handleOpenFile = () => {
    window.platform?.openFile?.(filePath);
  };

  return (
    <div className={styles.diffCard}>
      <div className={styles.diffCardHeader} onClick={() => setCollapsed(v => !v)}>
        <div className={styles.diffCardTitleRow}>
          <span className={styles.diffCardIcon}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </span>
          <span className={styles.diffCardTitle} title={filePath} onClick={(e) => { e.stopPropagation(); handleOpenFile(); }}>
            {fileName}
          </span>
        </div>
        <span className={styles.diffCardStats}>{statsText}</span>
        <span className={styles.diffCardArrow}>{collapsed ? '›' : '‹'}</span>
      </div>

      {!collapsed && (
        <div className={styles.diffCardBody}>
          {diff?.hunks.map((hunk, hi) => (
            <div key={hi} className={styles.diffHunk}>
              {hi > 0 && <div className={styles.diffHunkSeparator}>···</div>}
              {hunk.lines.map((line, li) => (
                <div
                  key={li}
                  className={`${styles.diffLine} ${
                    line.type === 'add' ? styles.diffLineAdd :
                    line.type === 'del' ? styles.diffLineDel :
                    styles.diffLineCtx
                  }`}
                >
                  <span className={styles.diffLineNum}>
                    {line.type === 'add' ? '' : (line.oldNum ?? '')}
                  </span>
                  <span className={styles.diffLineNum}>
                    {line.type === 'del' ? '' : (line.newNum ?? '')}
                  </span>
                  <span className={styles.diffLineSign}>
                    {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                  </span>
                  <span
                    className={styles.diffLineText}
                    dangerouslySetInnerHTML={{ __html: highlightLine(line.text, lang) }}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
