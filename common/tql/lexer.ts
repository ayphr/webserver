export type TokenType =
  | 'IDENTIFIER' | 'NUMBER' | 'STRING' | 'BOOLEAN'
  | 'ARROW' | 'THEN' | 'FIND_ALL'
  | 'LPAREN' | 'RPAREN' | 'LBRACE' | 'RBRACE'
  | 'AND' | 'OR'
  | 'STD_OP' | 'TOLERANCE_OP'
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
      this.skipWhitespace();
      if (this.pos >= this.input.length) break;

      const char = this.input[this.pos];

      // Single/Double Symbol Delimiters
      if (char === '(') { tokens.push(this.makeToken('LPAREN', '(')); this.pos++; continue; }
      if (char === ')') { tokens.push(this.makeToken('RPAREN', ')')); this.pos++; continue; }
      if (char === '{') { tokens.push(this.makeToken('LBRACE', '{')); this.pos++; continue; }
      if (char === '}') { tokens.push(this.makeToken('RBRACE', '}')); this.pos++; continue; }
      if (char === '&') { tokens.push(this.makeToken('AND', '&')); this.pos++; continue; }
      if (char === '|') { tokens.push(this.makeToken('OR', '|')); this.pos++; continue; }
      if (char === ',') { tokens.push(this.makeToken('COMMA', ',')); this.pos++; continue; }

      // Arrow operator (->)
      if (char === '-' && this.input[this.pos + 1] === '>') {
        tokens.push(this.makeToken('ARROW', '->'));
        this.pos += 2;
        continue;
      }

      // Tolerance operator: ~<delta>[%]~=
      if (char === '~') {
        const start = this.pos;
        this.pos++; // skip leading ~
        let deltaStr = '';
        while (this.pos < this.input.length && (this.isDigit(this.input[this.pos]) || this.input[this.pos] === '.' || this.input[this.pos] === '%')) {
          deltaStr += this.input[this.pos];
          this.pos++;
        }
        if (this.input[this.pos] === '~' && this.input[this.pos + 1] === '=') {
          this.pos += 2; // skip trailing ~=
          tokens.push(this.makeToken('TOLERANCE_OP', deltaStr));
          continue;
        } else {
          throw new Error(`Invalid tolerance operator format starting at position ${start}`);
        }
      }

      // Standard Comparison Operators (<, <=, >, >=, ==, !=)
      if (['<', '>', '=', '!'].includes(char)) {
        let op = char;
        if (this.input[this.pos + 1] === '=') {
          op += '=';
          this.pos += 2;
        } else {
          this.pos++;
        }
        tokens.push(this.makeToken('STD_OP', op));
        continue;
      }

      // String Literals ("string" or 'string')
      if (char === '"' || char === "'") {
        const quote = char;
        let str = '';
        this.pos++;
        while (this.pos < this.input.length && this.input[this.pos] !== quote) {
          str += this.input[this.pos];
          this.pos++;
        }
        this.pos++; // skip closing quote
        tokens.push(this.makeToken('STRING', str));
        continue;
      }

      // Numbers
      if (this.isDigit(char) || (char === '-' && this.isDigit(this.input[this.pos + 1]))) {
        let numStr = char;
        this.pos++;
        while (this.pos < this.input.length && (this.isDigit(this.input[this.pos]) || this.input[this.pos] === '.')) {
          numStr += this.input[this.pos];
          this.pos++;
        }
        tokens.push(this.makeToken('NUMBER', numStr));
        continue;
      }

      // Identifiers & Keywords
      if (this.isAlpha(char)) {
        let id = '';
        while (this.pos < this.input.length && (this.isAlphaNumeric(this.input[this.pos]))) {
          id += this.input[this.pos];
          this.pos++;
        }
        if (id === 'findAll') tokens.push(this.makeToken('FIND_ALL', id));
        else if (id === 'then') tokens.push(this.makeToken('THEN', id));
        else if (id === 'true' || id === 'false') tokens.push(this.makeToken('BOOLEAN', id));
        else tokens.push(this.makeToken('IDENTIFIER', id));
        continue;
      }

      throw new Error(`Unexpected character '${char}' at position ${this.pos}`);
    }

    tokens.push(this.makeToken('EOF', ''));
    return tokens;
  }

  private makeToken(type: TokenType, value: string): Token {
    return { type, value, position: this.pos };
  }

  private skipWhitespace() {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
      this.pos++;
    }
  }

  private isDigit(c: string) { return c >= '0' && c <= '9'; }
  private isAlpha(c: string) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'; }
  private isAlphaNumeric(c: string) { return this.isAlpha(c) || this.isDigit(c); }
}
