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
node bin/validate.mjs                            # ajv-validate against installed schema
```

`DS_ROOT` env overrides the design-system path (default
`~/work/mariusz-ciesla/main`). `SPECS_SCHEMA_DIR` overrides the schema location.

## How it maps

| Spec field | Source in code |
|---|---|
| `title` | component name |
| `props.<group>` (EnumProp) | each `cva` `variants` group + `defaultVariants` |
| `props.<bool>` (BooleanProp) | boolean fields on the `*Props` interface (e.g. `asChild`) |
| `props.children` (SlotProp) | shadcn primitives forward children |
| `default` variant | base classes + each group's default value, fully resolved |
| `variants[]` | non-default values, emitted as **deltas** (the schema's cascade model) |
| `*.styles` TokenReference | Tailwind `bg-/text-/border-/shadow-/rounded-` → the CSS var it resolves to in `tailwind.config.ts` |

- `bin/cva-to-spec.mjs` — AST extraction (`@babel/parser`, not regex) + assembly.
- `lib/tw-map.mjs` — table-driven Tailwind utility → Specs `Styles` mapper.
- `config.mjs` — paths + the Tailwind-name → CSS-var(token) tables.

Unmapped classes are **reported, never silently dropped** (see each run's
`⚠ unmapped` line).

## Known scope / roadmap

- **Pseudo/state classes** (`hover:`, `focus-visible:`, `disabled:`, `[&_svg]:`)
  are skipped — the static `Styles` model has no slot for them. Capturing these
  needs a state convention (Specs models state via prop-driven variants).
- **Named text styles** (`text-badge`, `text-heading`, … from the Tailwind
  safelist) → should become `typography` TokenReferences; currently reported as
  unmapped.
- **Alpha modifiers** (`/20`, `/90`) on colours are dropped — token ref kept.
- **Anatomy** is `root` + `label` slot. Multi-element components (icon slots,
  nested instances) need JSX-tree parsing — the largest remaining gap vs. what
  Figma gives for free.
- **Tokens themselves** (color/spacing/radius foundations) aren't components;
  emit them as a separate DTCG token file referenced by these `$token` paths.
