import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";

export type ExtractedSymbolKind = "function" | "class" | "interface" | "type" | "const";

export type ExtractedSymbol = {
  path: string;
  name: string;
  kind: ExtractedSymbolKind;
  line: number;
  signature: string;
};

const parser = new Parser();
parser.setLanguage(TypeScript.typescript);

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
          signature: signatureText,
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