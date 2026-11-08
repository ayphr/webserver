import type {
  AggregationFunction,
  ASTNode,
  BinaryOp,
  PipelineStepAST,
  QueryAST,
  RootClauseType,
} from './ast';
import type { Token, TokenType } from './lexer';

export class Parser {
  private readonly tokens: Token[];
  private current = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  public parse(): QueryAST {
    let action: RootClauseType = 'findAll';

    if (this.match('FIND_ALL') || this.match('SELECT')) {
      action = 'findAll';
    } else if (this.match('FIND_FIRST')) {
      action = 'findFirst';
    } else if (this.match('FIND_LAST')) {
      action = 'findLast';
    } else if (this.match('COUNT')) {
      action = 'count';
    } else if (this.match('EXISTS')) {
      action = 'exists';
    } else {
      throw new Error(
        `Expected query root (e.g. 'findAll', 'findFirst', 'findLast', 'count', 'exists', 'select'), found '${this.peek().value}' at position ${this.peek().position}`,
      );
    }

    this.consume('LPAREN', "Expected '(' after query action");
    const varToken = this.consume('IDENTIFIER', 'Expected variable identifier');
    this.consume('ARROW', "Expected '->'");

    const filterAST = this.parseExpression();

    this.consume('RPAREN', "Expected ')' ending query clause");

    const pipeline: PipelineStepAST[] = [];
    while (this.match('THEN')) {
      pipeline.push(this.parsePipelineOp());
    }

    return {
      action,
      varName: varToken.value,
      filter: filterAST,
      pipeline,
    };
  }

  private parseExpression(): ASTNode {
    let left = this.parseTerm();

    while (this.check('OR')) {
      const op = this.advance().value as '|';
      const right = this.parseTerm();
      left = { type: 'logical', op, left, right };
    }

    return left;
  }

  private parseTerm(): ASTNode {
    let left = this.parseFactor();

    while (this.check('AND')) {
      const op = this.advance().value as '&';
      const right = this.parseFactor();
      left = { type: 'logical', op, left, right };
    }

    return left;
  }

  private parseFactor(): ASTNode {
    // Negation: !{ ... } or !( ... ) or not ...
    if (this.match('NOT')) {
      const expr = this.parseFactor();
      return { type: 'not', expr };
    }

    // Nested parenthesized expression: ( expr )
    if (this.match('LPAREN')) {
      const expr = this.parseExpression();
      this.consume('RPAREN', "Expected ')' after nested expression");
      return expr;
    }

    // Condition block: { ... }
    if (this.match('LBRACE')) {
      const condition = this.parseConditionBlock();
      this.consume('RBRACE', "Expected '}' after condition");
      return condition;
    }

    throw new Error(`Unexpected token '${this.peek().value}' at pos ${this.peek().position}`);
  }

