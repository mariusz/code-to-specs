#!/usr/bin/env node
// Reverse-engineer a CVA/shadcn component (.tsx) into a Specs component.schema.json.
//
//   node bin/cva-to-spec.mjs --component button
//   node bin/cva-to-spec.mjs --file /abs/path/to/foo.tsx
//
// Strategy: parse the real AST (not regex), pull the cva() base + variant groups
// + defaultVariants, map Tailwind classes to Specs Styles/TokenReferences, and
// emit a schema-valid Component. Figma-only provenance (metadata.source) is
// omitted — it isn't required by the schema for code-origin specs.
import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import { UI_DIR, OUT_DIR } from "../config.mjs";
import { twToStyles } from "../lib/tw-map.mjs";
import { extractJsxComponents, tagToType } from "../lib/jsx-extract.mjs";

const traverse = _traverse.default || _traverse;

// ── args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const compArg = getArg("--component");
const fileArg = getArg("--file");
const file = fileArg || (compArg && path.join(UI_DIR, `${compArg}.tsx`));
if (!file) {
  console.error("usage: cva-to-spec.mjs --component <name> | --file <path>");
  process.exit(2);
}
const source = fs.readFileSync(file, "utf8");

// ── parse ─────────────────────────────────────────────────────────────
const ast = parse(source, {
  sourceType: "module",
  plugins: ["typescript", "jsx"],
});

// Pull out the first cva(base, config) call and the most-relevant Props interface.
let cvaBase = null;
let cvaConfig = null;
const booleanProps = {}; // name -> default
let hasChildren = true; // shadcn primitives forward children by default

const strOf = (node) => (node && node.type === "StringLiteral" ? node.value : null);
const objToMap = (objExpr) => {
  const out = {};
  for (const p of objExpr.properties) {
    if (p.type !== "ObjectProperty") continue;
    const key = p.key.name ?? p.key.value;
    out[key] = p.value;
  }
  return out;
};

traverse(ast, {
  CallExpression(p) {
    const callee = p.node.callee;
    if (callee.type === "Identifier" && callee.name === "cva") {
      cvaBase = strOf(p.node.arguments[0]) ?? "";
      const cfg = p.node.arguments[1];
      if (cfg && cfg.type === "ObjectExpression") cvaConfig = cfg;
    }
  },
  TSInterfaceBody(p) {
    for (const m of p.node.body) {
      if (m.type !== "TSPropertySignature" || !m.key) continue;
      const name = m.key.name;
      const t = m.typeAnnotation?.typeAnnotation?.type;
      if (t === "TSBooleanKeyword") booleanProps[name] = false;
    }
  },
});

const hasCva = cvaBase !== null || cvaConfig !== null;

// ── extract variant groups + defaults ─────────────────────────────────
const cfgMap = cvaConfig ? objToMap(cvaConfig) : {};
const variantGroups = {}; // group -> { value -> classString }
if (cfgMap.variants && cfgMap.variants.type === "ObjectExpression") {
  for (const [group, valuesNode] of Object.entries(objToMap(cfgMap.variants))) {
    if (valuesNode.type !== "ObjectExpression") continue;
    variantGroups[group] = {};
    for (const [value, classNode] of Object.entries(objToMap(valuesNode))) {
      variantGroups[group][value] = strOf(classNode) ?? "";
    }
  }
}
const defaults = {};
if (cfgMap.defaultVariants && cfgMap.defaultVariants.type === "ObjectExpression") {
  for (const [group, valNode] of Object.entries(objToMap(cfgMap.defaultVariants))) {
    defaults[group] = strOf(valNode);
  }
}

const title = (compArg || path.basename(file, ".tsx")).replace(/(^|[-_])(\w)/g, (_, __, c) =>
  c.toUpperCase(),
);

// ── JSX family (anatomy from real elements + subcomponents + slots) ─────
const jsxComps = extractJsxComponents(ast, traverse);
const allUnmapped = new Set();

// ── styles helpers ─────────────────────────────────────────────────────
// Compute root+label Styles for a set of class strings (base + chosen values).
function stylesFor(...classStrings) {
  const root = {};
  const label = {};
  const unmapped = [];
  const skipped = [];
  for (const cs of classStrings) {
    if (!cs) continue;
    const r = twToStyles(cs);
    Object.assign(root, r.root);
    Object.assign(label, r.label);
    // typography needs deep-merge
    if (r.label.typography)
      label.typography = { ...(label.typography || {}), ...r.label.typography };
    unmapped.push(...r.unmapped);
    skipped.push(...r.skippedState);
  }
  return { root, label, unmapped, skipped };
}

