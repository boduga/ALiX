#!/usr/bin/env node
/** Compiler-bound static config inventory, not graph or dynamic-consumer proof. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { API } from 'typescript/unstable/sync';
import { SyntaxKind as K } from 'typescript/unstable/ast';
import ts from 'typescript';

const FIELDS = new Set(['model', 'subagents', 'modelTiers']);
const posix = value => value.split(sep).join('/');
const declarationKey = handle => `${handle.path}:${handle.index}`;
const hash = text => createHash('sha256').update(text).digest('hex');

/** Read source via the installed compiler; execute no project modules or models. */
export function auditConfigConsumers(root, { includeTests = false } = {}) {
  root = resolve(root);
  const configPath = resolve(root, 'tsconfig.json');
  const api = new API({ cwd: root });
  let snapshot;
  try {
    snapshot = api.updateSnapshot({ openProjects: [configPath] });
    const project = snapshot.getProject(configPath);
    if (!project) throw new Error('Compiler did not load the requested project');
    const diagnostics = project.program.getConfigFileParsingDiagnostics();
    if (diagnostics.length) throw new Error('Project config diagnostics prevent a complete file census');
    const checker = project.checker;
    const schema = project.program.getSourceFile(resolve(root, 'src/operations/config/schema.ts'));
    if (!schema) throw new Error('Config schema source missing from compiler project');
    const anchors = new Set();
    const visitAnchor = node => {
      if (node.kind === K.TypeAliasDeclaration && node.name.text === 'AlixConfig') {
        for (const member of node.type.members ?? []) {
          if (!FIELDS.has(member.name?.getText(schema))) continue;
          const symbol = checker.getSymbolAtLocation(member.name);
          for (const declaration of symbol?.declarations ?? []) anchors.add(declarationKey(declaration));
        }
      }
      node.forEachChild(visitAnchor);
    };
    visitAnchor(schema);
    if (anchors.size < 2) throw new Error('Expected model and subagents schema declaration anchors');
    const bound = symbol => Boolean(symbol?.declarations.some(decl => anchors.has(declarationKey(decl))));
    const property = (type, name) => type ? checker.getPropertyOfType(checker.getNonNullableType(type), name) : undefined;
    const files = project.program.getSourceFileNames().map(file => ({ file, path: posix(relative(root, file)) }))
      .filter(({ path }) => path.startsWith('src/') || (includeTests && path.startsWith('tests/')))
      .filter(({ path }) => /\.(?:ts|tsx|mts|cts)$/.test(path) && !path.endsWith('.d.ts'))
      .sort((a, b) => a.path.localeCompare(b.path, 'en'));
    const rows = [];
    const digests = [];
    for (const { file, path } of files) {
      const source = project.program.getSourceFile(file);
      if (!source) throw new Error(`Compiler source unavailable: ${path}`);
      digests.push(`${path}\0${hash(source.text)}`);
      const candidates = [];
      const visit = node => {
        if (node.kind === K.PropertyAccessExpression && FIELDS.has(node.name.text)) {
          candidates.push({ node, name: node.name, field: node.name.text, receiver: node.expression });
        } else if (node.kind === K.ElementAccessExpression) {
          const key = node.argumentExpression;
          if (key?.kind === K.StringLiteral && FIELDS.has(key.text)) {
            candidates.push({ node, field: key.text, receiver: node.expression });
          } else if (key && key.kind !== K.StringLiteral && key.kind !== K.NumericLiteral) {
            candidates.push({ node, field: '*', receiver: node.expression, dynamic: true });
          }
        } else if (node.kind === K.BindingElement && node.parent.kind === K.ObjectBindingPattern && FIELDS.has(node.propertyName?.text ?? node.name?.text)) {
          candidates.push({ node, field: node.propertyName?.text ?? node.name.text, receiver: node.parent });
        } else if ((node.kind === K.PropertyAssignment || node.kind === K.ShorthandPropertyAssignment) && FIELDS.has(node.name?.text)) {
          candidates.push({ node, field: node.name.text, context: node.parent });
        }
        node.forEachChild(visit);
      };
      visit(source);
      for (const candidate of candidates) {
        const type = candidate.context ? checker.getContextualType(candidate.context)
          : checker.getTypeAtLocation(candidate.receiver);
        const symbol = candidate.name ? checker.getSymbolAtLocation(candidate.name) : property(type, candidate.field);
        const schemaBound = bound(symbol);
        const configReceiver = ['model', 'subagents'].some(name => bound(property(type, name)));
        // Dynamic access on a subagents container also needs manual tier review.
        const nested = candidate.receiver?.kind === K.PropertyAccessExpression
          && candidate.receiver.name.text === 'subagents'
          && bound(checker.getSymbolAtLocation(candidate.receiver.name));
        if (candidate.dynamic && !configReceiver && !nested) continue;
        const declarations = symbol?.declarations ?? [];
        const classification = candidate.dynamic ? 'dynamic-config-key-unresolved'
          : schemaBound ? 'schema-bound-config-field'
          : declarations.length ? 'other-declared-field-review'
          : 'unresolved-named-field-review';
        const location = source.getLineAndCharacterOfPosition(candidate.node.getStart(source));
        rows.push({ file: path, line: location.line + 1, column: location.character + 1,
          field: candidate.field, syntax: K[candidate.node.kind], classification,
          declarations: declarations.map(decl => ({ file: posix(relative(root, decl.path)), nodeIndex: decl.index })) });
      }
    }
    let sourceCommit = null;
    try { sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Fixture roots need not be git repos. */ }
    const counts = Object.fromEntries(['schema-bound-config-field', 'dynamic-config-key-unresolved', 'other-declared-field-review', 'unresolved-named-field-review']
      .map(kind => [kind, rows.filter(row => row.classification === kind).length]));
    return { reportSchemaVersion: 1, sourceCommit, compilerVersion: ts.version,
      filesScanned: files.length, includesTests: includeTests,
      sourceDigestSha256: hash(digests.join('\n')), schemaDigestSha256: hash(schema.text), counts, references: rows,
      qualification: 'Compiler-bound static census only; no graph qualification, runtime usage, external consumer census, or retirement authorization.',
      limitations: ['Unresolved named fields are retained for manual triage, not silently classified unused.',
        'Nonliteral keys on identified config containers are unresolved; any-typed dynamic access, spreads, reflection, JSON strings, external plugins, and files outside the compiler project are not a complete consumer proof.'] };
  } finally {
    snapshot?.dispose();
    api.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--include-tests')) throw new Error('Usage: node config-consumer-inventory.mjs [--include-tests]');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  process.stdout.write(`${JSON.stringify(auditConfigConsumers(root, { includeTests: args.includes('--include-tests') }), null, 2)}\n`);
}
