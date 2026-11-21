import type {
  AggregationFunction,
  ASTNode,
  BinaryOp,
  PipelineStepAST,
  QueryAST,
  RootClauseType,
} from './ast';
import type { Token, TokenType } from './lexer';
import { assertLambdaField, stripLambdaPrefix } from './fields';

export class Parser {
  private readonly tokens: Token[];
  private current = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  public parse(): QueryAST {
    let action: RootClauseType;

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

    let varName = 'p';
    let filter: ASTNode | undefined;
    if (!this.check('RPAREN')) {
      const varToken = this.consume('IDENTIFIER', 'Expected variable identifier');
      varName = varToken.value;
      this.consume('ARROW', "Expected '->'");
      filter = this.parseExpression(varName);
    }

    this.consume('RPAREN', "Expected ')' ending query clause");

    const pipeline: PipelineStepAST[] = [];
    while (this.match('THEN')) {
      pipeline.push(this.parsePipelineOp());
    }

    return {
      action,
      varName,
      filter,
      pipeline,
    };
  }

  private parseExpression(varName: string): ASTNode {
    let left = this.parseTerm(varName);

    while (this.check('OR')) {
      const op = this.advance().value as '|';
      const right = this.parseTerm(varName);
      left = { type: 'logical', op, left, right };
    }

    return left;
  }

  private parseTerm(varName: string): ASTNode {
    let left = this.parseFactor(varName);

    while (this.check('AND')) {
      const op = this.advance().value as '&';
      const right = this.parseFactor(varName);
      left = { type: 'logical', op, left, right };
    }

    return left;
  }

  private parseFactor(varName: string): ASTNode {
    // Negation: !{ ... } or !( ... ) or not ...
    if (this.match('NOT')) {
      const expr = this.parseFactor(varName);
      return { type: 'not', expr };
    }

    // Nested parenthesized expression: ( expr )
    if (this.match('LPAREN')) {
      const expr = this.parseExpression(varName);
      this.consume('RPAREN', "Expected ')' after nested expression");
      return expr;
    }

    // Condition block: { ... }
    if (this.match('LBRACE')) {
      const condition = this.parseConditionBlock(varName);
      this.consume('RBRACE', "Expected '}' after condition");
      return condition;
    }

    throw new Error(`Unexpected token '${this.peek().value}' at pos ${this.peek().position}`);
  }

