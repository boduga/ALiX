I’ll provide the updated full implementation plan. It is too large to fit cleanly in one response without truncation, so I’ll split it into sections while preserving the original structure and checklist format.

## Part 1/3 — Overview, Architecture, Constraints, Tasks 1–3

---

# Response Blocks — Phase 1 Implementation Plan (Updated)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Approved implementation plan (updated)

**Goal:** Add a pure Markdown-to-`ResponseBlock[]` parser and update the agent tab renderer to consume structured response blocks instead of treating every response as a single wrapped string.

**Architecture:** A new pure function `parseResponseBlocks(md)` in `src/agent/response-blocks.ts` converts Markdown responses into typed presentation blocks using a line-oriented scanner. The parser preserves Markdown as the canonical source and introduces no persistence or protocol changes.

The agent view renderer consumes `ResponseBlock[]` and dispatches rendering by block type:

* `text` blocks delegate to existing `wrapText`
* `code` blocks render without Markdown fences, preserve line structure, and use a 2-space indent
* `list` blocks normalize markers and wrap individual items

The parser is transport-agnostic and lives in `src/agent/` because future phases will reuse the same representation for API, daemon, and web rendering.

**Tech Stack:** TypeScript, Vitest, existing `TerminalCanvas`, existing `wrapText`.

**Spec:**
`docs/superpowers/specs/2026-07-25-response-blocks-design.md`

---

# Global Constraints

Every task must preserve these invariants.

## ResponseBlock contract

`ResponseBlock` is exactly:

```ts
export type ResponseBlock =
  | { type: "text"; text: string }
  | { type: "code"; language?: string; code: string; fenced: true }
  | { type: "list"; marker: "-" | "*" | "+" | "ordered"; items: string[] };
```

`ListMarker` is:

```ts
export type ListMarker = "-" | "*" | "+" | "ordered";
```

---

## Parser invariants

`parseResponseBlocks(md)` must:

* be deterministic
* be pure
* execute in linear O(n)
* scan input once
* preserve source order
* never mutate input
* never throw for malformed Markdown
* never emit empty blocks

Additional guarantees:

* empty input returns `[]`
* whitespace-only input returns `[]`
* CRLF is normalized to LF
* malformed fences become text blocks
* unsupported Markdown remains text
* parser never modifies stored Markdown

---

## Markdown support scope

### Supported

#### Text

Normal prose:

```md
hello world
```

#### Code

Only exactly three backtick fences:

````md
```typescript
const x = 1;
````

````

Supported:

- optional language identifier
- multiline content
- empty code blocks

Example:

```md
````

```
```

Produces:

```ts
{
  type: "code",
  code: "",
  fenced: true
}
```

---

### Unsupported

These remain text:

```md
~~~python
```

`````md
````python
`````

```md
`inline`
```

```md
``
```

---

## Fence rules

Opening fence:

* exactly three backticks
* must begin at column zero
* may have optional language tag
* language cannot contain whitespace or backticks

Valid:

````md
```ts
````

Invalid:

`````md
 ````ts
`````

`````md
````ts
`````

Closing fence:

Valid:

```md
```

````

```md
````

````

Invalid:

```md
````

````

---

## List rules

Supported:

```md
- item
* item
+ item
1. item
````

Normalization:

* unordered markers preserve source marker internally
* renderer displays unordered lists as `•`
* ordered lists become sequential `1.`, `2.`, `3.`

Adjacent lists with different markers become separate list blocks.

Example:

Input:

```md
- a
* b
```

Output:

```ts
[
 {
   type:"list",
   marker:"-",
   items:["a"]
 },
 {
   type:"list",
   marker:"*",
   items:["b"]
 }
]
```

---

# File Structure

| File                                     | Action | Responsibility               |
| ---------------------------------------- | ------ | ---------------------------- |
| `src/agent/response-blocks.ts`           | Create | ResponseBlock types + parser |
| `src/tui/views/agent-view.ts`            | Modify | Structured block rendering   |
| `tests/response-blocks-parser.vitest.ts` | Create | Parser tests                 |
| `tests/agent-view-formatting.vitest.ts`  | Modify | Renderer tests               |

---

# Task 1 — Define ResponseBlock Types

## Files

Create:

```
src/agent/response-blocks.ts
```

---

## Step 1: Create type definitions

