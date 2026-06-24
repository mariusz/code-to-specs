// Extract single-JSX-element components from a .tsx module's AST.
//
// Handles the shadcn compound pattern: a file exporting a family of
// `forwardRef`/function components, each returning ONE JSX element with a
// `cn("classes", className)` className and `{...props}` (children passthrough).
// Returns one descriptor per component: { name, tag, classes, hasChildren }.

const TAG_TYPE = {
  div: "container", section: "container", nav: "container", header: "container",
  footer: "container", main: "container", article: "container", aside: "container",
  ul: "container", ol: "container", li: "container", form: "container", button: "container",
  span: "text", p: "text", h1: "text", h2: "text", h3: "text", h4: "text",
  h5: "text", h6: "text", label: "text", a: "text", strong: "text", em: "text",
  small: "text", blockquote: "text", figcaption: "text",
  svg: "vector", img: "rectangle", hr: "line",
};

export const tagToType = (tag) => TAG_TYPE[tag] || "container";

// Pull every string literal out of a className expression (cn("a","b", x) -> ["a","b"]).
function collectStrings(node, out) {
  if (!node) return;
  if (node.type === "StringLiteral") out.push(node.value);
  else if (node.type === "TemplateLiteral")
    out.push(node.quasis.map((q) => q.value.cooked).join(" ").trim());
  else if (node.type === "CallExpression") node.arguments.forEach((a) => collectStrings(a, out));
  // Identifiers (className passthrough) and variant-call ObjectExpressions contribute no static classes.
}

function returnedJSX(fnNode) {
  let body = fnNode.body;
  if (body && body.type === "BlockStatement") {
    const ret = body.body.find((s) => s.type === "ReturnStatement");
    body = ret && ret.argument;
  }
  return body && body.type === "JSXElement" ? body : null;
}

function describe(jsxEl) {
  const tagNode = jsxEl.openingElement.name;
  const tag = tagNode.type === "JSXIdentifier" ? tagNode.name : "div";
  const classes = [];
  let hasChildren = false;
  for (const a of jsxEl.openingElement.attributes) {
    if (a.type === "JSXSpreadAttribute") hasChildren = true;
    if (a.type === "JSXAttribute" && a.name.name === "className" && a.value) {
      if (a.value.type === "StringLiteral") classes.push(a.value.value);
      else if (a.value.type === "JSXExpressionContainer")
        collectStrings(a.value.expression, classes);
    }
  }
  return { tag, classes: classes.join(" "), hasChildren };
}

// traverse: the @babel/traverse default export (already unwrapped by caller)
export function extractJsxComponents(ast, traverse) {
  const comps = [];
  const displayNames = {}; // declaredId -> "DisplayName"

  traverse(ast, {
    // X.displayName = "Name"
    AssignmentExpression(p) {
      const { left, right } = p.node;
      if (
        left.type === "MemberExpression" &&
        left.property.name === "displayName" &&
        left.object.type === "Identifier" &&
        right.type === "StringLiteral"
      ) {
        displayNames[left.object.name] = right.value;
      }
    },
    VariableDeclarator(p) {
      const id = p.node.id;
      const init = p.node.init;
      if (!id || id.type !== "Identifier" || !init) return;
      let fn = null;
      if (
        init.type === "CallExpression" &&
        ((init.callee.type === "Identifier" && init.callee.name === "forwardRef") ||
          (init.callee.type === "MemberExpression" && init.callee.property.name === "forwardRef"))
      ) {
        fn = init.arguments[0];
      } else if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") {
        fn = init;
      }
      if (!fn) return;
      const jsx = returnedJSX(fn);
      if (jsx) comps.push({ _id: id.name, ...describe(jsx) });
    },
    FunctionDeclaration(p) {
      if (!p.node.id) return;
      const jsx = returnedJSX(p.node);
      if (jsx) comps.push({ _id: p.node.id.name, ...describe(jsx) });
    },
  });

  return comps.map((c) => ({
    name: displayNames[c._id] || c._id,
    tag: c.tag,
    classes: c.classes,
    hasChildren: c.hasChildren,
  }));
}
