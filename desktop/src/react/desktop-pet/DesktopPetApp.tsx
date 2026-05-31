import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import './desktop-pet.css';

type PetMood = 'idle' | 'thinking' | 'talking' | 'working' | 'happy' | 'error' | 'cute' | 'sad' | 'missing';

type DesktopPetState = {
  enabled: boolean;
  visible: boolean;
  backgroundOnly: boolean;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  scale: number;
  mood: PetMood;
  message: string;
  customImages?: Partial<Record<PetMood, string>>;
};

type PetChatStatus = 'idle' | 'connecting' | 'ready' | 'sending' | 'streaming' | 'error';

type PetChatSession = {
  path: string;
};

const moodLabels: Record<PetMood, string> = {
  idle: '待机中',
  thinking: '思考中',
  talking: '回复中',
  working: '工作中',
  happy: '完成啦',
  error: '遇到问题',
  cute: '撒娇中',
  sad: '哭泣中',
  missing: '思念中',
};

const idleMoods: PetMood[] = ['idle', 'cute', 'sad', 'missing'];
const PET_CHAT_PLACEHOLDER = '问问花子…';
const PET_CHAT_EMPTY = '在这里输入问题，不用打开主界面';
const PET_CHAT_MAX_CHARS = 260;
const PET_CHAT_BUBBLE_MAX_CHARS = 72;