```ts
// src/agent/response-blocks.ts

/**
 * Source marker preserved from Markdown list syntax.
 */
export type ListMarker =
  | "-"
  | "*"
  | "+"
  | "ordered";


/**
 * Structured representation of an agent response.
 *
 * Markdown remains the canonical persisted artifact.
 * ResponseBlock is only a presentation model.
 *
 * Phase 1 supports:
 * - text paragraphs
 * - fenced code blocks
 * - bullet and ordered lists
 */
export type ResponseBlock =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "code";
      language?: string;
      code: string;
      fenced: true;
    }
  | {
      type: "list";
      marker: ListMarker;
      items: string[];
    };
```

---

## Step 2: Verify build

Run:

```bash
pnpm build
```

Expected:

```
PASS
```

---

## Step 3: Commit

```bash
git add src/agent/response-blocks.ts

git commit -m "feat(agent): add ResponseBlock type for structured agent responses"
```

---

# Task 2 — Parser: Empty Input and Plain Text

## Files

Modify:

```
src/agent/response-blocks.ts
```

Create:

```
tests/response-blocks-parser.vitest.ts
```

---

## Step 1: Add tests

```ts
describe("parseResponseBlocks — text", () => {

  it("returns [] for empty input", () => {
    expect(parseResponseBlocks(""))
      .toEqual([]);
  });


  it("returns [] for whitespace only", () => {
    expect(parseResponseBlocks(" \n\t "))
      .toEqual([]);
  });


  it("wraps prose as text", () => {
    expect(parseResponseBlocks("hello"))
      .toEqual([
        {
          type:"text",
          text:"hello"
        }
      ]);
  });


  it("preserves internal newlines", () => {
    expect(parseResponseBlocks(
      "one\ntwo\nthree"
    ))
    .toEqual([
      {
        type:"text",
        text:"one\ntwo\nthree"
      }
    ]);
  });


  it("preserves blank lines", () => {
    expect(parseResponseBlocks(
      "first\n\nsecond"
    ))
    .toEqual([
      {
        type:"text",
        text:"first\n\nsecond"
      }
    ]);
  });


  it("normalizes CRLF", () => {
    expect(parseResponseBlocks(
      "one\r\ntwo"
    ))
    .toEqual([
      {
        type:"text",
        text:"one\ntwo"
      }
    ]);
  });

});
```

---

## Step 2: Verify failure

Run:

```bash
npx vitest run tests/response-blocks-parser.vitest.ts
```

Expected:

FAIL

---

## Step 3: Implement parser skeleton

```ts
export function parseResponseBlocks(
  md: string
): readonly ResponseBlock[] {

  if (!md || !md.trim()) {
    return [];
  }


  const blocks: ResponseBlock[] = [];

  const lines = md.split(/\r?\n/);


  const text = lines.join("\n");


  if (text.trim()) {
    blocks.push({
      type:"text",
      text
    });
  }


  return blocks;
}
```

---

## Step 4: Run tests

```bash
npx vitest run tests/response-blocks-parser.vitest.ts
```

Expected:

PASS

---

## Step 5: Commit

```bash
git add .

git commit -m "feat(agent): parseResponseBlocks handles plain text"
```

---

# Task 3 — Parser: Fenced Code Blocks

## Files

Modify:

```
src/agent/response-blocks.ts
tests/response-blocks-parser.vitest.ts
```

---

## Step 1: Add code fence tests

Include:

* language fence
* no-language fence
* multiple code blocks
* unclosed fence fallback
* tilde fence text
* single backtick text
* two-backtick text
* four-backtick text
* mismatched fence text

---

## Step 2: Implement exact fence matching

Add:

````ts
function matchFenceOpen(
  line:string
): {language?:string} | null {

  const match =
    /^```(?!`)([^\s`]*)\s*$/.exec(line);


  if (!match) {
    return null;
  }


  return {
    language:
      match[1] || undefined
  };
}



function matchFenceClose(
  line:string
): boolean {

  return line.trimEnd() === "```";
}
````

---

## Step 3: Implement code scanning

Rules:

* flush text before code
* collect until exact closing fence
* if closing fence missing:

  * emit original fence + content as text
  * never throw

Example:

Input:

````md
```ts
hello
````

Output:

````ts
[
 {
   type:"text",
   text:"```ts\nhello"
 }
]
````

---

## Step 4: Verify

```bash
npx vitest run tests/response-blocks-parser.vitest.ts
```

Expected:

PASS

---

## Step 5: Commit

