# specs-codegen — code → Specs (Option B)

Reverse-engineers a CVA/shadcn components +
Tailwind CSS-var tokens into **schema-valid** [Specs](https://directededges.github.io/specs/)
`component.schema.json` files — **without Figma**.

Specs-cli only ingests Figma (`fetch`/`scan`/`generate` all read Figma REST
payloads). This goes the other direction: it reads `.tsx` source and emits the
same open schema (`@directededges/specs-schema`). The Figma-only `metadata.source`
block is omitted — the schema only requires `title`, `anatomy`, `default`.

## Usage

```bash
npm install
node bin/cva-to-spec.mjs --component button     # -> specs/components/button.json
node bin/cva-to-spec.mjs --file /abs/foo.tsx
node bin/extract-tokens.mjs                      # -> specs/foundations/tokens.json (DTCG)
node bin/validate.mjs                            # ajv-validate specs against installed schema
node bin/check-refs.mjs                          # every $token in specs resolves to a foundation token
```

`DS_ROOT` env overrides the design-system path, `SPECS_SCHEMA_DIR` overrides the schema location.

## How it maps

| Spec field | Source in code |
|---|---|
| `title` | component name |
| `props.<group>` (EnumProp) | each `cva` `variants` group + `defaultVariants` |
| `props.<bool>` (BooleanProp) | boolean fields on the `*Props` interface (e.g. `asChild`) |
| `props.children` (SlotProp) | shadcn primitives forward children |
| `default` variant | base classes + each group's default value, fully resolved |
| `variants[]` | non-default values, emitted as **deltas** (the schema's cascade model) |
| `anatomy.root.type` | JSX tag → element type (`div`→`container`, `h3`/`p`→`text`, `svg`→`vector`, …) |
| `subcomponents` | sibling `forwardRef`/fn components in the file (shadcn compound family) — each its own mini-spec |
| `props.children.anyOf` | the subcomponent names the primary's slot accepts (composition) |
| element `children` / `content` | container children → `SlotBinding`; text content → `content` `$binding` |
| `*.styles` TokenReference | Tailwind `bg-/text-/border-/shadow-/rounded-` → the CSS var it resolves to in `tailwind.config.ts` |

Two primary modes, auto-detected per file:
- **cva primary** — `cva()` present (Button, Badge, Alert): variant matrix → props + variant deltas.
- **jsx primary** — no `cva()` (Card): the file-named component becomes the root, built from its JSX element.

Either way, every *other* single-JSX-element export in the file becomes a
`subcomponent`. So Alert (cva) still picks up `AlertTitle`/`AlertDescription`,
and Card (jsx) picks up `CardHeader`/`CardTitle`/`CardContent`/….

- `bin/cva-to-spec.mjs` — AST extraction (`@babel/parser`, not regex) + assembly.
- `bin/extract-tokens.mjs` — parses `tokens.css` → DTCG `specs/foundations/tokens.json`.
- `bin/check-refs.mjs` — verifies every `$token` in the specs resolves to a foundation token.
- `lib/jsx-extract.mjs` — pulls single-JSX-element components (tag, classes, children, displayName) from the module AST.
- `lib/tw-map.mjs` — table-driven Tailwind utility → Specs `Styles` mapper.
- `config.mjs` — paths + the Tailwind-name → CSS-var(token) tables.

Unmapped classes are **reported, never silently dropped** (see each run's
`⚠ unmapped` line).

## Foundations (token resolution)

The component specs reference tokens by name — `{ "$token": "card", "$type": "color" }`.
`extract-tokens.mjs` reads the source of truth (`src/styles/tokens.css`) and emits
a **DTCG** `specs/foundations/tokens.json` keyed by those exact names, so each
reference resolves by direct lookup:

```json
"card":        { "$type": "color",     "$value": "hsl(280 30% 14%)" },
"radius":      { "$type": "dimension", "$value": "{spacing-scale-0}" },
"shadow-card": { "$type": "shadow",    "$value": "0 … hsl(0 0% 0% / 0.04), …" }
```

- HSL channel triplets (`280 30% 14%`) are wrapped to `hsl(...)`; `var(--x)`
  values become DTCG aliases `{x}`; types are detected value-first (a
  `gradient-*`-named token holding a colour triplet is typed `color`).
- `check-refs.mjs` closes the loop — currently **14 referenced tokens, all
  resolve** against 186 defined.

## Known scope / roadmap

- **Pseudo/state classes** (`hover:`, `focus-visible:`, `disabled:`, `[&_svg]:`)
  are skipped — the static `Styles` model has no slot for them. Capturing these
  needs a state convention (Specs models state via prop-driven variants).
- **Named text styles** (`text-badge`, `text-heading`, … from the Tailwind
  safelist) → should become `typography` TokenReferences; currently reported as
  unmapped.
- **Alpha modifiers** (`/20`, `/90`) on colours are dropped — token ref kept.
- **Nested JSX trees** — anatomy currently models each component as a single
  root element (+ subcomponents for sibling exports). Components that nest
  multiple *literal* JSX children inline (not via `{children}`) would need
  recursive child-element walking; the extractor stops at the outer element.
- **Token `$value` shapes** are pragmatic: shadows/gradients are kept as raw CSS
  strings rather than DTCG structured composite objects, and colours are `hsl()`
  strings rather than DTCG colour objects. Resolution works; full DTCG
  structural conformance would be a further pass.