  private parseConditionBlock(): ASTNode {
    // Field name (e.g. "tempC", "status", "sensor.temperature")
    const fieldToken = this.consume('IDENTIFIER', 'Expected field name in condition block');
    const field = fieldToken.value;

    // 1. Standard Comparison Operators (<, <=, >, >=, ==, !=)
    if (this.check('STD_OP')) {
      const op = this.advance().value as BinaryOp;
      const valToken = this.advance();
      let value: number | string | boolean | { field: string };

      if (valToken.type === 'NUMBER') {
        value = Number.parseFloat(valToken.value);
      } else if (valToken.type === 'STRING') {
        value = valToken.value;
      } else if (valToken.type === 'BOOLEAN') {
        value = valToken.value === 'true';
      } else if (valToken.type === 'IDENTIFIER') {
        value = { field: valToken.value };
      } else {
        throw new Error(`Invalid comparison value at pos ${valToken.position}`);
      }

      return { type: 'standard', field, op, value };
    }

    // 2. Tolerance Operators (~delta~= or ~delta%~=)
    if (this.check('TOLERANCE_OP')) {
      const rawOp = this.advance().value;
      const isPercent = rawOp.endsWith('%');
      const deltaStr = isPercent ? rawOp.slice(0, -1) : rawOp;
      const delta = Number.parseFloat(deltaStr);

      const centerToken = this.advance();
      let center: number | { field: string };
      if (centerToken.type === 'NUMBER') {
        center = Number.parseFloat(centerToken.value);
      } else if (centerToken.type === 'IDENTIFIER') {
        center = { field: centerToken.value };
      } else {
        throw new Error(`Expected numerical center or field for tolerance at pos ${centerToken.position}`);
      }

      return { type: 'tolerance', field, delta, isPercent, center };
    }

    // 3. Regex Operators (=~ or !~)
    if (this.check('REGEX_OP')) {
      const op = this.advance().value as '=~' | '!~';
      const patToken = this.consume('STRING', 'Expected string regex pattern');
      return { type: 'stringPattern', field, op, pattern: patToken.value };
    }

    // 4. Set membership: `in [...]` or `not in [...]`
    if (this.check('IN') || (this.check('NOT') && this.peekAhead(1)?.type === 'IN')) {
      const negated = this.match('NOT');
      this.consume('IN', "Expected 'in'");
      this.consume('LBRACKET', "Expected '[' after 'in'");
      const values: Array<number | string | boolean> = [];
      if (!this.check('RBRACKET')) {
        do {
          const item = this.advance();
          if (item.type === 'NUMBER') values.push(Number.parseFloat(item.value));
          else if (item.type === 'STRING') values.push(item.value);
          else if (item.type === 'BOOLEAN') values.push(item.value === 'true');
          else throw new Error(`Invalid literal in set at position ${item.position}`);
        } while (this.match('COMMA'));
      }
      this.consume('RBRACKET', "Expected ']' ending set");
      return { type: 'in', field, negated, values };
    }

    // 5. Range: `between <val1> and <val2>`
    if (this.match('BETWEEN')) {
      const minToken = this.advance();
      const min = minToken.type === 'NUMBER' ? Number.parseFloat(minToken.value) : minToken.value;

      if (!this.match('AND_KW') && !(this.check('IDENTIFIER') && this.peek().value.toLowerCase() === 'and')) {
        throw new Error(`Expected 'and' in between clause at position ${this.peek().position}`);
      }
      if (!this.check('AND_KW') && this.check('IDENTIFIER')) {
        this.advance();
      }

      const maxToken = this.advance();
      const max = maxToken.type === 'NUMBER' ? Number.parseFloat(maxToken.value) : maxToken.value;

      return { type: 'between', field, min, max };
    }

    // 6. Null checks: `is null` or `is not null`
    if (this.match('IS')) {
      const isNot = this.match('NOT');
      if (this.match('NULL')) {
        return { type: 'nullCheck', field, check: isNot ? 'isNotNull' : 'isNull' };
      }
      if (this.match('PRESENT')) {
        return { type: 'presence', field, check: isNot ? 'missing' : 'exists' };
      }
      if (this.match('MISSING')) {
        return { type: 'presence', field, check: isNot ? 'exists' : 'missing' };
      }
      throw new Error(`Expected 'null', 'present', or 'missing' after 'is' at pos ${this.peek().position}`);
    }

    // 7. Presence: `exists` or `missing`
    if (this.match('EXISTS') || (this.check('IDENTIFIER') && this.peek().value === 'exists')) {
      if (this.check('IDENTIFIER')) this.advance();
      return { type: 'presence', field, check: 'exists' };
    }
    if (this.match('MISSING')) {
      return { type: 'presence', field, check: 'missing' };
    }

    // 8. String predicates: `contains`, `startsWith`, `endsWith`, or `not contains`
    if (this.check('NOT') && this.peekAhead(1)?.type === 'CONTAINS') {
      this.advance(); // consume NOT
      this.advance(); // consume CONTAINS
      const patToken = this.consume('STRING', "Expected string after 'not contains'");
      return { type: 'stringPattern', field, op: 'not contains', pattern: patToken.value };
    }
    if (this.match('CONTAINS')) {
      const patToken = this.consume('STRING', "Expected string after 'contains'");
      return { type: 'stringPattern', field, op: 'contains', pattern: patToken.value };
    }
    if (this.match('STARTS_WITH')) {
      const patToken = this.consume('STRING', "Expected string after 'startsWith'");
      return { type: 'stringPattern', field, op: 'startsWith', pattern: patToken.value };
    }
    if (this.match('ENDS_WITH')) {
      const patToken = this.consume('STRING', "Expected string after 'endsWith'");
      return { type: 'stringPattern', field, op: 'endsWith', pattern: patToken.value };
    }

    throw new Error(`Unexpected condition token '${this.peek().value}' at position ${this.peek().position}`);
  }

