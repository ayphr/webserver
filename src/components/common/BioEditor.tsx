import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClipboardEvent, DragEvent, ReactNode } from 'react';
import {
  IconBlockquote,
  IconBold,
  IconCode,
  IconItalic,
  IconLink,
  IconList,
  IconListNumbers,
} from '@tabler/icons-react';
import { BIO_MAX_LENGTH, bioMarkdownToHtml, sanitizeBioUrl } from '../../../common';
import { htmlToBioMarkdown, sanitizeEditorHtml } from '../../lib/bio';
import './BioEditor.css';

type EditorCommand = 'bold' | 'italic' | 'insertUnorderedList' | 'insertOrderedList' | 'formatBlock' | 'createLink' | 'unlink';

type ToolbarItem = {
  kind: 'command';
  command: EditorCommand;
  label: string;
  icon: ReactNode;
  /** Tag for `formatBlock`, e.g. `pre`. */
  value?: string;
};

const TOOLBAR: ToolbarItem[] = [
  { kind: 'command', command: 'bold', label: 'Bold', icon: <IconBold size={16} /> },
  { kind: 'command', command: 'italic', label: 'Italic', icon: <IconItalic size={16} /> },
  { kind: 'command', command: 'insertUnorderedList', label: 'Bulleted list', icon: <IconList size={16} /> },
];

const MARKDOWN_TOOLBAR: ToolbarItem[] = [
  { kind: 'command', command: 'insertOrderedList', label: 'Numbered list', icon: <IconListNumbers size={16} /> },
  { kind: 'command', command: 'formatBlock', label: 'Quote', value: 'blockquote', icon: <IconBlockquote size={16} /> },
  { kind: 'command', command: 'formatBlock', label: 'Code block', value: 'pre', icon: <IconCode size={16} /> },
  { kind: 'command', command: 'createLink', label: 'Link', icon: <IconLink size={16} /> },
];

const BLOCK_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'h1', label: 'Heading' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h3', label: 'Heading 3' },
  { value: 'p', label: 'Paragraph' },
];

export interface BioEditorProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  labelledBy?: string;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  /** Whether the full markdown dialect is available to this editor. */
  markdownEnabled?: boolean;
  markdown?: boolean;
  onMarkdownChange?: (markdown: boolean) => void;
}

