import type { ASTNode, BinaryOp, PipelineStepAST, QueryAST, Token, TokenType } from '.';

export class Parser {
  private readonly tokens: Token[];
  private current = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  public parse(): QueryAST {
    this.consume('FIND_ALL', "Expected 'findAll'");
    this.consume('LPAREN', "Expected '(' after findAll");

    const varToken = this.consume('IDENTIFIER', 'Expected variable identifier');
    this.consume('ARROW', "Expected '->'");

    const filterAST = this.parseExpression();

    this.consume('RPAREN', "Expected ')' ending findAll");

    const pipeline: PipelineStepAST[] = [];
    while (this.match('THEN')) {
      pipeline.push(this.parsePipelineOp());
    }

    return {
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
    if (this.match('LPAREN')) {
      const expr = this.parseExpression();
      this.consume('RPAREN', "Expected ')' after nested expression");
      return expr;
    }

    if (this.match('LBRACE')) {
      const fieldToken = this.consume('IDENTIFIER', 'Expected field name in comparison');
      const field = fieldToken.value;

      if (this.check('STD_OP')) {
        const op = this.advance().value as BinaryOp;
        const valToken = this.advance();
        let value: number | string | boolean;

        if (valToken.type === 'NUMBER') value = Number.parseFloat(valToken.value);
        else if (valToken.type === 'STRING') value = valToken.value;
        else if (valToken.type === 'BOOLEAN') value = valToken.value === 'true';
        else throw new Error(`Invalid comparison value at pos ${valToken.position}`);

        this.consume('RBRACE', "Expected '}' after comparison");
        return { type: 'standard', field, op, value };
      }

      if (this.check('TOLERANCE_OP')) {
        const rawOp = this.advance().value;
        const isPercent = rawOp.endsWith('%');
        const deltaStr = isPercent ? rawOp.slice(0, -1) : rawOp;
        const delta = Number.parseFloat(deltaStr);

        const centerToken = this.consume('NUMBER', 'Expected target numerical center for tolerance');
        const center = Number.parseFloat(centerToken.value);

        this.consume('RBRACE', "Expected '}' after tolerance check");
        return { type: 'tolerance', field, delta, isPercent, center };
      }

      throw new Error(`Expected operator inside '{...}' at token ${this.peek().value}`);
    }

    throw new Error(`Unexpected token '${this.peek().value}' at pos ${this.peek().position}`);
  }

  private parsePipelineOp(): PipelineStepAST {
    const opToken = this.consume('IDENTIFIER', 'Expected pipeline operation name');
    const opName = opToken.value;
    this.consume('LPAREN', `Expected '(' after ${opName}`);

    let step: PipelineStepAST;

    if (opName === 'sortAscending' || opName === 'sortDescending') {
      let field: string | undefined;
      if (this.check('IDENTIFIER')) {
        field = this.advance().value;
      }
      step = { type: opName, field };
    } else if (opName === 'limit') {
      const countToken = this.consume('NUMBER', 'Expected limit count');
      step = { type: 'limit', count: Number.parseInt(countToken.value, 10) };
    } else if (opName === 'timeRange') {
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
        end: parseTime(endToken)
      };
    } else {
      throw new Error(`Unknown pipeline operation '${opName}'`);
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
    return this.peek().type === type;
  }

  private advance(): Token {
    if (this.current < this.tokens.length) this.current++;
    return this.tokens[this.current - 1];
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private consume(type: TokenType, errMsg: string): Token {
    if (this.check(type)) return this.advance();
    throw new Error(`${errMsg} (found '${this.peek().value}' at position ${this.peek().position})`);
  }
}
