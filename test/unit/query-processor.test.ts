import { QueryProcessor } from '../../src/core/query-processor';

describe('QueryProcessor', () => {
    describe('normalize', () => {
        it('lowercases and trims input', () => {
            expect(QueryProcessor.normalize('  TEST query!  ')).toBe('test query');
        });

        it('collapses multiple spaces', () => {
            expect(QueryProcessor.normalize('Multiple   Spaces')).toBe('multiple spaces');
        });

        it('removes trailing punctuation', () => {
            expect(QueryProcessor.normalize('hello!')).toBe('hello');
            expect(QueryProcessor.normalize('hello...')).toBe('hello');
            expect(QueryProcessor.normalize('hello???')).toBe('hello');
        });

        it('preserves internal punctuation', () => {
            // Commas/colons inside the string are fine, only trailing is stripped
            expect(QueryProcessor.normalize('hello world')).toBe('hello world');
        });

        it('handles empty string', () => {
            expect(QueryProcessor.normalize('')).toBe('');
        });
    });

    describe('convertLayout (EN→RU)', () => {
        it('converts English keyboard layout to Russian', () => {
            expect(QueryProcessor.convertLayout('hfvflfy')).toBe('рамадан');
            expect(QueryProcessor.convertLayout('vjkbndf')).toBe('молитва');
        });

        it('preserves characters that have no mapping', () => {
            const result = QueryProcessor.convertLayout('123');
            expect(result).toBe('123');
        });
    });

    describe('transliterate', () => {
        it('transliterates common Cyrillic to Latin', () => {
            expect(QueryProcessor.transliterate('рамадан')).toBe('ramadan');
        });

        it('handles hard and soft signs (ъ and ь) according to ISO 9', () => {
            expect(QueryProcessor.transliterate('объект')).toBe('obʺekt');
        });

        it('handles ё and ж', () => {
            expect(QueryProcessor.transliterate('ёж')).toBe('ëž');
        });
    });

    describe('validate', () => {
        it('rejects empty string', () => {
            expect(QueryProcessor.validate('').valid).toBe(false);
        });

        it('rejects single character', () => {
            expect(QueryProcessor.validate('a').valid).toBe(false);
        });

        it('rejects strings with no alphanumeric characters', () => {
            expect(QueryProcessor.validate('!! ??').valid).toBe(false);
        });

        it('accepts Cyrillic characters', () => {
            expect(QueryProcessor.validate('рам').valid).toBe(true);
        });

        it('accepts Arabic characters', () => {
            expect(QueryProcessor.validate('مرحبا').valid).toBe(true);
        });

        it('accepts standard Latin query', () => {
            expect(QueryProcessor.validate('abc').valid).toBe(true);
        });

        it('accepts query with digits', () => {
            expect(QueryProcessor.validate('42').valid).toBe(true);
        });
    });
});