export const BioEditor = ({
  value,
  onChange,
  id,
  labelledBy,
  placeholder = 'Tell people a little about yourself',
  disabled = false,
  maxLength = BIO_MAX_LENGTH,
  markdownEnabled = false,
  markdown = false,
  onMarkdownChange,
}: BioEditorProps) => {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef(value);
  const isEditingRef = useRef(false);
  const savedRangeRef = useRef<Range | null>(null);
  const [activeCommands, setActiveCommands] = useState<Record<string, boolean>>({});
  const [isLinkRowOpen, setIsLinkRowOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const refreshActiveCommands = useCallback(() => {
    const next: Record<string, boolean> = {};

    for (const item of [...TOOLBAR, ...MARKDOWN_TOOLBAR]) {
      if (item.kind !== 'command' || item.command === 'formatBlock') continue;

      try {
        next[item.command] = document.queryCommandState(item.command);
      } catch {
        next[item.command] = false;
      }
    }

    setActiveCommands((current) => (
      Object.keys(next).every((command) => !!current[command] === next[command]) ? current : next
    ));
  }, []);

  // Keep Enter producing paragraphs and emphasis as <b>/<i>, so the surface
  // maps 1:1 onto bio blocks.
  useEffect(() => {
    try {
      document.execCommand('styleWithCSS', false, 'false');
      document.execCommand('defaultParagraphSeparator', false, 'p');
    } catch {
      // Unsupported browsers simply keep their own defaults.
    }

    const handleSelectionChange = () => {
      if (isEditingRef.current) refreshActiveCommands();
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [refreshActiveCommands]);

  // Never touch the DOM while the user is typing, or the caret jumps.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || isEditingRef.current) return;

    const next = bioMarkdownToHtml(value, markdown);
    if (surface.innerHTML !== next) {
      surface.innerHTML = next;
    }
  }, [value, markdown]);

  const syncFromSurface = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const next = htmlToBioMarkdown(surface.innerHTML, markdown);
    if (next === valueRef.current) return;

    valueRef.current = next;
    onChange(next);
  }, [markdown, onChange]);

  const runCommand = (command: EditorCommand) => {
    const surface = surfaceRef.current;
    if (!surface || disabled) return;

    isEditingRef.current = true;
    surface.focus();
    restoreSelection(surface, savedRangeRef.current);
    document.execCommand(command);
    syncFromSurface();
    refreshActiveCommands();
  };

  const formatBlock = (tag: string) => {
    const surface = surfaceRef.current;
    if (!surface) return;

    isEditingRef.current = true;
    surface.focus();
    restoreSelection(surface, savedRangeRef.current);

    // Chrome wants angle brackets, Firefox does not.
    if (!document.execCommand('formatBlock', false, `<${tag}>`)) {
      document.execCommand('formatBlock', false, tag);
    }

    syncFromSurface();
    refreshActiveCommands();
  };

  const handleFocus = () => {
    isEditingRef.current = true;
    refreshActiveCommands();
  };

  const handleBlur = () => {
    isEditingRef.current = false;
    setActiveCommands({});

    const surface = surfaceRef.current;
    if (!surface) return;

    const safe = sanitizeEditorHtml(surface.innerHTML, markdown);
    if (surface.innerHTML !== safe) {
      surface.innerHTML = safe;
    }
    syncFromSurface();
  };

  const handleInput = () => {
    syncFromSurface();
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();

    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;

    // Pasting as plain text is what keeps links, headings and styling out.
    text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .forEach((line, index) => {
        if (index > 0) document.execCommand('insertParagraph');
        if (line.length > 0) document.execCommand('insertText', false, line);
      });

    syncFromSurface();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const openLinkRow = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      savedRangeRef.current = selection.getRangeAt(0).cloneRange();
    }

    const anchor = findAnchor(selection?.anchorNode ?? null);
    setLinkValue(anchor?.getAttribute('href') ?? '');
    setLinkError(null);
    setIsLinkRowOpen(true);
  };

  const applyLink = () => {
    const href = sanitizeBioUrl(linkValue);

    if (!href) {
      setLinkError('Enter an http(s) link');
      return;
    }

    const surface = surfaceRef.current;
    if (!surface) return;

    isEditingRef.current = true;
    surface.focus();
    restoreSelection(surface, savedRangeRef.current);

    const selection = window.getSelection();
    const hasTextSelection = !!selection && !selection.isCollapsed;

    if (hasTextSelection) {
      document.execCommand('createLink', false, href);
    } else {
      document.execCommand('insertText', false, href);
      linkLastInsertedText(href);
    }

    setIsLinkRowOpen(false);
    setLinkError(null);
    syncFromSurface();
    refreshActiveCommands();
  };

  const removeLink = () => {
    const surface = surfaceRef.current;
    if (!surface) return;

    isEditingRef.current = true;
    surface.focus();
    restoreSelection(surface, savedRangeRef.current);
    document.execCommand('unlink');
    setIsLinkRowOpen(false);
    syncFromSurface();
  };

  const toolbar = markdown ? [...TOOLBAR, ...MARKDOWN_TOOLBAR] : TOOLBAR;
  const isEmpty = value.trim().length === 0;
  const isOverLimit = value.length > maxLength;

  return (
    <div className="bio-editor">
      <div className="bio-editor__toolbar" role="toolbar" aria-label="Bio formatting">
        {markdown && (
          <select
            className="bio-editor__blockSelect"
            aria-label="Block style"
            value=""
            disabled={disabled}
            onChange={(event) => {
              const tag = event.target.value;
              if (tag) formatBlock(tag);
              event.target.value = '';
            }}
          >
            <option value="">Block</option>
            {BLOCK_OPTIONS.map(({ value: blockValue, label }) => (
              <option key={blockValue} value={blockValue}>
                {label}
              </option>
            ))}
          </select>
        )}

        {toolbar.map((item) => {
          if (item.kind === 'command') {
            if (item.command === 'createLink') {
              return (
                <button
                  key="createLink"
                  type="button"
                  className={`bio-editor__tool ${isLinkRowOpen ? 'is-active' : ''}`}
                  aria-label="Link"
                  aria-pressed={isLinkRowOpen}
                  title="Link"
                  disabled={disabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={openLinkRow}
                >
                  {item.icon}
                </button>
              );
            }

            return (
              <button
                key={item.command === 'formatBlock' ? `formatBlock-${item.value}` : item.command}
                type="button"
                className={`bio-editor__tool ${activeCommands[item.command] ? 'is-active' : ''}`}
                aria-label={item.label}
                aria-pressed={!!activeCommands[item.command]}
                title={item.label}
                disabled={disabled}
                // Keep the caret in place while the button takes the click.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (item.command === 'formatBlock') {
                    formatBlock(item.value ?? 'p');
                    return;
                  }
                  runCommand(item.command);
                }}
              >
                {item.icon}
              </button>
            );
          }

          return null;
        })}
      </div>

      {isLinkRowOpen && (
        <div className="bio-editor__linkRow">
          <input
            className={`bio-editor__linkInput ${linkError ? 'is-error' : ''}`}
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={linkValue}
            placeholder="https://example.com"
            disabled={disabled}
            onChange={(event) => {
              setLinkValue(event.target.value);
              setLinkError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setIsLinkRowOpen(false);
              }
            }}
          />
          <button
            type="button"
            className="bio-editor__linkButton"
            onMouseDown={(event) => event.preventDefault()}
            onClick={applyLink}
            disabled={disabled}
          >
            Apply
          </button>
          <button
            type="button"
            className="bio-editor__linkButton"
            onMouseDown={(event) => event.preventDefault()}
            onClick={removeLink}
            disabled={disabled}
          >
            Remove
          </button>
        </div>
      )}

      {linkError && <p className="bio-editor__linkError">{linkError}</p>}

      <div
        id={id}
        ref={surfaceRef}
        className={`bio-editor__surface ${isEmpty ? 'is-empty' : ''}`}
        data-placeholder={placeholder}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelledBy}
        aria-disabled={disabled}
        spellCheck
        onFocus={handleFocus}
        onBlur={handleBlur}
        onInput={handleInput}
        onKeyUp={refreshActiveCommands}
        onMouseUp={refreshActiveCommands}
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={(event) => event.preventDefault()}
      />

      <div className="bio-editor__footer">
        {markdownEnabled ? (
          <label className="bio-editor__toggle">
            <input
              type="checkbox"
              checked={markdown}
              disabled={disabled}
              onChange={(event) => onMarkdownChange?.(event.target.checked)}
            />
            <span>Markdown</span>
          </label>
        ) : (
          <span className="bio-editor__hint">Bold, italic and bullet points only</span>
        )}

        <span className={`bio-editor__counter ${isOverLimit ? 'is-over' : ''}`}>
          {value.length}/{maxLength}
        </span>
      </div>
    </div>
  );
};

function findAnchor(node: Node | null): HTMLElement | null {
  let current: Node | null = node;

  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE && (current as Element).tagName === 'A') {
      return current as HTMLElement;
    }
    current = current.parentNode;
  }

  return null;
}

/**
 * The link row and toolbar take focus away from the surface, so the selection
 * is captured before the click and restored before the command runs.
 */
function restoreSelection(surface: HTMLElement, saved: Range | null) {
  if (!saved) return;

  const selection = window.getSelection();
  if (!selection) return;

  if (!surface.contains(saved.commonAncestorContainer)) return;

  selection.removeAllRanges();
  selection.addRange(saved);
}

function linkLastInsertedText(text: string) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const current = selection.getRangeAt(0);
  const container = current.startContainer;

  if (container.nodeType !== Node.TEXT_NODE) return;

  const start = Math.max(0, current.startOffset - text.length);
  current.setStart(container, start);

  selection.removeAllRanges();
  selection.addRange(current);
  document.execCommand('createLink', false, sanitizeBioUrl(text) ?? text);
}
