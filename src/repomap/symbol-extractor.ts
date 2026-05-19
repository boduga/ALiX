import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";

export type ExtractedSymbolKind = "function" | "class" | "interface" | "type" | "const" | "method";

export type ExtractedSymbol = {
  path: string;
  name: string;
  kind: ExtractedSymbolKind;
  line: number;
  startByte: number;
  endByte: number;
  signature: string;
};

const parser = new Parser();
parser.setLanguage(TypeScript.typescript);

// Compute byte offset from a Point (row, column) within a given content string
function byteOffset(content: string, row: number, column: number): number {
  let offset = 0;
  const lines = content.split("\n");
  for (let i = 0; i < row && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for newline
  }
  return offset + column;
}

export function extractTopLevelSymbols(path: string, content: string): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];

  let tree;
  try {
    tree = parser.parse(content);
  } catch (e) {
    // If tree-sitter parsing fails, return empty array
    return symbols;
  }

  const rootNode = tree.rootNode;

  function traverse(node: Parser.SyntaxNode) {
    const nodeType = node.type;
    const startLine = node.startPosition.row + 1;
    // Compute byte offsets from content string
    const startByte = byteOffset(content, node.startPosition.row, node.startPosition.column);
    const endByte = byteOffset(content, node.endPosition.row, node.endPosition.column);

    if (nodeType === "function_declaration") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        // Use parent (export_statement) text to include "export " prefix
        const signatureText = node.parent ? node.parent.text : node.text;
        symbols.push({
          path,
          name: nameNode.text,
          kind: "function",
          line: startLine,
          startByte,
          endByte,
          signature: signatureText,
        });
      }
    } else if (nodeType === "method_definition") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        symbols.push({
          path,
          name: nameNode.text,
          kind: "method",
          line: startLine,
          startByte,
          endByte,
          signature: node.text,
        });
      }
    } else if (nodeType === "class_declaration") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        const signatureText = node.parent ? node.parent.text : node.text;
        symbols.push({
          path,
          name: nameNode.text,
          kind: "class",
          line: startLine,
          startByte,
          endByte,
          signature: signatureText,
        });
      }
    } else if (nodeType === "interface_declaration") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        const signatureText = node.parent ? node.parent.text : node.text;
        symbols.push({
          path,
          name: nameNode.text,
          kind: "interface",
          line: startLine,
          startByte,
          endByte,
          signature: signatureText,
        });
      }
    } else if (nodeType === "type_alias_declaration") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        const signatureText = node.parent ? node.parent.text : node.text;
        symbols.push({
          path,
          name: nameNode.text,
          kind: "type",
          line: startLine,
          startByte,
          endByte,
          signature: signatureText,
        });
      }
    } else if (nodeType === "lexical_declaration") {
      const declList = node.namedChild(0);
      if (declList?.type === "variable_declarator") {
        const nameNode = declList.childForFieldName("name");
        if (nameNode) {
          // Use parent (export_statement) text to include "export " prefix
          const signatureText = node.parent ? node.parent.text : node.text;
          symbols.push({
            path,
            name: nameNode.text,
            kind: "const",
            line: startLine,
            startByte,
            endByte,
            signature: signatureText,
          });
        }
      }
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) traverse(child);
    }
  }

  traverse(rootNode);

  return symbols;
}