  private parsePipelineOp(): PipelineStepAST {
    const opToken = this.advance();
    const opName = opToken.value;
    this.consume('LPAREN', `Expected '(' after ${opName}`);

    let step: PipelineStepAST;

    switch (opName) {
      case 'sortAscending':
      case 'sortDescending': {
        let field: string | undefined;
        if (this.check('IDENTIFIER')) {
          field = this.advance().value;
        }
        step = { type: opName, field };
        break;
      }

      case 'limit': {
        const countToken = this.consume('NUMBER', 'Expected limit count');
        step = { type: 'limit', count: Number.parseInt(countToken.value, 10) };
        break;
      }

      case 'offset':
      case 'skip': {
        const countToken = this.consume('NUMBER', 'Expected offset count');
        step = { type: 'offset', count: Number.parseInt(countToken.value, 10) };
        break;
      }

      case 'head': {
        const countToken = this.consume('NUMBER', 'Expected head count');
        step = { type: 'head', count: Number.parseInt(countToken.value, 10) };
        break;
      }

      case 'tail': {
        const countToken = this.consume('NUMBER', 'Expected tail count');
        step = { type: 'tail', count: Number.parseInt(countToken.value, 10) };
        break;
      }

      case 'slice': {
        const startToken = this.consume('NUMBER', 'Expected slice start');
        let end: number | undefined;
        if (this.match('COMMA')) {
          const endToken = this.consume('NUMBER', 'Expected slice end');
          end = Number.parseInt(endToken.value, 10);
        }
        step = { type: 'slice', start: Number.parseInt(startToken.value, 10), end };
        break;
      }

      case 'timeRange': {
        const startToken = this.advance();
        this.consume('COMMA', "Expected ',' between time values");
        const endToken = this.advance();

        const parseTime = (t: Token) => {
          if (t.type === 'NUMBER') return Number.parseFloat(t.value);
          if (t.type === 'STRING') return new Date(t.value).getTime();
          throw new Error(`Invalid timestamp format '${t.value}'`);
        };

        step = {
          type: 'timeRange',
          start: parseTime(startToken),
          end: parseTime(endToken),
        };
        break;
      }

      case 'select':
      case 'project': {
        const fields: string[] = [];
        if (this.check('IDENTIFIER') || this.check('STRING')) {
          do {
            const f = this.advance();
            fields.push(f.value);
          } while (this.match('COMMA'));
        }
        step = { type: 'select', fields };
        break;
      }

      case 'omit': {
        const fields: string[] = [];
        if (this.check('IDENTIFIER') || this.check('STRING')) {
          do {
            const f = this.advance();
            fields.push(f.value);
          } while (this.match('COMMA'));
        }
        step = { type: 'omit', fields };
        break;
      }

      case 'rename': {
        const fromToken = this.advance();
        this.consume('COMMA', "Expected ',' in rename(from, to)");
        const toToken = this.advance();
        step = { type: 'rename', from: fromToken.value, to: toToken.value };
        break;
      }

      case 'distinct':
      case 'dedup': {
        let field: string | undefined;
        if (this.check('IDENTIFIER')) {
          field = this.advance().value;
        }
        step = { type: 'distinct', field };
        break;
      }

      case 'dropNulls': {
        const fields: string[] = [];
        if (this.check('IDENTIFIER') || this.check('STRING')) {
          do {
            const f = this.advance();
            fields.push(f.value);
          } while (this.match('COMMA'));
        }
        step = { type: 'dropNulls', fields };
        break;
      }

      case 'fill': {
        const fieldToken = this.consume('IDENTIFIER', 'Expected field name in fill(field, value)');
        this.consume('COMMA', "Expected ',' in fill(field, value)");
        const valToken = this.advance();
        let val: number | string | boolean;
        if (valToken.type === 'NUMBER') val = Number.parseFloat(valToken.value);
        else if (valToken.type === 'STRING') val = valToken.value;
        else if (valToken.type === 'BOOLEAN') val = valToken.value === 'true';
        else throw new Error(`Invalid fill value at pos ${valToken.position}`);

        step = { type: 'fill', field: fieldToken.value, value: val };
        break;
      }

      case 'fillPrevious': {
        const fieldToken = this.consume('IDENTIFIER', 'Expected field name in fillPrevious(field)');
        step = { type: 'fillPrevious', field: fieldToken.value };
        break;
      }

      case 'clamp': {
        const fieldToken = this.consume('IDENTIFIER', 'Expected field in clamp(field, min, max)');
        this.consume('COMMA', "Expected ','");
        const minToken = this.consume('NUMBER', 'Expected min number in clamp');
        this.consume('COMMA', "Expected ','");
        const maxToken = this.consume('NUMBER', 'Expected max number in clamp');
        step = {
          type: 'clamp',
          field: fieldToken.value,
          min: Number.parseFloat(minToken.value),
          max: Number.parseFloat(maxToken.value),
        };
        break;
      }

      case 'movingAverage': {
        const fieldToken = this.consume('IDENTIFIER', 'Expected field in movingAverage(field, windowSize)');
        this.consume('COMMA', "Expected ','");
        const winToken = this.consume('NUMBER', 'Expected windowSize number in movingAverage');
        let targetField: string | undefined;
        if (this.match('COMMA')) {
          targetField = this.consume('IDENTIFIER', 'Expected target field name in movingAverage').value;
        }
        step = {
          type: 'movingAverage',
          field: fieldToken.value,
          windowSize: Number.parseInt(winToken.value, 10),
          targetField,
        };
        break;
      }

      case 'rate':
      case 'diff': {
        const fieldToken = this.consume('IDENTIFIER', `Expected field in ${opName}(field, [targetField])`);
        let targetField: string | undefined;
        if (this.match('COMMA')) {
          targetField = this.consume('IDENTIFIER', `Expected target field name in ${opName}`).value;
        }
        step = { type: opName, field: fieldToken.value, targetField };
        break;
      }

      case 'window':
      case 'resample': {
        const durToken = this.advance();
        this.consume('COMMA', "Expected ',' in resample(duration, aggregation, field)");
        const aggToken = this.advance();
        this.consume('COMMA', "Expected ',' in resample(duration, aggregation, field)");
        const fieldToken = this.consume('IDENTIFIER', 'Expected field in resample');

        step = {
          type: 'resample',
          duration: durToken.value,
          aggregation: aggToken.value.toLowerCase() as AggregationFunction,
          field: fieldToken.value,
        };
        break;
      }

      case 'summary': {
        const fields: string[] = [];
        if (this.check('IDENTIFIER') || this.check('STRING')) {
          do {
            const f = this.advance();
            fields.push(f.value);
          } while (this.match('COMMA'));
        }
        step = { type: 'summary', fields: fields.length > 0 ? fields : undefined };
        break;
      }

      case 'avg':
      case 'min':
      case 'max':
      case 'sum':
      case 'median':
      case 'stddev': {
        const fieldToken = this.consume('IDENTIFIER', `Expected field name in ${opName}(field)`);
        step = { type: 'aggregate', function: opName as AggregationFunction, field: fieldToken.value };
        break;
      }

      case 'count': {
        let field: string | undefined;
        if (this.check('IDENTIFIER')) {
          field = this.advance().value;
        }
        step = { type: 'aggregate', function: 'count', field };
        break;
      }

      case 'groupBy': {
        const fieldToken = this.consume('IDENTIFIER', 'Expected group field in groupBy(field)');
        step = { type: 'groupBy', field: fieldToken.value };
        break;
      }

      case 'compute': {
        const fieldToken = this.consume('IDENTIFIER', 'Expected new field name in compute(field, expression)');
        this.consume('COMMA', "Expected ',' in compute(field, expression)");

        // Collect all tokens until matching closing parenthesis for compute(...)
        let exprTokens = '';
        let depth = 0;
        while (!this.isAtEnd()) {
          if (this.check('LPAREN')) {
            depth++;
            exprTokens += ' ( ';
            this.advance();
          } else if (this.check('RPAREN')) {
            if (depth === 0) break; // Reached closing paren of compute
            depth--;
            exprTokens += ' ) ';
            this.advance();
          } else {
            exprTokens += ` ${this.advance().value} `;
          }
        }

        step = { type: 'compute', field: fieldToken.value, expression: exprTokens.trim() };
        break;
      }

      case 'filter': {
        const varToken = this.consume('IDENTIFIER', 'Expected variable identifier in filter');
        this.consume('ARROW', "Expected '->'");
        const filterNode = this.parseExpression();
        step = { type: 'filter', varName: varToken.value, filter: filterNode };
        break;
      }

      default:
        throw new Error(`Unknown pipeline operation '${opName}' at position ${opToken.position}`);
    }

    this.consume('RPAREN', `Expected ')' ending ${opName}`);
    return step;
  }

  private match(type: TokenType): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private peekAhead(offset: number): Token | null {
    const idx = this.current + offset;
    return idx < this.tokens.length ? (this.tokens[idx] ?? null) : null;
  }

  private advance(): Token {
    const token = this.peek();
    this.current++;
    return token;
  }

  private isAtEnd(): boolean {
    const token = this.tokens[this.current];
    return !token || token.type === 'EOF';
  }

  private peek(): Token {
    const token = this.tokens[this.current];
    if (!token) {
      return { type: 'EOF', value: '', position: this.tokens.length };
    }
    return token;
  }

  private consume(type: TokenType, errMsg: string): Token {
    if (this.check(type)) return this.advance();
    throw new Error(`${errMsg} (found '${this.peek().value}' at position ${this.peek().position})`);
  }
}