```bash
git add .

git commit -m "feat(agent): parseResponseBlocks recognizes fenced code blocks"
```

---

**Part 2/3 continues with Task 4 (lists), Task 5 (TUI code rendering), and Task 6 (list rendering).**
# Part 2/3 — Lists, Agent View Rendering, Tests

---

# Task 4 — Parser: Lists

## Files

Modify:

```text
src/agent/response-blocks.ts
tests/response-blocks-parser.vitest.ts
```

---

## Goal

Extend `parseResponseBlocks()` to recognize contiguous Markdown list blocks.

Supported syntax:

```md
- first
- second
- third
```

```md
* alpha
* beta
```

```md
+ one
+ two
```

```md
1. one
2. two
3. three
```

---

## Step 1: Add list parser tests

Add:

`````ts
describe("parseResponseBlocks — lists", () => {

  it("parses dash lists", () => {
    expect(
      parseResponseBlocks("- a\n- b\n- c")
    ).toEqual([
      {
        type:"list",
        marker:"-",
        items:[
          "a",
          "b",
          "c"
        ]
      }
    ]);
  });


  it("parses star lists", () => {
    expect(
      parseResponseBlocks("* a\n* b")
    ).toEqual([
      {
        type:"list",
        marker:"*",
        items:[
          "a",
          "b"
        ]
      }
    ]);
  });


  it("parses plus lists", () => {
    expect(
      parseResponseBlocks("+ a\n+ b")
    ).toEqual([
      {
        type:"list",
        marker:"+",
        items:[
          "a",
          "b"
        ]
      }
    ]);
  });


  it("normalizes ordered lists", () => {
    expect(
      parseResponseBlocks(
        "1. one\n5. five\n20. twenty"
      )
    ).toEqual([
      {
        type:"list",
        marker:"ordered",
        items:[
          "one",
          "five",
          "twenty"
        ]
      }
    ]);
  });


  it("ends list on non-list content", () => {
    expect(
      parseResponseBlocks(
        "- a\n- b\n\nnext"
      )
    ).toEqual([
      {
        type:"list",
        marker:"-",
        items:[
          "a",
          "b"
        ]
      },
      {
        type:"text",
        text:"next"
      }
    ]);
  });


  it("preserves source order", () => {
    expect(
      parseResponseBlocks(
        "intro\n\n- item\n\noutro"
      )
    ).toEqual([
      {
        type:"text",
        text:"intro"
      },
      {
        type:"list",
        marker:"-",
        items:[
          "item"
        ]
      },
      {
        type:"text",
        text:"outro"
      }
    ]);
  });


  it("drops empty list items", () => {
    expect(
      parseResponseBlocks(
        "-\n- good\n- "
      )
    ).toEqual([
      {
        type:"list",
        marker:"-",
        items:[
          "good"
        ]
      }
    ]);
  });


  it("keeps different adjacent markers separate", () => {
    expect(
      parseResponseBlocks(
        "- a\n* b"
      )
    ).toEqual([
      {
        type:"list",
        marker:"-",
        items:[
          "a"
        ]
      },
      {
        type:"list",
        marker:"*",
        items:[
          "b"
        ]
      }
    ]);
  });


  it("does not throw on malformed input", () => {
    const inputs = [
      "",
      "~~~",
      "```",
      "````",
      "-",
      "*",
      "+",
      "1.",
      "\0"
    ];


    for (const input of inputs) {
      expect(() =>
        parseResponseBlocks(input)
      ).not.toThrow();
    }
  });

});
`````

---

## Step 2: Verify failure

Run:

```bash
npx vitest run tests/response-blocks-parser.vitest.ts
```

Expected:

FAIL

---

## Step 3: Add list matcher

Add:

```ts
function matchListItem(
  line:string
): {
  marker:ListMarker;
  text:string;
} | null {


  const dash =
    /^-\s+(.*)$/.exec(line);

  if (dash) {
    return {
      marker:"-",
      text:dash[1]!
    };
  }


  const star =
    /^\*\s+(.*)$/.exec(line);

  if (star) {
    return {
      marker:"*",
      text:star[1]!
    };
  }


  const plus =
    /^\+\s+(.*)$/.exec(line);

  if (plus) {
    return {
      marker:"+",
      text:plus[1]!
    };
  }


  const ordered =
    /^\d+\.\s+(.*)$/.exec(line);


  if (ordered) {
    return {
      marker:"ordered",
      text:ordered[1]!
    };
  }


  return null;
}
```

---

## Step 4: Extend scanner

Processing order:

1. fenced code
2. list
3. text

This prevents:

````md
```text
- not a list
````

