import { Compiler, Lexer, Parser, type QueryExecutor, type TelemetryPoint } from '.';

export function compileQuery<T extends TelemetryPoint = TelemetryPoint>(queryString: string): QueryExecutor<T> {
  const lexer = new Lexer(queryString);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  return Compiler.compilePipeline<T>(ast);
}
