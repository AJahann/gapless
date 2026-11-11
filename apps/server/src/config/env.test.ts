import { describe, expect, it } from 'vitest';
import { booleanString, loadEnv } from './env';

describe('env configuration and boolean parser', () => {
  describe('booleanString parser', () => {
    const schemaDefaultFalse = booleanString(false);
    const schemaDefaultTrue = booleanString(true);

    it('handles missing / undefined / empty string with default', () => {
      expect(schemaDefaultFalse.parse(undefined)).toBe(false);
      expect(schemaDefaultFalse.parse('')).toBe(false);
      expect(schemaDefaultTrue.parse(undefined)).toBe(true);
      expect(schemaDefaultTrue.parse('')).toBe(true);
    });

    it('handles boolean values', () => {
      expect(schemaDefaultFalse.parse(true)).toBe(true);
      expect(schemaDefaultFalse.parse(false)).toBe(false);
      expect(schemaDefaultTrue.parse(true)).toBe(true);
      expect(schemaDefaultTrue.parse(false)).toBe(false);
    });

    it('handles "true" / "false" string variants (case-insensitive)', () => {
      expect(schemaDefaultFalse.parse('true')).toBe(true);
      expect(schemaDefaultFalse.parse('TRUE')).toBe(true);
      expect(schemaDefaultFalse.parse('True')).toBe(true);
      expect(schemaDefaultTrue.parse('false')).toBe(false);
      expect(schemaDefaultTrue.parse('FALSE')).toBe(false);
      expect(schemaDefaultTrue.parse('False')).toBe(false);
    });

    it('handles 1 / 0 string and number variants', () => {
      expect(schemaDefaultFalse.parse('1')).toBe(true);
      expect(schemaDefaultFalse.parse(1)).toBe(true);
      expect(schemaDefaultTrue.parse('0')).toBe(false);
      expect(schemaDefaultTrue.parse(0)).toBe(false);
    });

    it('rejects invalid strings and numbers', () => {
      expect(() => schemaDefaultFalse.parse('invalid')).toThrow(
        /expected boolean|invalid/i,
      );
      expect(() => schemaDefaultFalse.parse('2')).toThrow(
        /expected boolean|invalid/i,
      );
      expect(() => schemaDefaultFalse.parse(2)).toThrow(
        /expected boolean|invalid/i,
      );
      expect(() => schemaDefaultFalse.parse('maybe')).toThrow(
        /expected boolean|invalid/i,
      );
    });
  });

  describe('loadEnv() behavior', () => {
    it('defaults TEST_CONTROL to false and CHAOS_ENABLED to true when missing', () => {
      const env = loadEnv({});
      expect(env.TEST_CONTROL).toBe(false);
      expect(env.CHAOS_ENABLED).toBe(true);
      expect(env.PORT).toBe(4000);
      expect(env.HOST).toBe('0.0.0.0');
    });

    it('parses TEST_CONTROL=false correctly from string', () => {
      const env = loadEnv({ TEST_CONTROL: 'false' });
      expect(env.TEST_CONTROL).toBe(false);
    });

    it('parses TEST_CONTROL=0 correctly from string', () => {
      const env = loadEnv({ TEST_CONTROL: '0' });
      expect(env.TEST_CONTROL).toBe(false);
    });

    it('parses TEST_CONTROL=true and TEST_CONTROL=1 correctly', () => {
      expect(loadEnv({ TEST_CONTROL: 'true' }).TEST_CONTROL).toBe(true);
      expect(loadEnv({ TEST_CONTROL: '1' }).TEST_CONTROL).toBe(true);
    });

    it('parses CHAOS_ENABLED=false and CHAOS_ENABLED=0 correctly', () => {
      expect(loadEnv({ CHAOS_ENABLED: 'false' }).CHAOS_ENABLED).toBe(false);
      expect(loadEnv({ CHAOS_ENABLED: '0' }).CHAOS_ENABLED).toBe(false);
    });

    it('throws validation error on invalid boolean env vars', () => {
      expect(() => loadEnv({ TEST_CONTROL: 'foo' })).toThrow(
        /expected boolean|invalid/i,
      );
      expect(() => loadEnv({ CHAOS_ENABLED: 'bar' })).toThrow(
        /expected boolean|invalid/i,
      );
    });
  });
});
