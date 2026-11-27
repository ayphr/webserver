import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import {
  IconArrowUp,
  IconCommand,
  IconMicrophone,
  IconCornerDownLeft,
  IconKey,
  IconPlayerStop,
} from '@tabler/icons-react';
import type {
  AssistantContextUsage,
  AssistantSendShortcut,
  AssistantVariant,
} from '@common';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import { AssistantDropdown } from '../common';
import { ContextGauge } from './ContextGauge';
import './AssistantComposer.css';

type SpeechRecognitionResultLike = {
  0: { transcript: string };
  isFinal: boolean;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: Record<number, SpeechRecognitionResultLike> & { length: number };
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult?: (event: SpeechRecognitionEventLike) => void;
  onend?: () => void;
  onerror?: (event?: { error?: string }) => void;
  start(): void;
  stop(): void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const speechErrorMessage = (code?: string) => {
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return 'Microphone permission was denied. Speech input is unavailable.';
  }
  if (code === 'audio-capture' || code === 'no-speech') {
    return 'No microphone was available. You can type your message instead.';
  }
  return 'Speech input stopped unexpectedly. You can type your message instead.';
};

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
  webkitAudioContext?: typeof AudioContext;
};

export interface AssistantComposerProps {
  placeholder?: string;
  value: string;
  onValueChange: (value: string) => void;
  variant: AssistantVariant;
  onVariantChange: (variant: AssistantVariant) => void;
  availableVariants: AssistantVariant[];
  isChat: boolean;
  isGenerating: boolean;
  sendShortcut: AssistantSendShortcut;
  isMac: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  dataShared: boolean;
  onSend: () => void;
  onQueue: () => void;
  contextUsage?: AssistantContextUsage;
  onCompact?: () => void;
  showContextGauge?: boolean;
  isCompacting?: boolean;
}

