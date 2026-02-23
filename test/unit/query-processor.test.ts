import { QueryProcessor } from '../../src/core/query-processor';

describe('QueryProcessor', () => {
    test('should normalize queries correctly', () => {
        expect(QueryProcessor.normalize('  TEST query!!!  ')).toBe('test query');
        expect(QueryProcessor.normalize('Multiple   Spaces')).toBe('multiple spaces');
    });

    test('should convert English layout to Russian', () => {
        expect(QueryProcessor.convertLayout('hfvflfy')).toBe('рамадан');
        expect(QueryProcessor.convertLayout('vjkbndf')).toBe('молитва');
    });

    test('should transliterate Cyrillic to Latin', () => {
        expect(QueryProcessor.transliterate('рамадан')).toBe('ramadan');
    });

    test('should validate queries', () => {
        expect(QueryProcessor.validate('').valid).toBe(false);
        expect(QueryProcessor.validate('a').valid).toBe(false);
        expect(QueryProcessor.validate('abc').valid).toBe(true);
    });
});