````

from becoming a list item.

---

List scanning:

```ts
const item = matchListItem(line);

if (item) {

  flushText();


  const marker = item.marker;
  const items:string[] = [];


  if (item.text.trim()) {
    items.push(item.text);
  }


  i++;


  while (i < lines.length) {

    const next =
      matchListItem(lines[i]!);


    if (!next || next.marker !== marker) {
      break;
    }


    if (next.text.trim()) {
      items.push(next.text);
    }


    i++;
  }


  if (items.length) {
    blocks.push({
      type:"list",
      marker,
      items
    });
  }


  continue;
}
````

---

## Step 5: Run tests

```bash
npx vitest run tests/response-blocks-parser.vitest.ts
```

Expected:

```text
PASS
```

---

## Step 6: Commit

```bash
git add .

git commit -m "feat(agent): parseResponseBlocks recognizes markdown lists"
```

---

# Task 5 — Agent View: Structured Text and Code Rendering

## Files

Modify:

```text
src/tui/views/agent-view.ts
tests/agent-view-formatting.vitest.ts
```

---

## Goal

Replace:

```ts
Markdown string
        |
        v
wrapText()
```

with:

```text
Markdown string
        |
        v
parseResponseBlocks()
        |
        v
block renderer
```

---

## Rendering contract

### Text blocks

Existing behavior:

```ts
wrapText()
```

must remain unchanged.

---

### Code blocks

Rules:

* no Markdown fences
* no wrapping
* preserve line order
* prefix every line with two spaces
* optional language header:

Example:

Input:

````md
```python
print("hello")
````

````

Rendered:

```text
  [python]
  print("hello")
````

---

## Step 1: Add renderer tests

Add:

````ts
describe(
  "AgentView — code blocks",
  () => {


it(
"renders multiline code",
() => {

 const perTab =
   makePerTab({
     agentResponses:[
       "```python\nx=1\ny=2\n```"
     ]
   });


 const canvas =
   renderOnCanvas(
     80,
     40,
     perTab
   );


 const all =
   allText(canvas,12);


 expect(all)
   .toContain("x=1");


 expect(all)
   .toContain("y=2");

});


it(
"does not show markdown fences",
() => {

 const perTab =
   makePerTab({
     agentResponses:[
       "```ts\nconst x=1;\n```"
     ]
   });


 const all =
   allText(
     renderOnCanvas(
       80,
       40,
       perTab
     ),
     10
   );


 expect(all)
   .not
   .toContain("```");

});


it(
"renders language labels",
() => {

 const perTab =
   makePerTab({
     agentResponses:[
       "```typescript\nx\n```"
     ]
   });


 expect(
   allText(
     renderOnCanvas(
       80,
       40,
       perTab
     ),
     10
   )
 )
 .toContain("[typescript]");

});


});
````

---

## Step 2: Verify failure

Run:

```bash
npx vitest run tests/agent-view-formatting.vitest.ts
```

Expected:

FAIL

---

## Step 3: Import parser

Add:

```ts
import {
  parseResponseBlocks
} from "../../agent/response-blocks.js";
```

---

## Step 4: Add internal renderer helper

Add:

```ts
interface RenderedLine {

  kind:
    | "user"
    | "agent"
    | "plan"
    | "approval";

  text:string;

  isFirst:boolean;
}
```

---

Add:

```ts
function renderAgentResponse(
  text:string,
  kind:"user"|"agent",
  textWidth:number
):RenderedLine[] {


 const output:RenderedLine[] = [];


 const blocks =
   parseResponseBlocks(text);



 for (const block of blocks) {


   if (block.type === "text") {

     const lines =
       wrapText(
         block.text,
         textWidth
       );


     lines.forEach(
       (line,index)=> {

         output.push({
           kind,
           text:line,
           isFirst:index===0
         });

       }
     );

   }



   else if (block.type === "code") {


     if (block.language) {

       output.push({
         kind,
         text:`  [${block.language}]`,
         isFirst:true
       });

     }


     for (
       const line of block.code.split("\n")
     ) {

       output.push({
         kind,
         text:`  ${line}`,
         isFirst:false
       });

     }

   }

 }


 return output;
}
```

---

## Step 5: Replace old wrapping loop

Before:

```ts
const wrapped =
  wrapText(
    t.text,
    textWidth
  );
```

After:

```ts
const rendered =
  renderAgentResponse(
    t.text,
    t.kind,
    textWidth
  );


for (const line of rendered) {
  allLines.push(line);
}
```

---

## Step 6: Run tests

```bash
npx vitest run tests/agent-view-formatting.vitest.ts
```

Expected:

PASS

---

## Step 7: Commit

```bash
git add .

git commit -m "feat(tui): render agent responses through ResponseBlocks"
```

---

**Part 3/3 continues with list rendering, full verification, acceptance criteria, and final checklist.**
# Part 3/3 — List Rendering, Verification, Acceptance Criteria

---

# Task 6 — Agent View: List Rendering

## Files

Modify:

```text
src/tui/views/agent-view.ts
tests/agent-view-formatting.vitest.ts
```

---

## Goal

Extend the agent renderer to support:

```ts
ResponseBlock {
  type:"list"
}
```

without changing Markdown storage.

Rendering rules:

### Unordered lists

All unordered markers:

```md
- item
* item
+ item
```

render as:

```text
• item
```

---

### Ordered lists

Input:

```md
10. alpha
20. beta
30. gamma
```

renders:

```text
1. alpha
2. beta
3. gamma
```

The source numbering is intentionally ignored.

---

### Wrapping

List items must wrap independently.

Example:

Input:

```md
- This is a very long item that needs wrapping
```

Output:

```text
• This is a very long item that
  needs wrapping
```

Continuation lines align after the bullet prefix.

---

## Step 1: Add tests

Add:

```ts
describe(
  "AgentView — list rendering",
  () => {


it(
"renders unordered lists with bullets",
() => {

 const perTab =
   makePerTab({
     agentResponses:[
       "- first\n- second"
     ]
   });


 const all =
   allText(
     renderOnCanvas(
       80,
       40,
       perTab
     ),
     12
   );


 expect(all)
   .toContain("• first");


 expect(all)
   .toContain("• second");

});



it(
"renders ordered lists sequentially",
() => {

 const perTab =
   makePerTab({
     agentResponses:[
       "5. five\n9. nine\n20. twenty"
     ]
   });


 const all =
   allText(
     renderOnCanvas(
       80,
       40,
       perTab
     ),
     12
   );


 expect(all)
   .toContain("1. five");


 expect(all)
   .toContain("2. nine");


 expect(all)
   .toContain("3. twenty");

});



it(
"preserves text-list-text order",
() => {

 const perTab =
   makePerTab({
     agentResponses:[
       "before\n\n- item\n\nafter"
     ]
   });


 const all =
   allText(
     renderOnCanvas(
       80,
       40,
       perTab
     ),
     12
   );


 expect(
   all.indexOf("before")
 )
 .toBeLessThan(
   all.indexOf("• item")
 );


 expect(
   all.indexOf("• item")
 )
 .toBeLessThan(
   all.indexOf("after")
 );

});



it(
"wraps long list items",
() => {

 const perTab =
   makePerTab({
     agentResponses:[
       "- " +
       "a ".repeat(80)
     ]
   });


 expect(
   () =>
   renderOnCanvas(
     40,
     40,
     perTab
   )
 )
 .not
 .toThrow();

});


});
```

---

## Step 2: Verify failure

Run:

```bash
npx vitest run tests/agent-view-formatting.vitest.ts
```

Expected:

FAIL

---

## Step 3: Extend `renderAgentResponse`

Add list handling:

```ts
else if (block.type === "list") {


  block.items.forEach(
    (item,index)=> {


      const prefix =
        block.marker === "ordered"
          ? `${index + 1}. `
          : "• ";


      const continuation =
        " ".repeat(
          prefix.length
        );


      const width =
        Math.max(
          1,
          textWidth - prefix.length
        );


      const wrapped =
        wrapText(
          item,
          width
        );


      wrapped.forEach(
        (line,lineIndex)=> {

          output.push({
            kind,
            text:
              lineIndex === 0
                ? prefix + line
                : continuation + line,

            isFirst:
              lineIndex === 0
          });

        }
      );

    }
  );

}
```

---

## Step 4: Run tests

Run:

```bash
npx vitest run tests/agent-view-formatting.vitest.ts
```

Expected:

```text
PASS
```

---

## Step 5: Run full suite

Run:

```bash
pnpm test:vitest
```

Expected:

```text
All tests pass
```

---