function cleanPetChatText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[\s*#>-]+/gm, '')
    .replace(/\b(?:MOOD|mood|thinking|tool|status)\b[:：]?[^\n。！？!?]*/g, ' ')
    .replace(/[{}[\]"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactPetChatText(text: string): string {
  const normalized = cleanPetChatText(text);
  if (!normalized) return '';
  const sentences = normalized
    .split(/(?<=[。！？!?])\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
  const candidate = [...sentences].reverse().find((item) => item.length >= 8 && !/^(完成|完成啦|好了|好的)[。！？!?]?$/.test(item))
    || sentences[sentences.length - 1]
    || normalized;
  if (candidate.length <= PET_CHAT_BUBBLE_MAX_CHARS) return candidate;
  return `${candidate.slice(0, PET_CHAT_BUBBLE_MAX_CHARS - 1)}…`;
}

function petChatErrorMessage(message: string): string {
  if (/failed to fetch|fetch failed/i.test(message)) return '模型服务连接失败，请检查网络或 API 配置';
  if (/network|timeout|ECONN|ENOTFOUND|ETIMEDOUT/i.test(message)) return '网络连接失败，请稍后再试';
  return message || '提问失败了';
}

function fallbackState(): DesktopPetState {
  return {
    enabled: false,
    visible: false,
    backgroundOnly: true,
    alwaysOnTop: true,
    clickThrough: false,
    scale: 1,
    mood: 'idle',
    message: '',
    customImages: {},
  };
}

export function DesktopPetApp() {
  const [state, setState] = useState<DesktopPetState>(fallbackState);
  const [imageMood, setImageMood] = useState<PetMood>('idle');
  const [chatText, setChatText] = useState('');
  const [chatStatus, setChatStatus] = useState<PetChatStatus>('idle');
  const [chatBubble, setChatBubble] = useState(PET_CHAT_EMPTY);
  const [chatExpanded, setChatExpanded] = useState(false);
  const sessionRef = useRef<PetChatSession | null>(null);
  const responseRef = useRef('');
  const lastPreviewRef = useRef('');

  useEffect(() => {
    let mounted = true;
    window.platform?.desktopPetGetState?.().then((next) => {
      if (mounted && next) setState((prev) => ({ ...prev, ...next }));
    }).catch(() => {});
    const dispose = window.platform?.onDesktopPetState?.((next) => {
      setState((prev) => ({ ...prev, ...next }));
    });
    return () => {
      mounted = false;
      if (typeof dispose === 'function') dispose();
    };
  }, []);

  const statusText = useMemo(() => {
    if (idleMoods.includes(state.mood)) return moodLabels[imageMood] || moodLabels.idle;
    return state.message || moodLabels[state.mood] || moodLabels.idle;
  }, [imageMood, state.message, state.mood]);
  const imageSrc = useMemo(() => {
    const customImage = state.customImages?.[imageMood];
    if (customImage) return window.platform?.getFileUrl?.(customImage) || customImage;
    return `assets/desktop-pet/hanako/${imageMood}.png`;
  }, [imageMood, state.customImages]);
  const chatBusy = chatStatus === 'connecting' || chatStatus === 'sending' || chatStatus === 'streaming';
  const chatHint = useMemo(() => {
    if (chatStatus === 'connecting') return '连接中…';
    if (chatStatus === 'sending') return '发送中…';
    if (chatStatus === 'streaming') return '回复中…';
    if (chatStatus === 'error') return '点这里重试';
    return PET_CHAT_PLACEHOLDER;
  }, [chatStatus]);

  useEffect(() => {
    if (!idleMoods.includes(state.mood)) {
      setImageMood(state.mood);
      return;
    }
    let index = Math.max(0, idleMoods.indexOf(state.mood));
    setImageMood(idleMoods[index]);
    const timer = window.setInterval(() => {
      index = (index + 1) % idleMoods.length;
      setImageMood(idleMoods[index]);
    }, 16000);
    return () => window.clearInterval(timer);
  }, [state.mood]);

  const handleDoubleClick = () => {
    window.platform?.desktopPetOpenMain?.();
  };

  const handleHide = () => {
    window.platform?.desktopPetSetState?.({ visible: false });
  };

  useEffect(() => {
    const dispose = window.platform?.onDesktopPetChatEvent?.((event) => {
      const msg = event as { type?: string; sessionPath?: string; isStreaming?: boolean; delta?: string; message?: string };
      if (msg?.sessionPath) sessionRef.current = { path: msg.sessionPath };
      if (msg?.type === 'status' && msg.isStreaming) {
        responseRef.current = '';
        lastPreviewRef.current = '';
        setChatBubble('正在思考中……');
        setChatStatus('streaming');
      } else if (msg?.type === 'text_delta' || msg?.type === 'mood_text') {
        responseRef.current += msg.delta || '';
        const preview = compactPetChatText(responseRef.current);
        if (preview) {
          lastPreviewRef.current = preview;
          setChatBubble(preview);
        }
        else setChatBubble('回复中……');
        setChatStatus('streaming');
      } else if (msg?.type === 'thinking_start') {
        setChatBubble('正在思考中……');
        setChatStatus('streaming');
      } else if (msg?.type === 'tool_start') {
        setChatBubble('正在处理工具任务……');
        setChatStatus('streaming');
      } else if (msg?.type === 'turn_end') {
        const preview = compactPetChatText(responseRef.current) || lastPreviewRef.current;
        if (preview) setChatBubble(preview);
        setChatStatus('ready');
      } else if (msg?.type === 'status' && msg.isStreaming === false) {
        setChatStatus('ready');
      } else if (msg?.type === 'error') {
        setChatBubble(petChatErrorMessage(msg.message || '提问失败了'));
        setChatStatus('error');
      }
    });
    return () => {
      if (typeof dispose === 'function') dispose();
    };
  }, []);

  const handleChatSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = chatText.trim();
    if (!text || chatBusy) return;
    responseRef.current = '';
    lastPreviewRef.current = '';
    setChatText('');
    setChatExpanded(true);
    setChatStatus('sending');
    setChatBubble('已收到，正在思考……');
    try {
      const result = await window.platform?.desktopPetSendPrompt?.(text);
      if (result?.sessionPath) sessionRef.current = { path: result.sessionPath };
    } catch (err) {
      const message = err instanceof Error ? err.message : '连接失败了';
      setChatBubble(petChatErrorMessage(message));
      setChatStatus('error');
    }
  };

  return (
    <main className="desktop-pet" data-mood={imageMood} style={{ ['--pet-scale' as string]: state.scale }} onDoubleClick={handleDoubleClick}>
      <section className="desktop-pet__stage" aria-label="HanakoPro 桌宠">
        <div className={`desktop-pet__chat-bubble ${chatExpanded || chatBubble !== PET_CHAT_EMPTY ? 'desktop-pet__chat-bubble--visible' : ''}`} role="status">
          <div className="desktop-pet__chat-text">
            {chatBubble || statusText}
          </div>
        </div>
        <div className="desktop-pet__status" role="status">
          {statusText}
        </div>
        <button className="desktop-pet__hide" type="button" title="隐藏桌宠" aria-label="隐藏桌宠" onClick={handleHide}>×</button>
        <img
          className="desktop-pet__avatar"
          src={imageSrc}
          alt="HanakoPro"
          draggable={false}
          onError={() => setImageMood('idle')}
        />
        <div className="desktop-pet__shadow" />
        <form className={`desktop-pet__composer ${chatExpanded ? 'desktop-pet__composer--expanded' : ''}`} onSubmit={handleChatSubmit} onDoubleClick={(event) => event.stopPropagation()}>
          <input
            className="desktop-pet__input"
            value={chatText}
            maxLength={PET_CHAT_MAX_CHARS}
            placeholder={chatHint}
            disabled={chatBusy}
            onFocus={() => setChatExpanded(true)}
            onBlur={() => {
              if (!chatText.trim()) window.setTimeout(() => setChatExpanded(false), 180);
            }}
            onChange={(event) => setChatText(event.target.value)}
          />
          <button className="desktop-pet__send" type="submit" disabled={!chatText.trim() || chatBusy} aria-label="发送问题">
            {chatBusy ? '…' : '↵'}
          </button>
        </form>
      </section>
    </main>
  );
}
