import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

// Vitest runs from apps/postcards (jsdom rewrites import.meta.url, so cwd it is).
const ROOT = process.cwd();

// Roles that make any element a control someone operates.
const CONTROL_ROLES = new Set(["button", "tab", "switch", "checkbox", "menuitem", "radio"]);

// Files whose controls get their titles with the rewrite in flight there,
// pending the ux-flags-map merge.
const PENDING = [
  "src/app/App.tsx",
  "src/features/map/",
  "src/features/visits/",
  "src/features/travel/PlacePicker.tsx",
];

function tsxFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) tsxFiles(path, acc);
    else if (path.endsWith(".tsx")) acc.push(path);
  }
  return acc;
}

/** The literal string an attribute holds, true for a bare one, undefined otherwise. */
function literal(attr: ts.JsxAttribute): string | true | undefined {
  const init = attr.initializer;
  if (!init) return true;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression && ts.isStringLiteralLike(init.expression)) {
    return init.expression.text;
  }
  return undefined;
}

/** Each control in the file lacking a `title`, as `path:line <tag>`. */
function untitled(path: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const attrs = new Map<string, string | true | undefined>();
      let spread = false;
      for (const prop of node.attributes.properties) {
        if (ts.isJsxSpreadAttribute(prop)) spread = true;
        else attrs.set(prop.name.getText(source), literal(prop));
      }
      const role = attrs.get("role");
      const control =
        tag === "button" ||
        tag === "select" ||
        tag === "textarea" ||
        tag === "summary" ||
        (tag === "a" && attrs.has("href")) ||
        (tag === "input" && attrs.get("type") !== "hidden" && attrs.get("hidden") !== true) ||
        (typeof role === "string" && CONTROL_ROLES.has(role)) ||
        (role === "option" && attrs.has("onClick"));
      if (control && !spread && !attrs.has("title")) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        hits.push(`${relative(ROOT, path)}:${line} <${tag}>`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

describe("interactive controls", () => {
  // Repo rule: every control a pointer or keyboard reaches carries a title, the
  // tooltip that names it for a mouse user. A spread may carry one, so it passes.
  it("each carry a title", () => {
    const missing = tsxFiles(join(ROOT, "src"))
      .flatMap(untitled)
      .filter((hit) => !PENDING.some((p) => hit.startsWith(p)));
    expect(missing).toEqual([]);
  });
});
