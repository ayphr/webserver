/**
 * Bios are stored as markdown, in one of two dialects.
 *
 * `limited` (everyone): `**bold**`, `*italic*` and `- ` bullet lines. Nothing
 * else is representable, so a regular user cannot author markup the renderer
 * does not support.
 *
 * `markdown` (staff only): adds `#` headings, `>` quotes, `1.` lists, fenced
 * code blocks, inline code, `~~strike~~` and links.
 *
 * Both dialects are parsed into a small AST and re-serialised from it, so what
 * is stored is always canonical and only ever contains markup the renderer
 * understands.
 */
export type BioFormat = 'limited' | 'markdown';

export const BIO_FORMATS: BioFormat[] = ['limited', 'markdown'];

export const BIO_MAX_LENGTH = 500;
export const BIO_MAX_LENGTH_MARKDOWN = 2000;
export const BIO_MAX_URL_LENGTH = 300;

export const DEFAULT_BIO = "Hi! I'm a Ayphr user";

export type BioHeadingLevel = 1 | 2 | 3;

export type BioInline =
  | { kind: 'text'; value: string }
  | { kind: 'bold'; children: BioInline[] }
  | { kind: 'italic'; children: BioInline[] }
  | { kind: 'strike'; children: BioInline[] }
  | { kind: 'code'; value: string }
  | { kind: 'link'; href: string; children: BioInline[] };

export type BioBlock =
  | { kind: 'line'; inlines: BioInline[] }
  | { kind: 'heading'; level: BioHeadingLevel; inlines: BioInline[] }
  | { kind: 'quote'; inlines: BioInline[] }
  | { kind: 'codeBlock'; lang: string; code: string }
  | { kind: 'bullets'; items: BioInline[][] }
  | { kind: 'ordered'; items: BioInline[][] };