## Step 6: Commit

```bash
git add src/tui/views/agent-view.ts tests/agent-view-formatting.vitest.ts

git commit -m "feat(tui): render response lists with normalized formatting"
```

---

# Task 7 — Verification and Acceptance

## Files

No required modifications.

---

# Step 1 — Build verification

Run:

```bash
pnpm build
```

Expected:

```text
TypeScript compilation succeeds
```

---

# Step 2 — Parser verification

Run:

```bash
npx vitest run tests/response-blocks-parser.vitest.ts
```

Expected coverage:

* empty input
* whitespace input
* plain text
* newline preservation
* CRLF normalization
* fenced code
* language tags
* empty code blocks
* multiple code blocks
* malformed fences
* tilde fences
* invalid fence lengths
* bullet lists
* ordered lists
* mixed content
* malformed input tolerance

---

# Step 3 — Renderer verification

Run:

```bash
npx vitest run tests/agent-view-formatting.vitest.ts
```

Expected coverage:

* text rendering unchanged
* code block rendering
* language labels
* no Markdown fences visible
* code line preservation
* unordered lists
* ordered lists
* wrapping behavior
* source ordering

---

# Step 4 — Full regression suite

Run:

```bash
pnpm test:vitest
```

Expected:

```text
Existing tests continue passing.
New parser and renderer tests pass.
```

No expected changes:

* `AgentTurnResult`
* `PerTabState`
* session persistence
* daemon protocol
* API contracts

---

# Step 5 — Live TUI smoke test

Run:

```bash
npx alix tui
```

or:

```bash
node bin/alix.js tui
```

---

Submit:

```text
write a python function to check if a string is a palindrome
```

---

Verify:

## Before fix

A response such as:

````md
Here is the function:

```python
def palindrome(s):
    return s == s[::-1]
````

````

was displayed as a collapsed wrapped line.

---

## After fix

The TUI should display:

```text
Here is the function:

  [python]
  def palindrome(s):
      return s == s[::-1]
````

Verification:

* code occupies multiple rows
* indentation is preserved
* prose still wraps normally
* Markdown fences are hidden
* stored Markdown remains unchanged

---

# Step 6 — Visual cleanup if needed

Only if smoke testing finds issues:

```bash
git add -A

git commit -m "fix(tui): polish response block rendering"
```

---

# Final Acceptance Checklist

## Parser

* [ ] `ResponseBlock` union contains exactly three block types
* [ ] Parser is pure
* [ ] Parser is deterministic
* [ ] Parser is O(n)
* [ ] Parser preserves ordering
* [ ] Parser never throws
* [ ] Parser never emits empty blocks
* [ ] Parser normalizes CRLF
* [ ] Parser does not mutate Markdown

---

## Markdown handling

* [ ] Plain text works
* [ ] Three-backtick fences work
* [ ] Longer fences remain text
* [ ] Tilde fences remain text
* [ ] Single backticks remain text
* [ ] Unclosed fences become text
* [ ] Lists preserve source marker
* [ ] Adjacent different-marker lists remain separate

---

## TUI rendering

* [ ] Text blocks use existing `wrapText`
* [ ] Code blocks do not use wrapping
* [ ] Code blocks preserve line structure
* [ ] Code blocks use two-space indentation
* [ ] Language labels render as `[language]`
* [ ] Markdown fences are never shown
* [ ] Lists normalize bullets
* [ ] Ordered lists renumber sequentially
* [ ] List continuation lines align correctly

---

## Architecture

* [ ] Markdown remains canonical storage format
* [ ] No changes to `AgentTurnResult`
* [ ] No changes to persistence
* [ ] No changes to daemon protocol
* [ ] Parser remains reusable outside TUI
* [ ] Renderer-specific logic remains in `agent-view.ts`

---

# Final Commit Sequence

Expected commits:

```bash
feat(agent): add ResponseBlock type for structured agent responses

feat(agent): parseResponseBlocks handles plain text

feat(agent): parseResponseBlocks recognizes fenced code blocks

feat(agent): parseResponseBlocks recognizes markdown lists

feat(tui): render agent responses through ResponseBlocks

feat(tui): render response lists with normalized formatting
```

---

## Implementation Ready Status

✅ Architecture validated
✅ Parser boundaries defined
✅ Renderer isolation preserved
✅ Backward compatibility maintained
✅ Future web/API renderer reuse enabled

This version is ready for agent-driven implementation. 🚀

