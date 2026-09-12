import { describe, expect, test } from 'bun:test';
import { normalizeDisassemblyLine } from '../src/utils/hermes-base';

const normalize = (line: string) =>
  normalizeDisassemblyLine(line, new Map<number, string>());

describe('Hermes-base normalization must retain semantic differences', () => {
  test('does not collapse spaces inside a string literal', () => {
    expect(normalize('    LoadConstString r0, "a  b"')).not.toBe(
      normalize('    LoadConstString r0, "a b"'),
    );
  });

  test('does not erase a changed branch destination', () => {
    // In a whole-function regression both labels should already exist and
    // retain their locations; retarget a later branch between those labels.
    expect(normalize('    JmpTrue L1, r0')).not.toBe(
      normalize('    JmpTrue L2, r0'),
    );
  });

  test('negative control: different register operands remain different', () => {
    expect(normalize('    Add r0, r1, r2')).not.toBe(
      normalize('    Add r0, r1, r3'),
    );
  });

  test('positive control: column padding outside literals may be folded', () => {
    expect(normalize('    LoadConstString       r0, "same"')).toBe(
      normalize('    LoadConstString r0, "same"'),
    );
  });
});
