import { afterEach, describe, expect, it } from 'vitest';
import { RULES_STORAGE_KEY, loadRules, saveRules } from '../lib/rulesStorage.js';

afterEach(() => {
  window.localStorage.clear();
});

describe('rules storage', () => {
  it('returns empty text when nothing is stored', () => {
    expect(loadRules()).toBe('');
  });

  it('round-trips saved rules text', () => {
    expect(saveRules('1. Risk 1% max.')).toBe(true);
    expect(loadRules()).toBe('1. Risk 1% max.');
  });

  it('stores plain text safely (no JSON interpretation of user input)', () => {
    saveRules('{"looksLike":"json"} with "quotes" and \n newlines');
    expect(loadRules()).toBe('{"looksLike":"json"} with "quotes" and \n newlines');
  });

  it('rejects non-string stored values instead of crashing', () => {
    window.localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify({ not: 'text' }));
    expect(loadRules()).toBe('');
    window.localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(42));
    expect(loadRules()).toBe('');
  });

  it('handles corrupt storage gracefully', () => {
    window.localStorage.setItem(RULES_STORAGE_KEY, '{broken json');
    expect(loadRules()).toBe('');
  });

  it('persists an empty-string save (explicit clear)', () => {
    saveRules('rules');
    saveRules('');
    expect(loadRules()).toBe('');
  });
});
