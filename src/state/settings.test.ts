import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  detectLanguage,
  type KeyValueStorage,
  loadSettings,
  parseSettings,
  SETTINGS_STORAGE_KEY,
  type Settings,
} from './settings';

function memoryStorage(
  initial: Record<string, string> = {},
): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const throwingStorage: KeyValueStorage = {
  getItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('full', 'QuotaExceededError');
  },
};

const fallback: Settings = { ...DEFAULT_SETTINGS, language: 'es' };

describe('detectLanguage', () => {
  it('takes the first supported language from the browser list, ignoring the region', () => {
    expect(detectLanguage(['de-DE', 'pt-BR', 'en-US'])).toBe('pt');
    expect(detectLanguage(['es-AR'])).toBe('es');
  });

  it('falls back to English when no listed language is supported', () => {
    expect(detectLanguage(['de', 'fr'])).toBe('en');
    expect(detectLanguage([])).toBe('en');
  });
});

describe('parseSettings', () => {
  it('keeps every valid field', () => {
    const stored: Settings = {
      language: 'pt',
      palette: 'rose',
      luminosity: 'dusk',
      background: 'helix',
      soundOn: false,
      volume: 0.2,
      mode: 'advanced',
    };
    expect(parseSettings(stored, fallback)).toEqual(stored);
  });

  it('replaces only the invalid fields with the fallback', () => {
    const parsed = parseSettings(
      {
        language: 'klingon',
        palette: 'lime',
        luminosity: 42,
        soundOn: 'yes',
        volume: Number.NaN,
        mode: 'advanced',
      },
      fallback,
    );
    expect(parsed).toEqual({ ...fallback, palette: 'lime', mode: 'advanced' });
  });

  it('clamps the volume into 0..1', () => {
    expect(parseSettings({ volume: 3 }, fallback).volume).toBe(1);
    expect(parseSettings({ volume: -1 }, fallback).volume).toBe(0);
  });

  it('returns the fallback for non-object input', () => {
    expect(parseSettings(null, fallback)).toEqual(fallback);
    expect(parseSettings('dark', fallback)).toEqual(fallback);
  });
});

describe('settings persistence', () => {
  it('detects the language on first run and uses the documented defaults', () => {
    expect(loadSettings(memoryStorage(), ['pt-PT'])).toEqual({ ...DEFAULT_SETTINGS, language: 'pt' });
  });

  it('writes every change and reads it back in a new session', () => {
    const storage = memoryStorage();
    const first = createSettingsStore(storage, ['en']);
    first.update({ luminosity: 'light', palette: 'amber' });
    first.update({ language: 'es' });

    const second = createSettingsStore(storage, ['pt']);
    expect(second.settings.value).toMatchObject({ luminosity: 'light', palette: 'amber', language: 'es' });
  });

  it('falls back to defaults on corrupt JSON', () => {
    const storage = memoryStorage({ [SETTINGS_STORAGE_KEY]: '{not json' });
    expect(loadSettings(storage, ['es'])).toEqual({ ...DEFAULT_SETTINGS, language: 'es' });
  });

  it('keeps working in memory when storage throws or is missing', () => {
    const blocked = createSettingsStore(throwingStorage, ['en']);
    blocked.update({ mode: 'advanced' });
    expect(blocked.settings.value.mode).toBe('advanced');

    const none = createSettingsStore(null, ['es']);
    expect(none.settings.value.language).toBe('es');
  });
});
