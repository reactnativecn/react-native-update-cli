import { describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const commandFiles = [
  'src/app.ts',
  'src/bundle.ts',
  'src/diff.ts',
  'src/install.ts',
  'src/package.ts',
  'src/user.ts',
  'src/versions.ts',
];

function findThisUsagesInCommandMaps(filePath: string): string[] {
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const errors: string[] = [];

  function visitCommandMap(node: ts.Node): void {
    function scanForThis(child: ts.Node): void {
      if (child.kind === ts.SyntaxKind.ThisKeyword) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(
          child.getStart(sourceFile),
        );
        errors.push(`${filePath}:${line + 1}:${character + 1}`);
      }
      ts.forEachChild(child, scanForThis);
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text.endsWith('Commands') &&
      node.initializer
    ) {
      scanForThis(node.initializer);
      return;
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text.startsWith('get') &&
      node.name.text.endsWith('Commands') &&
      node.body
    ) {
      scanForThis(node.body);
      return;
    }

    ts.forEachChild(node, visitCommandMap);
  }

  visitCommandMap(sourceFile);
  return errors;
}

describe('cli command maps', () => {
  test('do not depend on receiver this binding', () => {
    const projectRoot = path.resolve(import.meta.dir, '..');
    const thisUsages = commandFiles.flatMap((file) =>
      findThisUsagesInCommandMaps(path.join(projectRoot, file)),
    );

    expect(thisUsages).toEqual([]);
  });
});