const camel = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// Build a single element object (type + children/content binding + styles)
// from one JSX-leaf component descriptor.
function jsxElement(comp) {
  const type = tagToType(comp.tag);
  const s = stylesFor(comp.classes);
  s.unmapped.forEach((u) => allUnmapped.add(u));
  const styles = { ...s.root, ...s.label };
  if (s.label.typography)
    styles.typography = { ...(s.root.typography || {}), ...s.label.typography };
  const el = {};
  if (comp.hasChildren) {
    if (type === "text") el.content = { $binding: "#/props/children" };
    else el.children = { $binding: "#/props/children" };
  }
  if (Object.keys(styles).length) el.styles = styles;
  return { type, el };
}

// ── build props ───────────────────────────────────────────────────────
const props = {};
for (const [group, values] of Object.entries(variantGroups)) {
  props[group] = {
    type: "string",
    enum: Object.keys(values),
    default: defaults[group] ?? Object.keys(values)[0],
  };
}
for (const [name, def] of Object.entries(booleanProps)) {
  props[name] = { type: "boolean", default: def };
}
if (hasChildren) props.children = { type: "slot", default: null };

// ── primary component: cva path (variant matrix) OR jsx path (single element)
let anatomy;
let defaultVariant;
const variants = [];

if (hasCva) {
  anatomy = { root: { type: "container" }, label: { type: "slot" } };

  const defaultClassStrings = [cvaBase];
  for (const [group, values] of Object.entries(variantGroups)) {
    const dv = defaults[group] ?? Object.keys(values)[0];
    if (values[dv] != null) defaultClassStrings.push(values[dv]);
  }
  const def = stylesFor(...defaultClassStrings);
  def.unmapped.forEach((u) => allUnmapped.add(u));

  defaultVariant = {
    configuration: Object.fromEntries(
      Object.keys(variantGroups).map((g) => [g, props[g].default]),
    ),
    layout: [{ root: ["label"] }],
    elements: {
      root: { children: ["label"], styles: def.root },
      label: {
        children: { $binding: "#/props/children" },
        ...(Object.keys(def.label).length ? { styles: def.label } : {}),
      },
    },
  };

  for (const [group, values] of Object.entries(variantGroups)) {
    const dv = props[group].default;
    for (const [value, classString] of Object.entries(values)) {
      if (value === dv) continue;
      const s = stylesFor(classString);
      s.unmapped.forEach((u) => allUnmapped.add(u));
      const elements = {};
      if (Object.keys(s.root).length) elements.root = { styles: s.root };
      if (Object.keys(s.label).length) elements.label = { styles: s.label };
      variants.push({
        configuration: { [group]: value },
        ...(Object.keys(elements).length ? { elements } : {}),
      });
    }
  }
} else {
  // No cva: primary is the JSX component matching the file name.
  const primary = jsxComps.find((c) => c.name === title) || jsxComps[0];
  if (!primary) {
    console.error(`No cva() and no JSX component found in ${file}.`);
    process.exit(1);
  }
  const { type, el } = jsxElement(primary);
  anatomy = { root: { type } };
  if (!props.children) props.children = { type: "slot", default: null };
  defaultVariant = { layout: ["root"], elements: { root: el } };
}

// ── subcomponents: every JSX leaf that isn't the primary root ───────────
const subcomponents = {};
for (const c of jsxComps) {
  if (c.name === title) continue; // that's the primary root itself
  const { type, el } = jsxElement(c);
  subcomponents[camel(c.name)] = {
    title: c.name,
    anatomy: { root: { type } },
    props: { children: { type: "slot", default: null } },
    default: { layout: ["root"], elements: { root: el } },
  };
}

// Slot composition: the primary's children accept its subcomponents.
const subTitles = Object.values(subcomponents).map((s) => s.title);
if (subTitles.length && props.children) props.children.anyOf = subTitles;

// ── assemble component ──────────────────────────────────────────────────
const component = {
  title,
  anatomy,
  props,
  default: defaultVariant,
};
if (variants.length) component.variants = variants;
if (subTitles.length) component.subcomponents = subcomponents;

fs.mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, `${(compArg || path.basename(file, ".tsx")).toLowerCase()}.json`);
fs.writeFileSync(outPath, JSON.stringify(component, null, 2) + "\n");

console.log(`✔ wrote ${path.relative(process.cwd(), outPath)}`);
console.log(`  title: ${title} (${hasCva ? "cva" : "jsx"} primary)`);
console.log(`  props: ${Object.keys(props).join(", ") || "—"}`);
if (Object.keys(variantGroups).length)
  console.log(`  variant groups: ${Object.keys(variantGroups).map((g) => `${g}(${Object.keys(variantGroups[g]).length})`).join(", ")}`);
if (variants.length) console.log(`  variant deltas: ${variants.length}`);
if (subTitles.length) console.log(`  subcomponents: ${subTitles.join(", ")}`);
if (allUnmapped.size)
  console.log(`  ⚠ unmapped classes (${allUnmapped.size}): ${[...allUnmapped].join(", ")}`);
