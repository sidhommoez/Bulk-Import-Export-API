import {
  isValidEmail,
  isValidSlug,
  isValidUUID,
  countWords,
  isValidBodyLength,
  toKebabCase,
  isValidISODate,
  parseBoolean,
  sanitizeString,
  isValidTagsArray,
  normalizeTags,
} from './validation.utils';

describe('Validation Utils', () => {
  describe('isValidEmail', () => {
    it('should return true for valid emails', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('user.name@domain.org')).toBe(true);
      expect(isValidEmail('user+tag@sub.domain.com')).toBe(true);
      expect(isValidEmail('a@b.co')).toBe(true);
    });

    it('should return false for invalid emails', () => {
      expect(isValidEmail('')).toBe(false);
      expect(isValidEmail('invalid')).toBe(false);
      expect(isValidEmail('invalid@')).toBe(false);
      expect(isValidEmail('@domain.com')).toBe(false);
      expect(isValidEmail('user@')).toBe(false);
      expect(isValidEmail('user name@domain.com')).toBe(false);
      expect(isValidEmail('user@domain')).toBe(false);
    });
  });

  describe('isValidSlug', () => {
    it('should return true for valid kebab-case slugs', () => {
      expect(isValidSlug('hello-world')).toBe(true);
      expect(isValidSlug('my-article-title')).toBe(true);
      expect(isValidSlug('test123')).toBe(true);
      expect(isValidSlug('a-b-c-d')).toBe(true);
      expect(isValidSlug('single')).toBe(true);
      expect(isValidSlug('article-1')).toBe(true);
    });

    it('should return false for invalid slugs', () => {
      expect(isValidSlug('')).toBe(false);
      expect(isValidSlug('Hello-World')).toBe(false); // uppercase
      expect(isValidSlug('hello_world')).toBe(false); // underscore
      expect(isValidSlug('hello world')).toBe(false); // space
      expect(isValidSlug('-hello')).toBe(false); // leading hyphen
      expect(isValidSlug('hello-')).toBe(false); // trailing hyphen
      expect(isValidSlug('hello--world')).toBe(false); // double hyphen
      expect(isValidSlug('hello/world')).toBe(false); // special char
    });
  });

  describe('isValidUUID', () => {
    it('should return true for valid UUIDs', () => {
      expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isValidUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
      expect(isValidUUID('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
    });

    it('should return false for invalid UUIDs', () => {
      expect(isValidUUID('')).toBe(false);
      expect(isValidUUID('invalid-uuid')).toBe(false);
      expect(isValidUUID('550e8400-e29b-41d4-a716')).toBe(false); // too short
      expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000-extra')).toBe(false); // too long
      expect(isValidUUID('550e8400e29b41d4a716446655440000')).toBe(false); // no hyphens
      expect(isValidUUID('gggggggg-gggg-gggg-gggg-gggggggggggg')).toBe(false); // invalid chars
    });
  });

  describe('countWords', () => {
    it('should count words correctly', () => {
      expect(countWords('hello world')).toBe(2);
      expect(countWords('one two three four five')).toBe(5);
      expect(countWords('single')).toBe(1);
      expect(countWords('multiple   spaces   between')).toBe(3);
      expect(countWords('  leading and trailing spaces  ')).toBe(4);
    });

    it('should return 0 for empty or invalid input', () => {
      expect(countWords('')).toBe(0);
      expect(countWords('   ')).toBe(0);
      expect(countWords(null as unknown as string)).toBe(0);
      expect(countWords(undefined as unknown as string)).toBe(0);
      expect(countWords(123 as unknown as string)).toBe(0);
    });
  });

  describe('isValidBodyLength', () => {
    it('should return true when word count is within limit', () => {
      expect(isValidBodyLength('hello world', 500)).toBe(true);
      expect(isValidBodyLength('a'.repeat(100), 500)).toBe(true);
      expect(isValidBodyLength(Array(500).fill('word').join(' '), 500)).toBe(true);
    });

    it('should return false when word count exceeds limit', () => {
      expect(isValidBodyLength(Array(501).fill('word').join(' '), 500)).toBe(false);
      expect(isValidBodyLength(Array(1000).fill('word').join(' '), 500)).toBe(false);
    });

    it('should use custom limit', () => {
      expect(isValidBodyLength('one two three', 2)).toBe(false);
      expect(isValidBodyLength('one two', 2)).toBe(true);
    });
  });

  describe('toKebabCase', () => {
    it('should convert strings to kebab-case', () => {
      expect(toKebabCase('Hello World')).toBe('hello-world');
      expect(toKebabCase('camelCaseString')).toBe('camelcasestring');
      expect(toKebabCase('  spaces  around  ')).toBe('spaces-around');
      expect(toKebabCase('UPPER CASE')).toBe('upper-case');
      expect(toKebabCase('with_underscores')).toBe('with-underscores');
    });

    it('should handle special characters', () => {
      expect(toKebabCase('Hello! World?')).toBe('hello-world');
      expect(toKebabCase('test@example#com')).toBe('testexamplecom');
    });

    it('should handle multiple spaces and hyphens', () => {
      expect(toKebabCase('multiple   spaces')).toBe('multiple-spaces');
      expect(toKebabCase('multiple---hyphens')).toBe('multiple-hyphens');
    });
  });

  describe('isValidISODate', () => {
    it('should return true for valid ISO dates', () => {
      expect(isValidISODate('2024-01-15T10:30:00Z')).toBe(true);
      expect(isValidISODate('2024-01-15T10:30:00.000Z')).toBe(true);
      expect(isValidISODate('2024-01-15')).toBe(true);
      expect(isValidISODate('2024-01-15T10:30:00+05:30')).toBe(true);
    });

    it('should return false for invalid dates', () => {
      expect(isValidISODate('')).toBe(false);
      expect(isValidISODate('not-a-date')).toBe(false);
      expect(isValidISODate('2024-13-45')).toBe(false); // invalid month/day
      expect(isValidISODate(null as unknown as string)).toBe(false);
      expect(isValidISODate(undefined as unknown as string)).toBe(false);
    });
  });

  describe('parseBoolean', () => {
    it('should return true for truthy values', () => {
      expect(parseBoolean(true)).toBe(true);
      expect(parseBoolean('true')).toBe(true);
      expect(parseBoolean('TRUE')).toBe(true);
      expect(parseBoolean('True')).toBe(true);
      expect(parseBoolean('1')).toBe(true);
      expect(parseBoolean('yes')).toBe(true);
      expect(parseBoolean('YES')).toBe(true);
      expect(parseBoolean(1)).toBe(true);
    });

    it('should return false for falsy values', () => {
      expect(parseBoolean(false)).toBe(false);
      expect(parseBoolean('false')).toBe(false);
      expect(parseBoolean('FALSE')).toBe(false);
      expect(parseBoolean('False')).toBe(false);
      expect(parseBoolean('0')).toBe(false);
      expect(parseBoolean('no')).toBe(false);
      expect(parseBoolean('NO')).toBe(false);
      expect(parseBoolean(0)).toBe(false);
    });

    it('should return null for invalid values', () => {
      expect(parseBoolean(null)).toBe(null);
      expect(parseBoolean(undefined)).toBe(null);
      expect(parseBoolean('invalid')).toBe(null);
      expect(parseBoolean(2)).toBe(null);
      expect(parseBoolean({})).toBe(null);
    });
  });

  describe('sanitizeString', () => {
    it('should trim and clean strings', () => {
      expect(sanitizeString('  hello  ')).toBe('hello');
      expect(sanitizeString('normal')).toBe('normal');
    });

    it('should remove null bytes', () => {
      expect(sanitizeString('hello\0world')).toBe('helloworld');
      expect(sanitizeString('\0test\0')).toBe('test');
    });

    it('should handle non-string values', () => {
      expect(sanitizeString(null)).toBe(null);
      expect(sanitizeString(undefined)).toBe(null);
      expect(sanitizeString(123)).toBe('123');
      expect(sanitizeString(true)).toBe('true');
    });
  });

  describe('isValidTagsArray', () => {
    it('should return true for valid tag arrays', () => {
      expect(isValidTagsArray(['tag1', 'tag2'])).toBe(true);
      expect(isValidTagsArray(['single'])).toBe(true);
      expect(isValidTagsArray([])).toBe(true);
    });

    it('should return false for invalid tag arrays', () => {
      expect(isValidTagsArray(null)).toBe(false);
      expect(isValidTagsArray(undefined)).toBe(false);
      expect(isValidTagsArray('not-array')).toBe(false);
      expect(isValidTagsArray([1, 2, 3])).toBe(false);
      expect(isValidTagsArray(['valid', ''])).toBe(false); // empty string
      expect(isValidTagsArray(['valid', '   '])).toBe(false); // whitespace only
      expect(isValidTagsArray(['valid', null])).toBe(false);
    });
  });

  describe('normalizeTags', () => {
    it('should normalize tags correctly', () => {
      expect(normalizeTags(['Tag1', 'TAG2', 'tag3'])).toEqual(['tag1', 'tag2', 'tag3']);
      expect(normalizeTags(['  spaced  ', 'normal'])).toEqual(['spaced', 'normal']);
    });

    it('should remove duplicates', () => {
      expect(normalizeTags(['tag', 'Tag', 'TAG'])).toEqual(['tag']);
      expect(normalizeTags(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c']);
    });

    it('should filter empty tags', () => {
      expect(normalizeTags(['valid', '', '  '])).toEqual(['valid']);
      expect(normalizeTags(['', '', ''])).toEqual([]);
    });
  });
});
