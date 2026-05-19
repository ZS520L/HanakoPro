import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import type { TimelineAnchor } from './timeline-anchors';
import styles from './Chat.module.css';

const TIMELINE_MAX_VISIBLE_ROWS = 10;

interface MarkerLayout {
  targetTop: number;
}

interface Props {
  anchors: TimelineAnchor[];
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  messageElementsRef: RefObject<Map<string, HTMLDivElement>>;
  active: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export const ChatTimelineNavigator = memo(function ChatTimelineNavigator({
  anchors,
  scrollRef,
  contentRef,
  messageElementsRef,
  active,
}: Props) {
  const [layouts, setLayouts] = useState<Record<string, MarkerLayout>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const rafRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const measure = useCallback(() => {
    const panel = scrollRef.current;
    if (!panel || anchors.length === 0) {
      setLayouts({});
      setActiveId(null);
      return;
    }

    const maxScroll = Math.max(0, panel.scrollHeight - panel.clientHeight);
    const panelRect = panel.getBoundingClientRect();
    const next: Record<string, MarkerLayout> = {};

    for (const anchor of anchors) {
      const element = messageElementsRef.current?.get(anchor.messageId);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      const targetTop = clamp(panel.scrollTop + rect.top - panelRect.top - 16, 0, maxScroll);
      next[anchor.messageId] = {
        targetTop,
      };
    }

    setLayouts(next);
  }, [anchors, messageElementsRef, scrollRef]);

  const updateActive = useCallback(() => {
    const panel = scrollRef.current;
    if (!panel || anchors.length === 0) {
      setActiveId(null);
      return;
    }

    const threshold = panel.scrollTop + 96;
    let nextId = anchors[0]?.messageId ?? null;
    for (const anchor of anchors) {
      const layout = layouts[anchor.messageId];
      if (!layout) continue;
      if (layout.targetTop <= threshold) {
        nextId = anchor.messageId;
      } else {
        break;
      }
    }
    setActiveId(nextId);
  }, [anchors, layouts, scrollRef]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const panel = scrollRef.current;
    if (!panel) return;
    const content = contentRef.current;
    const observer = new ResizeObserver(() => measure());
    observer.observe(panel);
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [contentRef, measure, scrollRef]);

  useEffect(() => {
    const panel = scrollRef.current;
    if (!panel || !active) return;

    const schedule = () => {
      if (rafRef.current != null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        updateActive();
      });
    };

    updateActive();
    panel.addEventListener('scroll', schedule, { passive: true });
    return () => {
      panel.removeEventListener('scroll', schedule);
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [active, scrollRef, updateActive]);

  const jumpTo = useCallback((anchor: TimelineAnchor) => {
    const panel = scrollRef.current;
    const layout = layouts[anchor.messageId];
    if (!panel || !layout) return;
    panel.scrollTo({ top: layout.targetTop, behavior: 'smooth' });
  }, [layouts, scrollRef]);

  const renderedAnchors = useMemo(
    () => anchors.filter(anchor => layouts[anchor.messageId]),
    [anchors, layouts],
  );

  const visibleRows = Math.min(renderedAnchors.length, TIMELINE_MAX_VISIBLE_ROWS);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [renderedAnchors.length, visibleRows]);

  if (!active || anchors.length === 0) return null;

  const cardVars: CSSProperties & { '--timeline-visible-rows': number } = {
    '--timeline-visible-rows': Math.max(1, visibleRows),
  };

  return (
    <nav
      className={`${styles.timelineNav}${cardOpen ? ` ${styles.timelineNavExpanded}` : ''}`}
      aria-label="对话轮次导航"
      onMouseLeave={() => setCardOpen(false)}
      onBlur={(event) => {
        const nextFocus = event.relatedTarget;
        if (nextFocus instanceof Node && event.currentTarget.contains(nextFocus)) return;
        setCardOpen(false);
      }}
    >
      <div
        className={styles.timelineCard}
        style={cardVars}
      >
        <div className={styles.timelineList} ref={listRef}>
          {renderedAnchors.map((anchor) => {
            const selected = anchor.messageId === activeId;
            const markerStyle: CSSProperties & { '--timeline-marker-width': string } = {
              '--timeline-marker-width': `${anchor.markerWidthEm}em`,
            };
            return (
              <button
                key={anchor.messageId}
                type="button"
                className={`${styles.timelineMarker}${selected ? ` ${styles.timelineMarkerActive}` : ''}`}
                style={markerStyle}
                aria-label={`跳转到 ${anchor.label}`}
                title={anchor.label}
                onFocus={() => setCardOpen(true)}
                onClick={() => jumpTo(anchor)}
              >
                <span className={styles.timelineLabel}>{anchor.label}</span>
                <span
                  className={styles.timelineLine}
                  aria-hidden="true"
                  onMouseEnter={() => setCardOpen(true)}
                />
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
});
