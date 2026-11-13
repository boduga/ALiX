# TUI Code-Block Tokenizers

## Overview
Single-pass lexical tokenizers that turn fenced code-block text into `Token` streams for the rich response renderer. These are coloring aids, not compilers: the renderer knows only token kinds and delegates every visual decision to the `Theme`, so a tokenizer may stop at imperfect grammar without corrupting layout.

## Interface
- `Tokenizer` contract from the parent blocks types: `readonly language` plus `tokenize(code: string): Token[]` [../types.ts:Tokenizer]; token kinds are `keyword`, `string`, `comment`, `number`, `function`, `identifier`, `operator`, `punctuation`, `plain` [../types.ts:TokenKind].
- Language tokenizers: `plainTokenizer` [plain.ts:plainTokenizer], `jsonTokenizer` [json.ts:jsonTokenizer], `bashTokenizer` [bash.ts:bashTokenizer], `cppTokenizer` [cpp.ts:cppTokenizer], `goTokenizer` [go.ts:goTokenizer], `htmlTokenizer` [html.ts:htmlTokenizer], `pythonTokenizer` [python.ts:pythonTokenizer], `rubyTokenizer` [ruby.ts:rubyTokenizer], `rustTokenizer` [rust.ts:rustTokenizer], `typescriptTokenizer` [typescript.ts:typescriptTokenizer].
- Shared scanners: `consumeWhitespace`, `consumeHashComment`, `consumeString`, `consumeNumber`, `consumeIdentifier`, `lastNonPlainToken` [shared.ts:consumeIdentifier].
- Function-name detection is driven by per-language `functionKeywords`: `func` in Go [go.ts:goTokenizer], `fn` in Rust [rust.ts:rustTokenizer], `def`/`class` in Python [python.ts:pythonTokenizer], `def` in Ruby [ruby.ts:rubyTokenizer], `function`/`class` in TypeScript [typescript.ts:typescriptTokenizer].

## Invariants
- Empty input returns an empty token array in every tokenizer [json.ts:jsonTokenizer].
- `consumeIdentifier` only promotes the next identifier to `function` after a configured function keyword; it never guesses from naming conventions [shared.ts:consumeIdentifier].
- `pendingIsFunction` survives the whitespace run between a declaration keyword and its name, so `def foo` and `function foo` still color `foo` as a function [python.ts:pythonTokenizer].
- `plainTokenizer` preserves newline runs as their own tokens so the renderer can emit blank lines verbatim [plain.ts:plainTokenizer].
- TypeScript treats an identifier following `const`, `let`, or `var` as a function name, and treats `/` as division only after value-position tokens [typescript.ts:typescriptTokenizer].
- JSON recognizes only double-quoted strings and the keywords `true`, `false`, and `null` [json.ts:jsonTokenizer].
- Bash emits `$VAR` and `${VAR}` as identifier tokens and treats `#` to end-of-line as a comment [bash.ts:bashTokenizer].
- HTML emits comments, doctype declarations, tags, attributes, and text as distinct token kinds; it is not a full document parser [html.ts:htmlTokenizer].
- Ruby handles `%q`/`%Q`-style strings and heredocs as string tokens [ruby.ts:rubyTokenizer].
- C++ deliberately performs no function-name detection because it has no `fn`/`def`-style declaration keyword [cpp.ts:cppTokenizer].

## Side Effects
- ["None"] — pure string-to-token transformation with no I/O, terminal access, or shared state [shared.ts:consumeWhitespace].

## Verification
- Run: `pnpm test`
