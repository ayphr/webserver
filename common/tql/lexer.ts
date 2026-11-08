export type TokenType =
  | 'IDENTIFIER' | 'NUMBER' | 'STRING' | 'BOOLEAN'
  | 'ARROW' | 'THEN'
  | 'FIND_ALL' | 'FIND_FIRST' | 'FIND_LAST' | 'COUNT' | 'EXISTS' | 'SELECT'
  | 'LPAREN' | 'RPAREN' | 'LBRACE' | 'RBRACE' | 'LBRACKET' | 'RBRACKET'
  | 'AND' | 'OR' | 'NOT'
  | 'STD_OP' | 'REGEX_OP' | 'TOLERANCE_OP' | 'MATH_OP'
  | 'IN' | 'BETWEEN' | 'AND_KW' | 'IS' | 'NULL' | 'MISSING' | 'PRESENT'
  | 'CONTAINS' | 'STARTS_WITH' | 'ENDS_WITH'
  | 'COMMA' | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

export class Lexer {
  private pos = 0;
  private readonly input: string;

  constructor(input: string) {
    this.input = input;
  }

  public tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.input.length) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.input.length) break;

      const char = this.charAt(0);
      if (!char) break;

      // Single character delimiters
      if (char === '(') { tokens.push(this.makeToken('LPAREN', '(')); this.pos++; continue; }
      if (char === ')') { tokens.push(this.makeToken('RPAREN', ')')); this.pos++; continue; }
      if (char === '{') { tokens.push(this.makeToken('LBRACE', '{')); this.pos++; continue; }
      if (char === '}') { tokens.push(this.makeToken('RBRACE', '}')); this.pos++; continue; }
      if (char === '[') { tokens.push(this.makeToken('LBRACKET', '[')); this.pos++; continue; }
      if (char === ']') { tokens.push(this.makeToken('RBRACKET', ']')); this.pos++; continue; }
      if (char === '&') { tokens.push(this.makeToken('AND', '&')); this.pos++; continue; }
      if (char === '|') { tokens.push(this.makeToken('OR', '|')); this.pos++; continue; }
      if (char === ',') { tokens.push(this.makeToken('COMMA', ',')); this.pos++; continue; }

      // Math operators (+, *, /, %)
      if (['+', '*', '/', '%'].includes(char)) {
        tokens.push(this.makeToken('MATH_OP', char));
        this.pos++;
        continue;
      }

      // Arrow operator (->) or Minus (-)
      if (char === '-') {
        if (this.charAt(1) === '>') {
          tokens.push(this.makeToken('ARROW', '->'));
          this.pos += 2;
          continue;
        }

        const prevToken = tokens.length > 0 ? tokens[tokens.length - 1] : undefined;
        const prev = prevToken ? prevToken.type : null;
        const isUnary = !prev || ['LPAREN', 'LBRACE', 'LBRACKET', 'COMMA', 'STD_OP', 'ARROW', 'AND', 'OR', 'NOT', 'MATH_OP'].includes(prev);
        if (!isUnary || !this.isDigit(this.charAt(1))) {
          tokens.push(this.makeToken('MATH_OP', '-'));
          this.pos++;
          continue;
        }
      }

      // Regex matches (=~, !~)
      if (char === '=' && this.charAt(1) === '~') {
        tokens.push(this.makeToken('REGEX_OP', '=~'));
        this.pos += 2;
        continue;
      }
      if (char === '!' && this.charAt(1) === '~') {
        tokens.push(this.makeToken('REGEX_OP', '!~'));
        this.pos += 2;
        continue;
      }

      // Logical NOT (!) or !=
      if (char === '!') {
        if (this.charAt(1) === '=') {
          tokens.push(this.makeToken('STD_OP', '!='));
          this.pos += 2;
          continue;
        }
        tokens.push(this.makeToken('NOT', '!'));
        this.pos++;
        continue;
      }

      // Tolerance operator: ~<delta>[%]~=
      if (char === '~') {
        const start = this.pos;
        this.pos++; // skip leading ~
        let deltaStr = '';
        while (
          this.pos < this.input.length &&
          (this.isDigit(this.charAt(0)) || this.charAt(0) === '.' || this.charAt(0) === '%')
        ) {
          deltaStr += this.charAt(0);
          this.pos++;
        }
        if (this.charAt(0) === '~' && this.charAt(1) === '=') {
          this.pos += 2; // skip trailing ~=
          tokens.push(this.makeToken('TOLERANCE_OP', deltaStr));
          continue;
        } else {
          throw new Error(`Invalid tolerance operator format starting at position ${start}`);
        }
      }

      // Standard Comparison Operators (<, <=, >, >=, ==, =)
      if (['<', '>', '='].includes(char)) {
        let op = char;
        if (this.charAt(1) === '=') {
          op += '=';
          this.pos += 2;
        } else {
          this.pos++;
        }
        tokens.push(this.makeToken('STD_OP', op === '=' ? '==' : op));
        continue;
      }

      // String Literals ("string" or 'string')
      if (char === '"' || char === "'") {
        const quote = char;
        let str = '';
        this.pos++;
        while (this.pos < this.input.length && this.charAt(0) !== quote) {
          if (this.charAt(0) === '\\' && this.pos + 1 < this.input.length) {
            this.pos++;
            const escaped = this.charAt(0);
            if (escaped === 'n') str += '\n';
            else if (escaped === 't') str += '\t';
            else if (escaped === 'r') str += '\r';
            else str += escaped;
          } else {
            str += this.charAt(0);
          }
          this.pos++;
        }
        if (this.pos >= this.input.length) {
          throw new Error(`Unterminated string literal at position ${this.pos}`);
        }
        this.pos++; // skip closing quote
        tokens.push(this.makeToken('STRING', str));
        continue;
      }

      // Numbers (supports negative numbers when followed by digit, decimals)
      if (
        this.isDigit(char) ||
        (char === '-' && this.isDigit(this.charAt(1)))
      ) {
        let numStr = char;
        this.pos++;
        while (
          this.pos < this.input.length &&
          (this.isDigit(this.charAt(0)) || this.charAt(0) === '.')
        ) {
          numStr += this.charAt(0);
          this.pos++;
        }
        tokens.push(this.makeToken('NUMBER', numStr));
        continue;
      }

      // Identifiers, Keywords & Dotted Paths (e.g. sensor.temperature)
      if (this.isAlpha(char)) {
        let id = '';
        while (this.pos < this.input.length && (this.isAlphaNumeric(this.charAt(0)) || this.charAt(0) === '.')) {
          id += this.charAt(0);
          this.pos++;
        }

        switch (id) {
          case 'findAll': tokens.push(this.makeToken('FIND_ALL', id)); break;
          case 'findFirst': tokens.push(this.makeToken('FIND_FIRST', id)); break;
          case 'findLast': tokens.push(this.makeToken('FIND_LAST', id)); break;
          case 'count': tokens.push(this.makeToken('COUNT', id)); break;
          case 'exists': tokens.push(this.makeToken('EXISTS', id)); break;
          case 'select': tokens.push(this.makeToken('SELECT', id)); break;
          case 'then': tokens.push(this.makeToken('THEN', id)); break;
          case 'in': tokens.push(this.makeToken('IN', id)); break;
          case 'between': tokens.push(this.makeToken('BETWEEN', id)); break;
          case 'and': tokens.push(this.makeToken('AND_KW', id)); break;
          case 'not': tokens.push(this.makeToken('NOT', id)); break;
          case 'is': tokens.push(this.makeToken('IS', id)); break;
          case 'null': tokens.push(this.makeToken('NULL', id)); break;
          case 'missing': tokens.push(this.makeToken('MISSING', id)); break;
          case 'present': tokens.push(this.makeToken('PRESENT', id)); break;
          case 'contains': tokens.push(this.makeToken('CONTAINS', id)); break;
          case 'startsWith': tokens.push(this.makeToken('STARTS_WITH', id)); break;
          case 'endsWith': tokens.push(this.makeToken('ENDS_WITH', id)); break;
          case 'true':
          case 'false':
            tokens.push(this.makeToken('BOOLEAN', id));
            break;
          default:
            tokens.push(this.makeToken('IDENTIFIER', id));
            break;
        }
        continue;
      }

      throw new Error(`Unexpected character '${char}' at position ${this.pos}`);
    }

    tokens.push(this.makeToken('EOF', ''));
    return tokens;
  }

  private charAt(offset: number): string {
    const idx = this.pos + offset;
    return idx < this.input.length ? (this.input[idx] ?? '') : '';
  }

  private makeToken(type: TokenType, value: string): Token {
    return { type, value, position: this.pos };
  }

  private skipWhitespaceAndComments() {
    while (this.pos < this.input.length) {
      const char = this.charAt(0);
      if (!char) break;
      if (/\s/.test(char)) {
        this.pos++;
        continue;
      }
      // Single line comment // ...
      if (char === '/' && this.charAt(1) === '/') {
        this.pos += 2;
        while (this.pos < this.input.length && this.charAt(0) !== '\n') {
          this.pos++;
        }
        continue;
      }
      // Block comment /* ... */
      if (char === '/' && this.charAt(1) === '*') {
        this.pos += 2;
        while (this.pos < this.input.length && !(this.charAt(0) === '*' && this.charAt(1) === '/')) {
          this.pos++;
        }
        this.pos += 2; // skip */
        continue;
      }
      break;
    }
  }

  private isDigit(c: string) { return c >= '0' && c <= '9'; }
  private isAlpha(c: string) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'; }
  private isAlphaNumeric(c: string) { return this.isAlpha(c) || this.isDigit(c); }
}
