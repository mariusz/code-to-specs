// Paths for the code→Specs generator.
import { homedir } from "node:os";
import path from "node:path";

const HOME = homedir();

export const DS_ROOT =
  process.env.DS_ROOT || path.join(HOME, "work/mariusz-ciesla/main");

export const SCHEMA_DIR =
  process.env.SPECS_SCHEMA_DIR ||
  "/opt/homebrew/lib/node_modules/@directededges/specs-cli/node_modules/@directededges/specs-schema/schema";

export const COMPONENTS_DIR = path.join(DS_ROOT, "src/components");
export const UI_DIR = path.join(COMPONENTS_DIR, "ui");
export const OUT_DIR = path.join(process.cwd(), "specs/components");

// Tailwind utility colour name -> CSS custom property (token) name.
// Derived from tailwind.config.ts `theme.extend.colors`.
export const COLOR_TOKENS = {
  border: "border",
  input: "input",
  ring: "ring",
  background: "background",
  foreground: "foreground",
  primary: "primary",
  "primary-foreground": "primary-foreground",
  "primary-glow": "primary-glow",
  secondary: "secondary",
  "secondary-foreground": "secondary-foreground",
  destructive: "destructive",
  "destructive-foreground": "destructive-foreground",
  muted: "muted",
  "muted-foreground": "muted-foreground",
  accent: "accent",
  "accent-foreground": "accent-foreground",
  popover: "popover",
  "popover-foreground": "popover-foreground",
  card: "card",
  "card-foreground": "card-foreground",
  "glass-5": "glass-5",
  "glass-10": "glass-10",
  "glass-20": "glass-20",
};

// Tailwind boxShadow name -> CSS var token.
export const SHADOW_TOKENS = {
  elegant: "shadow-elegant",
  glow: "shadow-glow",
  card: "shadow-card",
  glass: "glass-shadow",
};

// rounded-{sm,md,lg,default} all map to var(--radius) in this project.
export const RADIUS_TOKEN = "radius";
