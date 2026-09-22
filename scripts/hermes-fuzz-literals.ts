import { parse } from '@babel/parser';

export interface FuzzStringLiteral {
  start: number;
  end: number;
  value: string;
}

/** Locate actual JS strings, never the gap between two closing/opening quotes. */
export function fuzzStringLiterals(source: string): FuzzStringLiteral[] {
  const { tokens = [] } = parse(source, {
    sourceType: 'script',
    tokens: true,
    errorRecovery: true,
  });
  const literals: FuzzStringLiteral[] = [];
  for (const token of tokens) {
    if (
      typeof token.type === 'object' &&
      token.type.label === 'string' &&
      typeof token.value === 'string'
    ) {
      literals.push({ start: token.start, end: token.end, value: token.value });
    }
  }
  return literals;
}
