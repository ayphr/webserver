import { Lexer, type Token } from './lexer';

interface CommentToken {
  start: number;
  end: number;
  text: string;
}

/**
 * Finds comments outside string literals so formatting does not discard them.
 * The regular lexer skips comments, so this runs alongside it using token
 * positions to put each comment back in place.
 */
function scanComments(source: string): CommentToken[] {
  const comments: CommentToken[] = [];
  let quote: string | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;

    if (quote) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '/' && source[index + 1] === '/') {
      const start = index;
      while (index < source.length && source[index] !== '\n') index += 1;
      comments.push({ start, end: index, text: source.slice(start, index).trim() });
      continue;
    }

    if (char === '/' && source[index + 1] === '*') {
      const start = index;
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 1;
      comments.push({ start, end: index + 1, text: source.slice(start, index + 1) });
    }
  }

  return comments;
}

/** Uses the original source for literals so quotes, escapes, and number spelling survive. */
function tokenText(source: string, token: Token, nextToken?: Token): string {
  if (token.type === 'STRING') {
    const start = token.position;
    const quote = source[start];
    if (quote === '"' || quote === "'") {
      let index = start + 1;
      while (index < source.length) {
        const char = source[index]!;
        if (char === '\\') {
          index += 2;
          continue;
        }
        if (char === quote) {
          return source.slice(start, index + 1);
        }
        index += 1;
      }
    }
  }

  if (token.type === 'TOLERANCE_OP') return `~${token.value}~=`;
  if (token.type === 'NOT' && (nextToken?.type === 'IN' || nextToken?.type === 'CONTAINS')) {
    return 'not';
  }

  return token.value;
}

function separator(previous: Token | null, current: Token): string {
  if (!previous) return '';
  if (current.type === 'THEN') return '\n  ';

  if (current.type === 'LPAREN') {
    return previous.type === 'COMMA' || previous.type === 'THEN' ? ' ' : '';
  }
  if (current.type === 'LBRACKET') {
    return previous.type === 'IN' || previous.type === 'NOT' ? ' ' : '';
  }
  if (current.type === 'RPAREN' || current.type === 'RBRACKET' || current.type === 'COMMA') {
    return '';
  }
  if (previous.type === 'LPAREN' || previous.type === 'LBRACKET') return '';
  if (current.type === 'LBRACE') return previous.type === 'NOT' ? '' : ' ';
  if (current.type === 'RBRACE') return previous.type === 'LBRACE' ? '' : ' ';

  return ' ';
}

/**
 * Pretty-prints TQL without changing its meaning: each pipeline step starts on
 * its own line, condition blocks are spaced consistently, and field selectors,
 * literals, aliases, and comments are kept as written.
 */
export function formatTql(query: string): string {
  const source = query.trim();
  if (!source) return '';

  const tokens = new Lexer(source).tokenize();
  const comments = scanComments(source);
  const pieces: string[] = [];
  let previous: Token | null = null;
  let commentIndex = 0;
  let inPipeline = false;

  const emitComment = (comment: CommentToken, nextToken?: Token) => {
    const indent = inPipeline || nextToken?.type === 'THEN' ? '  ' : '';
    while (pieces.length > 0 && pieces[pieces.length - 1]!.trim() === '') {
      pieces.pop();
    }
    const current = pieces.join('');
    if (current.trim() && !current.endsWith('\n')) {
      pieces.push('\n');
    }
    pieces.push(indent, comment.text, '\n', indent);
    previous = null;
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.type === 'EOF') break;

    while (commentIndex < comments.length && comments[commentIndex]!.end <= token.position) {
      emitComment(comments[commentIndex]!, token);
      commentIndex += 1;
    }

    if (token.type === 'THEN') inPipeline = true;
    pieces.push(separator(previous, token));
    pieces.push(tokenText(source, token, tokens[index + 1]));
    previous = token;
  }

  while (commentIndex < comments.length) {
    emitComment(comments[commentIndex]!);
    commentIndex += 1;
  }

  return pieces.join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
