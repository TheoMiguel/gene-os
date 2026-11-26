import { LANGUAGES } from '../../state/settings';
import { DICTIONARIES, format } from './index';

const placeholders = (message: string) => [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('dictionaries', () => {
  const englishKeys = Object.keys(DICTIONARIES.en).sort();

  it.each(LANGUAGES)('%s has exactly the English keys', (lang) => {
    expect(Object.keys(DICTIONARIES[lang]).sort()).toEqual(englishKeys);
  });

  it.each(LANGUAGES)('%s has no empty message and keeps every placeholder', (lang) => {
    for (const key of englishKeys) {
      const message = DICTIONARIES[lang][key as keyof typeof DICTIONARIES.en];
      expect(message.trim(), key).not.toBe('');
      expect(placeholders(message), key).toEqual(
        placeholders(DICTIONARIES.en[key as keyof typeof DICTIONARIES.en]),
      );
    }
  });
});

describe('format', () => {
  it('fills named placeholders and leaves unknown ones visible', () => {
    expect(format('Close {name}', { name: 'pUC19' })).toBe('Close pUC19');
    expect(format('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });
});
