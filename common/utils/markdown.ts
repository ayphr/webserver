export type MarkdownFormat = 'limited' | 'markdown';

export const BIO_MAX_LENGTH = 200;
export const BIO_MAX_SOURCE_LENGTH = 4000;

export const DEFAULT_BIO = "Hi! I'm an Ayphr user";

export type MarkdownInline =
  | { kind: 'text'; value: string }
  | { kind: 'bold'; children: MarkdownInline[] }
  | { kind: 'italic'; children: MarkdownInline[] }
  | { kind: 'strike'; children: MarkdownInline[] }
  | { kind: 'code'; value: string };

export type MarkdownBlock =
  | { kind: 'line'; inlines: MarkdownInline[] }
  | { kind: 'bullets'; items: MarkdownInline[][] }
  | { kind: 'codeBlock'; code: string };

export type MarkdownToken =
  | { kind: 'text'; value: string }
  | { kind: 'marker'; value: string }
  | { kind: 'visibleMarker'; value: string }
  | { kind: 'bold'; open: string; close: string; children: MarkdownToken[] }
  | { kind: 'italic'; open: string; close: string; children: MarkdownToken[] }
  | { kind: 'strike'; open: string; close: string; children: MarkdownToken[] }
  | { kind: 'code'; open: string; close: string; value: string }
  | { kind: 'codeBlock'; value: string };