  private parseConditionBlock(varName: string): ASTNode {
    // Fields must be explicitly scoped to the lambda variable, e.g. "p.temperature".
    const fieldToken = this.consume('IDENTIFIER', 'Expected field name in condition block');
    const field = fieldToken.value;
    assertLambdaField(field, varName, fieldToken.position);

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
        assertLambdaField(valToken.value, varName, valToken.position);
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
        assertLambdaField(centerToken.value, varName, centerToken.position);
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

  /** Parses a pipeline field selector such as `p -> { p.temperature }`. */
  private parseFieldSelector(): { varName: string; field: string } {
    const varToken = this.consume('IDENTIFIER', 'Expected variable identifier in field selector');
    if (!this.check('ARROW')) {
      throw new Error(
        `Pipeline field references must use a selector like p -> { p.field } at position ${varToken.position}`,
      );
    }
    this.consume('ARROW', "Expected '->' after field selector variable");
    this.consume('LBRACE', "Expected '{' after '->' in field selector");
    const fieldToken = this.consume('IDENTIFIER', 'Expected field name in field selector');
    assertLambdaField(fieldToken.value, varToken.value, fieldToken.position);
    this.consume('RBRACE', "Expected '}' after field selector");
    return { varName: varToken.value, field: stripLambdaPrefix(fieldToken.value, varToken.value) };
  }

  private parseFieldSelectors(): Array<{ varName: string; field: string }> {
    const selectors: Array<{ varName: string; field: string }> = [];
    if (this.check('IDENTIFIER')) {
      do {
        selectors.push(this.parseFieldSelector());
      } while (this.match('COMMA'));
    }
    return selectors;
  }

  private parsePipelineOp(): PipelineStepAST {
    const opToken = this.advance();
    const opName = opToken.value;
    this.consume('LPAREN', `Expected '(' after ${opName}`);

    let step: PipelineStepAST;

    switch (opName) {
      case 'sortAscending':
      case 'sortDescending': {
        const selector = this.check('IDENTIFIER') ? this.parseFieldSelector() : undefined;
        step = { type: opName, field: selector?.field };
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
        step = { type: 'select', fields: this.parseFieldSelectors().map((selector) => selector.field) };
        break;
      }

      case 'omit': {
        step = { type: 'omit', fields: this.parseFieldSelectors().map((selector) => selector.field) };
        break;
      }

      case 'rename': {
        const from = this.parseFieldSelector();
        this.consume('COMMA', "Expected ',' in rename(from, to)");
        const to = this.parseFieldSelector();
        step = { type: 'rename', from: from.field, to: to.field };
        break;
      }

      case 'distinct':
      case 'dedup': {
        const selector = this.check('IDENTIFIER') ? this.parseFieldSelector() : undefined;
        step = { type: 'distinct', field: selector?.field };
        break;
      }

      case 'dropNulls': {
        step = { type: 'dropNulls', fields: this.parseFieldSelectors().map((selector) => selector.field) };
        break;
      }

      case 'fill': {
        const selector = this.parseFieldSelector();
        this.consume('COMMA', "Expected ',' in fill(field, value)");
        const valToken = this.advance();
        let val: number | string | boolean;
        if (valToken.type === 'NUMBER') val = Number.parseFloat(valToken.value);
        else if (valToken.type === 'STRING') val = valToken.value;
        else if (valToken.type === 'BOOLEAN') val = valToken.value === 'true';
        else throw new Error(`Invalid fill value at pos ${valToken.position}`);

        step = { type: 'fill', field: selector.field, value: val };
        break;
      }

      case 'fillPrevious': {
        const selector = this.parseFieldSelector();
        step = { type: 'fillPrevious', field: selector.field };
        break;
      }

      case 'clamp': {
        const selector = this.parseFieldSelector();
        this.consume('COMMA', "Expected ','");
        const minToken = this.consume('NUMBER', 'Expected min number in clamp');
        this.consume('COMMA', "Expected ','");
        const maxToken = this.consume('NUMBER', 'Expected max number in clamp');
        step = {
          type: 'clamp',
          field: selector.field,
          min: Number.parseFloat(minToken.value),
          max: Number.parseFloat(maxToken.value),
        };
        break;
      }

      case 'movingAverage': {
        const selector = this.parseFieldSelector();
        this.consume('COMMA', "Expected ','");
        const winToken = this.consume('NUMBER', 'Expected windowSize number in movingAverage');
        let targetField: string | undefined;
        if (this.match('COMMA')) {
          targetField = this.parseFieldSelector().field;
        }
        step = {
          type: 'movingAverage',
          field: selector.field,
          windowSize: Number.parseInt(winToken.value, 10),
          targetField,
        };
        break;
      }

      case 'rate':
      case 'diff': {
        const selector = this.parseFieldSelector();
        let targetField: string | undefined;
        if (this.match('COMMA')) {
          targetField = this.parseFieldSelector().field;
        }
        step = { type: opName, field: selector.field, targetField };
        break;
      }

      case 'window':
      case 'resample': {
        const durToken = this.advance();
        this.consume('COMMA', "Expected ',' in resample(duration, aggregation, field)");
        const aggToken = this.advance();
        this.consume('COMMA', "Expected ',' in resample(duration, aggregation, field)");
        const selector = this.parseFieldSelector();

        step = {
          type: 'resample',
          duration: durToken.value,
          aggregation: aggToken.value.toLowerCase() as AggregationFunction,
          field: selector.field,
        };
        break;
      }

      case 'summary': {
        const fields = this.parseFieldSelectors().map((selector) => selector.field);
        step = { type: 'summary', fields: fields.length > 0 ? fields : undefined };
        break;
      }

      case 'avg':
      case 'min':
      case 'max':
      case 'sum':
      case 'median':
      case 'stddev': {
        const selector = this.parseFieldSelector();
        step = { type: 'aggregate', function: opName as AggregationFunction, field: selector.field };
        break;
      }

      case 'count': {
        const selector = this.check('IDENTIFIER') ? this.parseFieldSelector() : undefined;
        step = { type: 'aggregate', function: 'count', field: selector?.field };
        break;
      }

      case 'groupBy': {
        const selector = this.parseFieldSelector();
        step = { type: 'groupBy', field: selector.field };
        break;
      }

      case 'compute': {
        const selector = this.parseFieldSelector();
        this.consume('COMMA', "Expected ',' in compute(field, expression)");

        // Collect expression tokens, requiring every field reference to use the selector's variable.
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
            const token = this.advance();
            if (token.type === 'IDENTIFIER') {
              assertLambdaField(token.value, selector.varName, token.position);
            }
            exprTokens += ` ${token.value} `;
          }
        }

        step = {
          type: 'compute',
          field: selector.field,
          varName: selector.varName,
          expression: exprTokens.trim(),
        };
        break;
      }

      case 'filter': {
        const varToken = this.consume('IDENTIFIER', 'Expected variable identifier in filter');
        this.consume('ARROW', "Expected '->'");
        const filterNode = this.parseExpression(varToken.value);
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
