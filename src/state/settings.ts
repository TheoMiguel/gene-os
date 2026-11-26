import { computed, effect, signal } from '@preact/signals';

export const LANGUAGES = ['es', 'en', 'pt'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Accent palettes. `teal` is the V1.2.0 default accent. */
export const PALETTES = ['teal', 'cyan', 'violet', 'amber', 'rose', 'lime', 'ice'] as const;
export type Palette = (typeof PALETTES)[number];

export const LUMINOSITIES = ['dark', 'dusk', 'light'] as const;
export type Luminosity = (typeof LUMINOSITIES)[number];

export const BACKGROUNDS = ['particles', 'helix', 'hexgrid', 'telemetry', 'rain', 'off'] as const;
export type BackgroundId = (typeof BACKGROUNDS)[number];

export const UI_MODES = ['default', 'advanced'] as const;
export type UiMode = (typeof UI_MODES)[number];

export interface Settings {
  readonly language: Language;
  readonly palette: Palette;
  readonly luminosity: Luminosity;
  readonly background: BackgroundId;
  readonly soundOn: boolean;
  /** Master volume, 0..1. */
  readonly volume: number;
  readonly mode: UiMode;
}

export const SETTINGS_STORAGE_KEY = 'gene-os.settings.v1';

/** Defaults for every field except the language, which comes from the browser on first run. */
export const DEFAULT_SETTINGS: Omit<Settings, 'language'> = {
  palette: 'teal',
  luminosity: 'dark',
  background: 'particles',
  soundOn: true,
  volume: 0.5,
  mode: 'default',
};

/** First supported language in the browser's preference list (`navigator.languages`), else English. */
export function detectLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    const match = LANGUAGES.find((lang) => lang === base);
    if (match) return match;
  }
  return 'en';
}

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}

/**
 * Parses stored settings. Each field that is missing or invalid takes its value from `fallback`,
 * so one bad field never discards the others.
 */
export function parseSettings(raw: unknown, fallback: Settings): Settings {
  const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const volume = obj.volume;
  return {
    language: oneOf(LANGUAGES, obj.language, fallback.language),
    palette: oneOf(PALETTES, obj.palette, fallback.palette),
    luminosity: oneOf(LUMINOSITIES, obj.luminosity, fallback.luminosity),
    background: oneOf(BACKGROUNDS, obj.background, fallback.background),
    soundOn: typeof obj.soundOn === 'boolean' ? obj.soundOn : fallback.soundOn,
    volume:
      typeof volume === 'number' && Number.isFinite(volume)
        ? Math.min(1, Math.max(0, volume))
        : fallback.volume,
    mode: oneOf(UI_MODES, obj.mode, fallback.mode),
  };
}

/** The subset of `Storage` the settings store uses. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Reads settings from storage; corrupt JSON, a blocked storage or a missing entry yield the defaults. */
export function loadSettings(
  storage: KeyValueStorage | null,
  preferredLanguages: readonly string[],
): Settings {
  const fallback: Settings = { ...DEFAULT_SETTINGS, language: detectLanguage(preferredLanguages) };
  try {
    const text = storage?.getItem(SETTINGS_STORAGE_KEY);
    return text ? parseSettings(JSON.parse(text), fallback) : fallback;
  } catch {
    return fallback;
  }
}

/** Writes settings; a full or blocked storage is ignored, the in-memory settings stay current. */
export function saveSettings(storage: KeyValueStorage | null, value: Settings): void {
  try {
    storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Private mode or quota: settings still apply for this session.
  }
}

/** `window.localStorage`, or null where the browser blocks access to it. */
export function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** A settings signal that persists every change to `storage`. */
export function createSettingsStore(storage: KeyValueStorage | null, preferredLanguages: readonly string[]) {
  const current = signal<Settings>(loadSettings(storage, preferredLanguages));
  return {
    settings: current,
    update(patch: Partial<Settings>): void {
      current.value = { ...current.value, ...patch };
      saveSettings(storage, current.value);
    },
  };
}

const store = createSettingsStore(
  browserStorage(),
  typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]),
);

/** The app's settings. Read `.value` inside a component to re-render on change. */
export const settings = store.settings;
/** Merges `patch` into the app's settings and persists them. */
export const updateSettings = store.update;

/** True when the user picked the advanced interface mode (spec 1.4). */
export const advancedMode = computed(() => settings.value.mode === 'advanced');

/** Reads the interface mode inside a component; later tabs show extra parameters when it is true. */
export function useAdvanced(): boolean {
  return advancedMode.value;
}

/** Mirrors the theme settings onto `<html>` attributes that the design tokens key on. */
export function bindThemeToDocument(root: HTMLElement): () => void {
  return effect(() => {
    const { palette, luminosity, language } = settings.value;
    root.dataset.palette = palette;
    root.dataset.luminosity = luminosity;
    root.lang = language;
  });
}