const BULLET_LINE = /^\s*[-*+]\s+(.*)$/;
const CODE_FENCE = /^(`{3,})([^`]*)$/;
const MARKER_ALLOWED_BEFORE = /[\s([{<,.;:!?'"]/;
const MARKER_ALLOWED_AFTER = /[\s.,;:!?'")\]}>]/;
const CLOSABLE_MARKER = /[^\s]/;
const LIMITED_ESCAPED = /([*\\])/g;
const MARKDOWN_ESCAPED = /([*\\`~])/g;

const LIMITED_ESCAPABLE = '*\\';
const MARKDOWN_ESCAPABLE = '*\\`~';

function readDelimited(text: string, start: number, open: string, close: string, closable: boolean): { value: string; end: number } | null {
  const contentStart = start + open.length;

  if (contentStart >= text.length) return null;
  if (closable && /\s/.test(text[contentStart] ?? '')) return null;

  for (let i = contentStart + 1; i < text.length; i += 1) {
    if (!text.startsWith(close, i)) continue;

    const value = text.slice(contentStart, i);
    if (closable) {
      if (!CLOSABLE_MARKER.test(text[i - 1] ?? '')) continue;

      const after = text[i + close.length];
      if (after !== undefined && !MARKER_ALLOWED_AFTER.test(after)) continue;
    }

    return { value, end: i + close.length };
  }

  return null;
}

function lexInline(text: string, extended: boolean): MarkdownToken[] {
  const escapable = extended ? MARKDOWN_ESCAPABLE : LIMITED_ESCAPABLE;
  const tokens: MarkdownToken[] = [];
  let buffer = '';
  let index = 0;

  const flush = () => {
    if (buffer.length > 0) {
      tokens.push({ kind: 'text', value: buffer });
      buffer = '';
    }
  };

  const opensMarker = () => index === 0 || MARKER_ALLOWED_BEFORE.test(text[index - 1] ?? '');

  const pushDelimited = <K extends 'bold' | 'italic' | 'strike'>(kind: K, open: string, close: string) => {
    const found = readDelimited(text, index, open, close, true);
    if (!found) return false;

    const children = lexInline(found.value, extended);
    flush();

    if (children.length > 0) {
      tokens.push({ kind, open, close, children });
    } else {
      buffer += `${open}${found.value}${close}`;
    }

    index = found.end;
    return true;
  };

  while (index < text.length) {
    const char = text[index] ?? '';

    if (char === '\\' && index + 1 < text.length && escapable.includes(text[index + 1] ?? '')) {
      flush();
      tokens.push({ kind: 'marker', value: '\\' });
      buffer += text[index + 1];
      index += 2;
      continue;
    }

    if (char === '`') {
      const fence = text.startsWith('``', index) ? '``' : '`';
      const found = readDelimited(text, index, fence, fence, false);

      if (found) {
        const value = fence === '``' ? found.value.replace(/^ (.*) $/, '$1') : found.value;
        flush();
        tokens.push({ kind: 'code', open: fence, close: fence, value });
        index = found.end;
        continue;
      }
    }

    if (char === '~' && text.startsWith('~~', index) && opensMarker()) {
      if (pushDelimited('strike', '~~', '~~')) continue;
    }

    if (char === '*' && opensMarker()) {
      const pushed = text.startsWith('**', index)
        ? pushDelimited('bold', '**', '**')
        : pushDelimited('italic', '*', '*');

      if (pushed) continue;
    }

    buffer += char;
    index += 1;
  }

  flush();
  return tokens;
}

type BlockLex =
  | { type: 'line'; bullet: boolean; prefix: string; inlines: MarkdownToken[] }
  | { type: 'codeBlock'; open: string; close: string; code: string };

type Lexeme = { gap: number; block: BlockLex | null };

function lexBlocks(markdown: string, extended: boolean): Lexeme[] {
  const lines = (markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const lexemes: Lexeme[] = [];

  let cursor = 0;
  let hasLexeme = false;

  const gapTo = (index: number) => (hasLexeme ? index - cursor + 1 : index);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';

    if (extended) {
      const fence = new RegExp(CODE_FENCE).exec(line);
      if (fence?.[1]) {
        const marker = fence[1];
        const code: string[] = [];
        let close = index + 1;

        while (close < lines.length) {
          if ((lines[close] ?? '').trimEnd().startsWith(marker)) break;
          code.push(lines[close] ?? '');
          close += 1;
        }

        lexemes.push({
          gap: gapTo(index),
          block: { type: 'codeBlock', open: line, close: (lines[close] ?? marker).trimEnd(), code: code.join('\n') },
        });
        hasLexeme = true;
        cursor = close + 1;
        continue;
      }
    }

    const bullet = new RegExp(BULLET_LINE).exec(line);
    if (bullet?.[1] !== undefined) {
      lexemes.push({
        gap: gapTo(index),
        block: { type: 'line', bullet: true, prefix: line.slice(0, line.length - bullet[1].length), inlines: lexInline(bullet[1], extended) },
      });
      hasLexeme = true;
      cursor = index + 1;
      continue;
    }

    const blank = line.trim().length === 0;
    lexemes.push({ gap: gapTo(index), block: { type: 'line', bullet: false, prefix: blank ? line : '', inlines: blank ? [] : lexInline(line, extended) } });
    hasLexeme = true;
    cursor = index + 1;
  }

  lexemes.push({ gap: hasLexeme ? lines.length - cursor : lines.length - 1, block: null });
  return lexemes;
}

function lexMarkdown(markdown: string, extended: boolean): MarkdownToken[] {
  const tokens: MarkdownToken[] = [];

  for (const { gap, block } of lexBlocks(markdown, extended)) {
    if (gap > 0) {
      const previous = tokens[tokens.length - 1];
      if (previous?.kind === 'text') {
        previous.value += '\n'.repeat(gap);
      } else {
        tokens.push({ kind: 'text', value: '\n'.repeat(gap) });
      }
    }

    if (!block) continue;

    if (block.type === 'codeBlock') {
      tokens.push({ kind: 'visibleMarker', value: `${block.open}\n` }, { kind: 'codeBlock', value: block.code }, { kind: 'visibleMarker', value: `\n${block.close}` });
      continue;
    }

    if (block.prefix) {
      tokens.push({ kind: block.bullet ? 'visibleMarker' : 'marker', value: block.prefix });
    }

    tokens.push(...block.inlines);
  }

  return tokens;
}

function tokensToInlines(tokens: MarkdownToken[]): MarkdownInline[] {
  const inlines: MarkdownInline[] = [];

  for (const token of tokens) {
    if (token.kind === 'text') {
      inlines.push({ kind: 'text', value: token.value });
      continue;
    }

    if (token.kind === 'marker' || token.kind === 'visibleMarker' || token.kind === 'codeBlock') continue;

    if (token.kind === 'code') {
      if (token.value) inlines.push({ kind: 'code', value: token.value });
      continue;
    }

    const children = tokensToInlines(token.children);
    if (children.length > 0) {
      inlines.push({ kind: token.kind, children });
    }
  }

  return inlines;
}

function parseMarkdown(markdown: string, extended: boolean): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];

  for (const { block } of lexBlocks(markdown, extended)) {
    if (!block) continue;

    if (block.type === 'codeBlock') {
      if (block.code.trim().length > 0) {
        blocks.push({ kind: 'codeBlock', code: block.code.replace(/\s+$/, '') });
      }
      continue;
    }

    const inlines = tokensToInlines(block.inlines);
    if (inlines.length === 0) continue;

    if (block.bullet) {
      const previous = blocks[blocks.length - 1];
      if (previous?.kind === 'bullets') {
        previous.items.push(inlines);
      } else {
        blocks.push({ kind: 'bullets', items: [inlines] });
      }
      continue;
    }

    blocks.push({ kind: 'line', inlines });
  }

  return blocks;
}

function escapeExtendedMarkdown(text: string): string {
  return text.replace(MARKDOWN_ESCAPED, String.raw`\$1`);
}

function escapeLimitedMarkdown(text: string): string {
  return text.replace(LIMITED_ESCAPED, String.raw`\$1`);
}

function escapeText(value: string, extended: boolean): string {
  if (extended) return escapeExtendedMarkdown(value);
  return escapeLimitedMarkdown(value);
}

function fenceFor(value: string, minimum: number): string {
  let longest = 0;

  for (const line of value.split('\n')) {
    const marker = new RegExp(/^\s*(`+)/).exec(line);
    if (marker?.[1]) longest = Math.max(longest, marker[1].length);
  }

  return '`'.repeat(Math.max(minimum, longest + 1));
}

function serializeInlines(inlines: MarkdownInline[], extended: boolean): string {
  return inlines
    .map((inline) => {
      if (inline.kind === 'text') return escapeText(inline.value, extended);
      if (inline.kind === 'code') {
        if (!extended) return inline.value;
        const fence = fenceFor(inline.value, 1);
        const padding = inline.value.startsWith('`') || inline.value.endsWith('`') ? ' ' : '';
        return `${fence}${padding}${inline.value}${padding}${fence}`;
      }

      const content = serializeInlines(inline.children, extended).trim();
      if (!content) return '';

      if (inline.kind === 'bold') return `**${content}**`;
      if (inline.kind === 'italic') return `*${content}*`;
      return extended ? `~~${content}~~` : content;
    })
    .join('');
}

function serializeMarkdown(blocks: MarkdownBlock[], extended: boolean): string {
  const lines: string[] = [];

  for (const block of blocks) {
    if (block.kind === 'codeBlock') {
      if (!extended) {
        lines.push(block.code.split('\n').map((line) => escapeText(line, false)).join('\n'));
        continue;
      }

      const fence = fenceFor(block.code, 3);
      lines.push(fence, block.code, fence);
      continue;
    }

    if (block.kind === 'bullets') {
      block.items.forEach((item) => {
        const content = serializeInlines(item, extended).trim();
        if (content) lines.push(`- ${content}`);
      });
      continue;
    }

    const content = serializeInlines(block.inlines, extended).trim();
    if (content) lines.push(content);
  }

  return lines.join('\n');
}

function inlineLength(inlines: MarkdownInline[]): number {
  return inlines.reduce((total, inline) => {
    if (inline.kind === 'text' || inline.kind === 'code') return total + inline.value.length;
    return total + inlineLength(inline.children);
  }, 0);
}

function visibleLength(blocks: MarkdownBlock[]): number {
  return blocks.reduce((total, block, index) => {
    const separator = index > 0 ? 1 : 0;

    if (block.kind === 'line') return total + separator + inlineLength(block.inlines);
    if (block.kind === 'codeBlock') return total + separator + block.code.length;

    const items = block.items.reduce((sum, item, itemIndex) => (
      sum + (itemIndex > 0 ? 1 : 0) + inlineLength(item)
    ), 0);

    return total + separator + items;
  }, 0);
}

export class Markdown {
  readonly source: string;
  readonly extended: boolean;

  private tokenCache?: MarkdownToken[];
  private blockCache?: MarkdownBlock[];

  constructor(source: string, extended = false) {
    this.source = source ?? '';
    this.extended = extended;
  }

  tokens(): MarkdownToken[] {
    if (!this.tokenCache) this.tokenCache = lexMarkdown(this.source, this.extended);
    return this.tokenCache;
  }

  blocks(): MarkdownBlock[] {
    if (!this.blockCache) this.blockCache = parseMarkdown(this.source, this.extended);
    return this.blockCache;
  }

  visibleLength(): number {
    return visibleLength(this.blocks());
  }

  sanitize(): string {
    return serializeMarkdown(this.blocks(), this.extended);
  }
}
