import { useEffect, useRef, useState } from 'react';
import { IconRocket, IconSend } from '@tabler/icons-react';
import { getUserPlanFeatures } from '@common';
import type { PublicUser } from '@common';
import { api } from '../../lib/api';
import { Card, CardBody, CardHeader } from '../common';
import './AssistantPanel.css';

type Message = { id: string; role: 'user' | 'assistant'; content: string };

const VARIANT_LABELS: Record<string, string> = {
  nano: 'Nano',
  lite: 'Lite',
  standard: 'Standard',
  plus: 'Plus',
  turbo: 'Turbo',
  ultra: 'Ultra',
};

export const AssistantPanel = () => {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [selectedTier, setSelectedTier] = useState<string>('nano');
  const [isTierOpen, setIsTierOpen] = useState(false);
  const tierRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { id: 'welcome', role: 'assistant', content: "Hi! I'm your Ayphr Assistant. Ask me anything about your data." },
  ]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.users.me();
        if (!cancelled) {
          setUser(data.user);
          const features = getUserPlanFeatures(data.user);
          const variants = features.availableAssistantVariants;
          setSelectedTier(variants[0] ?? 'nano');
        }
      } catch {
        // Ignore errors; the panel remains usable in a read-only state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const features = user ? getUserPlanFeatures(user) : null;
  const variants = features?.availableAssistantVariants ?? ['nano'];

  useEffect(() => {
    if (!isTierOpen) return;
    const handler = (event: MouseEvent) => {
      if (tierRef.current && !tierRef.current.contains(event.target as Node)) {
        setIsTierOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isTierOpen]);

  const handleSend = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    setMessages((prev) => [...prev, { id: `${Date.now()}`, role: 'user', content: trimmed }]);
    setInput('');
  };

  return (
    <div className="assistant">
      <Card className="assistant__card" elevated>
        <CardHeader>
          <h2>Assistant</h2>
          <p>Chat with your Ayphr Assistant</p>
        </CardHeader>
        <CardBody>
          <div className="assistant__messages" role="log" aria-live="polite">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`assistant__message assistant__message--${message.role}`}
              >
                <div className="assistant__bubble">{message.content}</div>
              </div>
            ))}
          </div>

          <form className="assistant__composer" onSubmit={handleSend}>
            <textarea
              className="assistant__input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Message Assistant..."
              rows={2}
            />
            <div className="assistant__composer-row">
              <div className="assistant__tier-selector" ref={tierRef}>
                <span className="assistant__tier-label">Assistant tier</span>
                <button
                  type="button"
                  className="assistant__tier-trigger"
                  onClick={() => setIsTierOpen((open) => !open)}
                  aria-haspopup="listbox"
                  aria-expanded={isTierOpen}
                >
                  <span>{VARIANT_LABELS[selectedTier] ?? selectedTier}</span>
                  {selectedTier === 'ultra' && (
                    <span className="assistant__ultra-badge">
                      <IconRocket size={14} />
                      Up to 15x more usage
                    </span>
                  )}
                </button>
                {isTierOpen && (
                  <div className="assistant__tier-menu" role="listbox">
                    {variants.map((variant) => (
                      <button
                        key={variant}
                        type="button"
                        role="option"
                        aria-selected={selectedTier === variant}
                        className={`assistant__tier-option ${selectedTier === variant ? 'assistant__tier-option--selected' : ''}`}
                        onClick={() => {
                          setSelectedTier(variant);
                          setIsTierOpen(false);
                        }}
                      >
                        <span>{VARIANT_LABELS[variant] ?? variant}</span>
                        {variant === 'ultra' && (
                          <span className="assistant__ultra-badge">
                            <IconRocket size={14} />
                            Up to 15x more usage
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button type="submit" className="assistant__send" aria-label="Send message">
                <IconSend size={18} />
              </button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
};