export const AssistantComposer = ({
  placeholder = 'Ask Iris',
  value,
  onValueChange,
  variant,
  onVariantChange,
  availableVariants,
  isChat,
  isGenerating,
  sendShortcut,
  isMac,
  textareaRef,
  dataShared,
  onSend,
  onQueue,
  contextUsage,
  onCompact,
  showContextGauge = false,
  isCompacting = false,
}: AssistantComposerProps) => {
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const previousHeight = el.offsetHeight;
    el.style.transition = 'none';
    el.style.height = 'auto';
    const nextHeight = el.scrollHeight;
    el.style.height = `${previousHeight}px`;
    void el.offsetHeight;
    el.style.transition = 'height 0.2s ease';
    el.style.height = `${nextHeight}px`;
  }, [value, textareaRef]);

  const prefersReducedMotion = usePrefersReducedMotion();
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [levels, setLevels] = useState<number[]>([0.2, 0.2, 0.2, 0.2]);
  const listeningRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseValueRef = useRef(value);
  const transcriptRef = useRef('');
  const lastDictatedValueRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const speechWindow = typeof window === 'undefined' ? null : (window as SpeechWindow);
  const supported = Boolean(
    speechWindow?.SpeechRecognition || speechWindow?.webkitSpeechRecognition,
  );

  const setListeningState = (next: boolean) => {
    listeningRef.current = next;
    setListening(next);
  };

  const startAudio = async () => {
    if (prefersReducedMotion) {
      setLevels([0.4, 0.4, 0.4, 0.4]);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const AudioContextConstructor = window.AudioContext || speechWindow?.webkitAudioContext;
      if (!AudioContextConstructor) return;
      const context = new AudioContextConstructor();
      audioContextRef.current = context;
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(data);
        const bars = 4;
        const step = Math.floor(data.length / bars);
        const next = Array.from({ length: bars }, (_, i) => {
          let sum = 0;
          for (let j = 0; j < step; j += 1) sum += data[i * step + j] ?? 0;
          const avg = sum / step / 255;
          return Math.max(0.15, Math.min(1, avg * 1.8 + 0.1));
        });
        setLevels(next);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setSpeechError('Microphone access was blocked. You can type your message instead.');
    }
  };

  const stopAudio = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    analyserRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    setLevels([0.2, 0.2, 0.2, 0.2]);
  };

  /** Drop any dictated text from the draft so it cannot leak into the next send. */
  const resetSpeechDraft = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    stopAudio();
    baseValueRef.current = '';
    transcriptRef.current = '';
    lastDictatedValueRef.current = null;
    setListeningState(false);
  };

  const startListening = () => {
    if (!supported) return;
    const SR = speechWindow?.SpeechRecognition ?? speechWindow?.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    baseValueRef.current = value;
    transcriptRef.current = '';
    lastDictatedValueRef.current = null;
    setSpeechError(null);
    rec.onresult = (event) => {
      let final = transcriptRef.current;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += `${t} `;
        else interim += t;
      }
      transcriptRef.current = final;
      const next = `${baseValueRef.current} ${final}${interim}`.trim();
      lastDictatedValueRef.current = next;
      onValueChange(next);
    };
    rec.onend = () => {
      setListeningState(false);
      stopAudio();
    };
    rec.onerror = (event) => {
      setSpeechError(speechErrorMessage(event?.error));
      baseValueRef.current = '';
      transcriptRef.current = '';
      setListeningState(false);
      stopAudio();
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      setListeningState(true);
      void startAudio();
    } catch {
      setSpeechError(speechErrorMessage());
      setListeningState(false);
    }
  };

  const stopListening = () => resetSpeechDraft();

  useEffect(() => {
    if (lastDictatedValueRef.current === value) {
      // This change came from recognition itself; keep its running transcript.
      lastDictatedValueRef.current = null;
      return;
    }
    // Any other edit (including clearing the draft) becomes the new base text.
    baseValueRef.current = value;
    transcriptRef.current = '';
    if (!value && listeningRef.current) resetSpeechDraft();
    // resetSpeechDraft is intentionally excluded: reacting to its identity would
    // restart the draft on every render while speech is active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      stopAudio();
      listeningRef.current = false;
    };
  }, []);

  const handleSendClick = () => {
    resetSpeechDraft();
    onSend();
  };

  const handleQueueClick = () => {
    resetSpeechDraft();
    onQueue();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && listeningRef.current) {
      e.preventDefault();
      stopListening();
      return;
    }
    if (e.key !== 'Enter') return;
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      handleQueueClick();
      return;
    }
    const shouldSend = sendShortcut === 'enter' ? !e.shiftKey : e.shiftKey;
    if (!shouldSend) return;
    e.preventDefault();
    handleSendClick();
  };

  return (
    <>
      <div className="assistant-input__box assistant-input__box--multiline">
        <textarea
          ref={textareaRef}
          className="assistant-input__textarea"
          placeholder={placeholder}
          aria-label="Message Iris"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <div className="assistant-input__footer">
          <AssistantDropdown
            value={variant}
            onChange={onVariantChange}
            availableVariants={availableVariants}
          />
          {isChat && isGenerating && value.trim() && (
            <span
              className="assistant-input__queue-hint"
              title={isMac ? 'Queue with ⌘ + Enter' : 'Queue with Ctrl + Enter'}
            >
              <span className="sr-only">
                {isMac ? 'Queue with Command Enter' : 'Queue with Control Enter'}
              </span>
              {isMac ? (
                <IconCommand aria-hidden="true" size={13} strokeWidth={1.75} />
              ) : (
                <IconKey aria-hidden="true" size={13} strokeWidth={1.75} />
              )}
              <IconCornerDownLeft aria-hidden="true" size={13} strokeWidth={1.75} />
            </span>
          )}
          {showContextGauge && onCompact && (
            <ContextGauge
              usage={contextUsage}
              onCompact={onCompact}
              disabled={isCompacting || isGenerating}
            />
          )}
          {supported && (
            listening ? (
              <div className="assistant-input__listening">
                <span className="sr-only" role="status">
                  Listening for speech. Press Escape or stop listening when finished.
                </span>
                <span className="assistant-input__visualizer" aria-hidden="true">
                  {levels.map((level, index) => (
                    <span
                      key={index}
                      style={{
                        height: `${Math.max(4, (prefersReducedMotion ? 0.4 : level) * 16)}px`,
                      }}
                    />
                  ))}
                </span>
                <button
                  type="button"
                  className="assistant-input__stop"
                  aria-label="Stop listening"
                  onClick={stopListening}
                >
                  <IconPlayerStop aria-hidden="true" size={14} strokeWidth={2} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="assistant-input__mic"
                aria-label="Start speech to text"
                onClick={startListening}
              >
                <IconMicrophone aria-hidden="true" size={16} strokeWidth={2} />
              </button>
            )
          )}
          <button
            type="button"
            className={`assistant-input__send ${isGenerating ? 'assistant-input__send--stop' : ''}`}
            aria-label={isGenerating ? 'Stop generating' : 'Send message'}
            title={!isGenerating && !value.trim() ? 'Type a message to send' : undefined}
            disabled={!isGenerating && !value.trim()}
            onClick={handleSendClick}
          >
            {isGenerating ? (
              <IconPlayerStop aria-hidden="true" size={16} strokeWidth={2} />
            ) : (
              <IconArrowUp aria-hidden="true" size={18} strokeWidth={2} />
            )}
          </button>
        </div>
      </div>
      <p className="assistant-input__speech-error" role="status" aria-live="polite">
        {speechError ?? '\u00A0'}
      </p>
      <p className="assistant-input__disclaimer">
        Iris is AI. By using it, you agree to our{' '}
        <Link to="/policies/terms">Terms</Link> &amp;{' '}
        <Link to="/policies/privacy">Privacy Policy</Link>.{' '}
        {dataShared
          ? 'Chats may be reviewed and used to improve our AI models and enforce the Terms.'
          : 'Chats may be reviewed to enforce the Terms.'}
      </p>
    </>
  );
};