const BULLET_LINE = /^\s*[-*+]\s+(.*)$/;
const ORDERED_LINE = /^\s*\d{1,9}[.)]\s+(.*)$/;
const HEADING_LINE = /^(#{1,6})\s+(.*)$/;
const QUOTE_LINE = /^>\s?(.*)$/;
const CODE_FENCE = /^(`{3,})([^`]*)$/;
const CODE_LANG = /^[a-z0-9+#._-]{1,16}$/i;
/** A marker may only open where a word just ended, so `2 * 3 * 4` stays plain. */
const MARKER_ALLOWED_BEFORE = /[\s([{<,.;:!?'"]/;
/** A closing marker may only end a word, so `**a**b` is not bold. */
const MARKER_ALLOWED_AFTER = /[\s.,;:!?'")\]}>]/;
const CLOSABLE_MARKER = /[^\s]/;
const BARE_URL = /https?:\/\/[^\s<>()]+/;
const TRAILING_URL_PUNCTUATION = /[.,;:!?'"]$/;
const LIMITED_ESCAPED = /([*\\])/g;
const MARKDOWN_ESCAPED = /([*\\`~[\]])/g;
const LABEL_ESCAPED = /([\\]])/g;

/**
 * Only http(s) links are ever stored, so a bio can never carry a `javascript:`
 * or `data:` URL. A bare host is upgraded to https.
 */
export function sanitizeBioUrl(value: string): string | null {
  const raw = value.trim();

  // Relative paths would resolve against a meaningless origin.
  if (!raw || raw.length > BIO_MAX_URL_LENGTH || raw.startsWith('/') || raw.startsWith('//') || /[\s<>]/.test(raw)) {
    return null;
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }

  return url.toString();
}

function readDelimited(text: string, start: number, marker: string, closable: boolean): { value: string; end: number } | null {
  const contentStart = start + marker.length;

  if (contentStart >= text.length) {
    return null;
  }

  if (closable && /\s/.test(text[contentStart] ?? '')) {
    return null;
  }

  for (let i = contentStart + 1; i < text.length; i += 1) {
    if (!text.startsWith(marker, i)) continue;

    const value = text.slice(contentStart, i);
    if (!closable) return { value, end: i + marker.length };

    if (!CLOSABLE_MARKER.test(text[i - 1] ?? '')) continue;

    const after = text[i + marker.length];
    if (after !== undefined && !MARKER_ALLOWED_AFTER.test(after)) continue;

    return { value, end: i + marker.length };
  }

  return null;
}

function readLink(text: string, start: number): { label: string; href: string; end: number } | null {
  const labelEnd = text.indexOf(']', start + 1);
  if (labelEnd < 0 || text[labelEnd + 1] !== '(') return null;

  const urlStart = labelEnd + 2;
  let depth = 1;

  for (let i = urlStart; i < text.length; i += 1) {
    const char = text[i];

    if (char === '\\' && i + 1 < text.length) {
      i += 1;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth === 0) {
      const href = sanitizeBioUrl(text.slice(urlStart, i));
      if (!href) return null;
      return { label: text.slice(start + 1, labelEnd), href, end: i + 1 };
    }
  }

  return null;
}

function readAngleUrl(text: string, start: number): { label: string; href: string; end: number } | null {
  const end = text.indexOf('>', start + 1);
  if (end < 0) return null;

  const label = text.slice(start + 1, end);
  const href = sanitizeBioUrl(label);
  return href ? { label, href, end: end + 1 } : null;
}

function parseInline(text: string, extended: boolean, allowBareLinks = true): BioInline[] {
  const inlines: BioInline[] = [];
  const escapable = extended ? '*\\`~[]<>_+#!-' : '*\\';
  let buffer = '';
  let index = 0;

  const flush = () => {
    if (buffer.length > 0) {
      inlines.push({ kind: 'text', value: buffer });
      buffer = '';
    }
  };

  const push = (inline: BioInline) => {
    flush();
    inlines.push(inline);
  };

  while (index < text.length) {
    const char = text[index] ?? '';

    if (char === '\\' && index + 1 < text.length && escapable.includes(text[index + 1] ?? '')) {
      buffer += text[index + 1];
      index += 2;
      continue;
    }

    if (extended && char === '`') {
      const marker = text[index] === '`' && text[index + 1] === '`' ? '``' : '`';
      const delimited = readDelimited(text, index, marker, false);

      if (delimited) {
        const value = marker === '``'
          ? delimited.value.replace(/^ (.*) $/, '$1')
          : delimited.value;

        if (value.length > 0) push({ kind: 'code', value });
        index = delimited.end;
        continue;
      }
    }

    if (extended && char === '~' && text.startsWith('~~', index) && (index === 0 || MARKER_ALLOWED_BEFORE.test(text[index - 1] ?? ''))) {
      const delimited = readDelimited(text, index, '~~', true);

      if (delimited) {
        const children = parseInline(delimited.value, extended);
        if (children.length > 0) push({ kind: 'strike', children });
        index = delimited.end;
        continue;
      }
    }

    if (char === '*' && (index === 0 || MARKER_ALLOWED_BEFORE.test(text[index - 1] ?? ''))) {
      const size = text.startsWith('**', index) ? 2 : 1;
      const delimited = readDelimited(text, index, '*'.repeat(size), true);

      if (delimited) {
        const children = parseInline(delimited.value, extended);
        if (children.length > 0) {
          push(size === 2 ? { kind: 'bold', children } : { kind: 'italic', children });
        }
        index = delimited.end;
        continue;
      }
    }

    if (extended && char === '[') {
      const link = readLink(text, index);
      if (link) {
        const children = parseInline(link.label, extended, false);
        push({ kind: 'link', href: link.href, children: children.length > 0 ? children : [{ kind: 'text', value: link.href }] });
        index = link.end;
        continue;
      }
    }

    if (extended && char === '<') {
      const angle = readAngleUrl(text, index);
      if (angle) {
        push({ kind: 'link', href: angle.href, children: [{ kind: 'text', value: angle.label }] });
        index = angle.end;
        continue;
      }
    }

    if (extended && allowBareLinks && (char === 'h' || char === 'H') && (index === 0 || MARKER_ALLOWED_BEFORE.test(text[index - 1] ?? ''))) {
      const raw = text.slice(index).match(BARE_URL)?.[0];

      if (raw) {
        let href = raw;

        // Sentence punctuation after a bare URL belongs to the sentence.
        while (href.length > 0 && TRAILING_URL_PUNCTUATION.test(href)) {
          href = href.slice(0, -1);
        }

        // A URL that ends a link label is already part of that link.
        const next = text[index + href.length];
        const sanitized = next === ']' || next === ')' ? null : sanitizeBioUrl(href);

        if (sanitized) {
          push({ kind: 'link', href: sanitized, children: [{ kind: 'text', value: href }] });
          index += raw.length;
          buffer += raw.slice(href.length);
          continue;
        }
      }
    }

    buffer += char;
    index += 1;
  }

  flush();
  return inlines;
}

type EscapeMode = 'text' | 'label';

function escapeText(value: string, extended: boolean, mode: EscapeMode): string {
  if (mode === 'label') {
    return extended ? value.replace(LABEL_ESCAPED, '\\$1') : value;
  }

  return extended ? value.replace(MARKDOWN_ESCAPED, '\\$1') : value.replace(LIMITED_ESCAPED, '\\$1');
}

function codeFence(value: string, minimum = 1): string {
  let longest = 0;

  for (const line of value.split('\n')) {
    const marker = line.match(/^\s*(`{1,})/);
    if (marker?.[1]) longest = Math.max(longest, marker[1].length);
  }

  return '`'.repeat(Math.max(minimum, longest + 1));
}

function serializeCode(value: string): string {
  const fence = codeFence(value);
  const padding = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
  return `${fence}${padding}${value}${padding}${fence}`;
}

function serializeInlines(inlines: BioInline[], extended: boolean, mode: EscapeMode = 'text'): string {
  return inlines
    .map((inline) => {
      if (inline.kind === 'text') return escapeText(inline.value, extended, mode);
      if (inline.kind === 'code') return extended ? serializeCode(inline.value) : inline.value;

      const content = serializeInlines(inline.children, extended, inline.kind === 'link' ? 'label' : 'text').trim();
      if (!content) return '';

      if (inline.kind === 'bold') return `**${content}**`;
      if (inline.kind === 'italic') return `*${content}*`;
      if (inline.kind === 'strike') return extended ? `~~${content}~~` : content;
      return `[${content}](${inline.href})`;
    })
    .join('');
}

/** Stops a plain line from being read back as a block marker. */
function escapeLineStart(content: string): string {
  if (/^#{1,6}(\s|$)/.test(content) || /^([-+>]|\d{1,9}[.)])(\s|$)/.test(content)) {
    return `\\${content}`;
  }

  if (/^`{3}/.test(content)) {
    return ` ${content}`;
  }

  return content;
}

function normalizeCodeLang(value: string): string {
  const lang = value.trim();
  return CODE_LANG.test(lang) ? lang.toLowerCase() : '';
}

function pushCodeBlock(blocks: BioBlock[], lang: string, code: string): void {
  if (code.trim().length === 0) return;
  blocks.push({ kind: 'codeBlock', lang, code: code.replace(/\s+$/, '') });
}

function pushListBlock(blocks: BioBlock[], kind: 'bullets' | 'ordered', item: BioInline[]): void {
  const previous = blocks[blocks.length - 1];
  if (previous?.kind === kind) {
    previous.items.push(item);
    return;
  }

  blocks.push({ kind, items: [item] });
}

/**
 * Parses the bio markdown into blocks. Every plain line becomes its own block,
 * which mirrors what a WYSIWYG editor produces and keeps existing
 * newline-separated bios readable.
 */
export function parseBioMarkdown(markdown: string, extended = false): BioBlock[] {
  const lines = (markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: BioBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (extended) {
      const fence = line.match(CODE_FENCE);
      if (fence?.[1]) {
        const marker = fence[1];
        const lang = normalizeCodeLang(fence[2] ?? '');
        const code: string[] = [];

        index += 1;
        while (index < lines.length) {
          const current = lines[index] ?? '';
          if (current.trimEnd().startsWith(marker)) {
            index += 1;
            break;
          }
          code.push(current);
          index += 1;
        }

        pushCodeBlock(blocks, lang, code.join('\n'));
        continue;
      }
    }

    if (extended) {
      const heading = line.match(HEADING_LINE);
      if (heading?.[2]) {
        const level = Math.min(3, heading[1]?.length ?? 1) as BioHeadingLevel;
        const inlines = parseInline(heading[2].trim(), extended);
        if (inlines.length > 0) {
          blocks.push({ kind: 'heading', level, inlines });
        }
        index += 1;
        continue;
      }

      const quote = line.match(QUOTE_LINE);
      if (quote) {
        const parts: string[] = [];

        while (index < lines.length) {
          const next = lines[index]?.match(QUOTE_LINE);
          if (!next) break;
          const content = (next[1] ?? '').trim();
          if (content) parts.push(content);
          index += 1;
        }

        const inlines = parseInline(parts.join(' '), extended);
        if (inlines.length > 0) blocks.push({ kind: 'quote', inlines });
        continue;
      }

      const ordered = line.match(ORDERED_LINE);
      if (ordered?.[1]) {
        const inlines = parseInline(ordered[1].trim(), extended);
        if (inlines.length > 0) pushListBlock(blocks, 'ordered', inlines);
        index += 1;
        continue;
      }
    }

    const bullet = line.match(BULLET_LINE);
    if (bullet?.[1]) {
      const inlines = parseInline(bullet[1].trim(), extended);
      if (inlines.length > 0) pushListBlock(blocks, 'bullets', inlines);
      index += 1;
      continue;
    }

    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    blocks.push({ kind: 'line', inlines: parseInline(line.trim(), extended) });
    index += 1;
  }

  return blocks;
}

export function serializeBio(blocks: BioBlock[], extended = false): string {
  const lines: string[] = [];

  for (const block of blocks) {
    if (block.kind === 'codeBlock') {
      if (!extended) {
        const content = block.code.split('\n').map((line) => escapeLineStart(escapeText(line, false, 'text'))).join('\n');
        lines.push(content);
        continue;
      }

      const fence = codeFence(block.code, 3);
      lines.push(`${fence}${block.lang}`, block.code, fence);
      continue;
    }

    if (block.kind === 'bullets' || block.kind === 'ordered') {
      block.items.forEach((item, itemIndex) => {
        const content = serializeInlines(item, extended).trim();
        if (!content) return;
        lines.push(block.kind === 'bullets' ? `- ${content}` : `${itemIndex + 1}. ${content}`);
      });
      continue;
    }

    const content = serializeInlines(block.inlines, extended).trim();
    if (!content) continue;

    if (block.kind === 'heading') {
      lines.push(`${'#'.repeat(block.level)} ${content}`);
    } else if (block.kind === 'quote') {
      lines.push(`> ${content}`);
    } else {
      lines.push(extended ? escapeLineStart(content) : content);
    }
  }

  return lines.join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlinesToHtml(inlines: BioInline[]): string {
  return inlines
    .map((inline) => {
      if (inline.kind === 'text') return escapeHtml(inline.value);
      if (inline.kind === 'code') return `<code>${escapeHtml(inline.value)}</code>`;

      const inner = inlinesToHtml(inline.children);
      if (!inner) return '';

      if (inline.kind === 'bold') return `<strong>${inner}</strong>`;
      if (inline.kind === 'italic') return `<em>${inner}</em>`;
      if (inline.kind === 'strike') return `<del>${inner}</del>`;
      return `<a href="${escapeHtml(inline.href)}">${inner}</a>`;
    })
    .join('');
}

function blockToHtml(block: BioBlock): string {
  if (block.kind === 'codeBlock') {
    return `<pre><code>${escapeHtml(block.code)}</code></pre>`;
  }

  if (block.kind === 'bullets' || block.kind === 'ordered') {
    const tag = block.kind === 'bullets' ? 'ul' : 'ol';
    const items = block.items.map((item) => `<li>${inlinesToHtml(item)}</li>`).join('');
    return items ? `<${tag}>${items}</${tag}>` : '';
  }

  if (block.kind === 'heading') {
    return `<h${block.level}>${inlinesToHtml(block.inlines)}</h${block.level}>`;
  }

  if (block.kind === 'quote') {
    return `<blockquote>${inlinesToHtml(block.inlines)}</blockquote>`;
  }

  return `<p>${inlinesToHtml(block.inlines)}</p>`;
}

/**
 * Renders the dialect as safe HTML. Text is always escaped and link URLs are
 * always http(s) by the time they reach here, so the result is safe to assign to
 * `innerHTML` (used to seed the editor surface).
 */
export function bioMarkdownToHtml(markdown: string, extended = false): string {
  return parseBioMarkdown(markdown, extended).map(blockToHtml).join('');
}

/**
 * Normalises untrusted input to the dialect: anything not representable is
 * dropped rather than escaped, and the result is re-serialised from the parsed
 * tree.
 */
export function sanitizeBioMarkdown(markdown: string, extended = false): string {
  return serializeBio(parseBioMarkdown(markdown, extended), extended);
}
