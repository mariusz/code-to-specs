// Tailwind utility class -> Specs Styles fragment.
//
// Deterministic, table-driven. Returns a partial Styles object keyed by the
// element it targets ("root" for container/layout/background, "label" for text).
// Anything it can't map is reported in `unmapped` so coverage gaps are visible
// rather than silently dropped.
import { COLOR_TOKENS, SHADOW_TOKENS, RADIUS_TOKEN } from "../config.mjs";

const SPACE = 4; // tailwind spacing unit = 4px
const num = "(\\d+(?:\\.\\d+)?)"; // integer or decimal spacing step

const colorRef = (tok) => ({ $token: tok, $type: "color" });
const dimRef = (tok) => ({ $token: tok, $type: "dimension" });
const effectsRef = (tok) => ({ $token: tok, $type: "effects" });

// strip a pseudo/variant prefix chain and an opacity modifier:
//   "hover:bg-card/90" -> { base: "hover:bg-card", core: "bg-card", state: true }
function classify(cls) {
  const state = /(^|:)(hover|focus|focus-visible|active|disabled|group-hover|aria-|data-|\[&)/.test(
    cls,
  );
  const lastColon = cls.lastIndexOf(":");
  const core = lastColon === -1 ? cls : cls.slice(lastColon + 1);
  const [name] = core.split("/"); // drop /opacity modifier
  return { core, name, state };
}

const colorName = (rest) => (rest in COLOR_TOKENS ? COLOR_TOKENS[rest] : null);

// returns { root:{...}, label:{...}, padding:{...sides}, unmapped:[...] }
export function twToStyles(classString) {
  const root = {};
  const label = {};
  const padding = {}; // top/end/bottom/start in px
  const unmapped = [];
  const skippedState = [];

  for (const raw of String(classString).split(/\s+/).filter(Boolean)) {
    const { name, state } = classify(raw);
    if (state) {
      skippedState.push(raw);
      continue; // pseudo/descendant states have no static Styles slot
    }
    let m;

    // ── layout / flex ──────────────────────────────────────────────
    if (name === "flex" || name === "inline-flex") root.layoutMode = "HORIZONTAL";
    else if (name === "flex-col" || name === "inline-flex-col") root.layoutMode = "VERTICAL";
    else if (name === "items-center") root.crossAxisAlignment = "CENTER";
    else if (name === "items-start") root.crossAxisAlignment = "START";
    else if (name === "items-end") root.crossAxisAlignment = "END";
    else if (name === "items-stretch") root.crossAxisAlignment = "STRETCH";
    else if (name === "items-baseline") root.crossAxisAlignment = "BASELINE";
    else if (name === "justify-center") root.mainAxisAlignment = "CENTER";
    else if (name === "justify-start") root.mainAxisAlignment = "START";
    else if (name === "justify-end") root.mainAxisAlignment = "END";
    else if (name === "justify-between") root.mainAxisAlignment = "SPACE_BETWEEN";
    else if ((m = name.match(new RegExp(`^gap-${num}$`)))) root.itemSpacing = +m[1] * SPACE;

    // ── radius ─────────────────────────────────────────────────────
    else if (name === "rounded-full") root.cornerRadius = 9999;
    else if (name === "rounded-none") root.cornerRadius = 0;
    else if ((m = name.match(/^rounded-\[(\d+)px\]$/))) root.cornerRadius = +m[1];
    else if (/^rounded(-(sm|md|lg|default|xl|2xl))?$/.test(name))
      root.cornerRadius = dimRef(RADIUS_TOKEN);

    // ── typography ─────────────────────────────────────────────────
    else if (name === "text-xs") setType(label, "fontSize", 12);
    else if (name === "text-sm") setType(label, "fontSize", 14);
    else if (name === "text-base") setType(label, "fontSize", 16);
    else if (name === "text-lg") setType(label, "fontSize", 18);
    else if (name === "text-xl") setType(label, "fontSize", 20);
    else if (name === "font-normal") setType(label, "fontStyle", "Regular");
    else if (name === "font-medium") setType(label, "fontStyle", "Medium");
    else if (name === "font-semibold") setType(label, "fontStyle", "Semibold");
    else if (name === "font-bold") setType(label, "fontStyle", "Bold");

    // ── sizing ─────────────────────────────────────────────────────
    else if (name === "w-full") root.layoutSizingHorizontal = "FILL";
    else if (name === "h-full") root.layoutSizingVertical = "FILL";
    else if ((m = name.match(new RegExp(`^h-${num}$`)))) root.height = +m[1] * SPACE;
    else if ((m = name.match(new RegExp(`^w-${num}$`)))) root.width = +m[1] * SPACE;
    else if ((m = name.match(new RegExp(`^size-${num}$`)))) {
      root.width = +m[1] * SPACE;
      root.height = +m[1] * SPACE;
    } else if ((m = name.match(new RegExp(`^min-h-${num}$`)))) root.minHeight = +m[1] * SPACE;
    else if ((m = name.match(new RegExp(`^min-w-${num}$`)))) root.minWidth = +m[1] * SPACE;

    // ── padding ────────────────────────────────────────────────────
    else if ((m = name.match(new RegExp(`^p-${num}$`))))
      padding.top = padding.end = padding.bottom = padding.start = +m[1] * SPACE;
    else if ((m = name.match(new RegExp(`^px-${num}$`)))) (padding.start = padding.end = +m[1] * SPACE);
    else if ((m = name.match(new RegExp(`^py-${num}$`)))) (padding.top = padding.bottom = +m[1] * SPACE);
    else if ((m = name.match(new RegExp(`^pt-${num}$`)))) padding.top = +m[1] * SPACE;
    else if ((m = name.match(new RegExp(`^pr-${num}$`)))) padding.end = +m[1] * SPACE;
    else if ((m = name.match(new RegExp(`^pb-${num}$`)))) padding.bottom = +m[1] * SPACE;
    else if ((m = name.match(new RegExp(`^pl-${num}$`)))) padding.start = +m[1] * SPACE;

    // ── opacity ────────────────────────────────────────────────────
    else if ((m = name.match(/^opacity-(\d+)$/))) root.opacity = +m[1] / 100;

    // ── colour: background ─────────────────────────────────────────
    else if (name === "bg-transparent") root.backgroundColor = null;
    else if (name.startsWith("bg-") && colorName(name.slice(3)))
      root.backgroundColor = colorRef(colorName(name.slice(3)));

    // ── colour: text ───────────────────────────────────────────────
    else if (name.startsWith("text-") && colorName(name.slice(5)))
      label.textColor = colorRef(colorName(name.slice(5)));

    // ── border / stroke ────────────────────────────────────────────
    else if (name === "border-transparent") root.strokes = null;
    else if (name === "border") root.strokeWeight = 1;
    else if ((m = name.match(/^border-(\d+)$/))) root.strokeWeight = +m[1];
    else if (name.startsWith("border-") && colorName(name.slice(7)))
      root.strokes = colorRef(colorName(name.slice(7)));

    // ── effects / shadow ───────────────────────────────────────────
    else if (name.startsWith("shadow-") && SHADOW_TOKENS[name.slice(7)])
      root.effects = effectsRef(SHADOW_TOKENS[name.slice(7)]);

    // ── intentionally ignored (no Styles slot) ─────────────────────
    else if (
      /^(whitespace-|ring-|outline-|backdrop-|transition|duration-|ease-|animate-|pointer-events-|shrink|grow|overflow-|cursor-|select-|appearance-)/.test(
        name,
      )
    ) {
      // structural/non-visual or transition utilities — not part of the Styles model
    } else unmapped.push(raw);
  }

  // collapse padding to scalar when uniform
  let paddingOut;
  const keys = Object.keys(padding);
  if (keys.length) {
    const vals = ["top", "end", "bottom", "start"].map((k) => padding[k] ?? 0);
    paddingOut = vals.every((v) => v === vals[0]) && keys.length === 4 ? vals[0] : padding;
  }
  if (paddingOut !== undefined) root.padding = paddingOut;

  return { root, label, unmapped, skippedState };
}

function setType(el, key, val) {
  el.typography = el.typography || {};
  el.typography[key] = val;
}
