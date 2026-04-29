import { SqlSanitizer, SqlInjectionError } from '../../src/core/sql-sanitizer';

describe('SqlSanitizer', () => {
    describe('validateIdentifier', () => {
        it('accepts valid simple identifiers', () => {
            expect(() => SqlSanitizer.validateIdentifier('users')).not.toThrow();
            expect(() => SqlSanitizer.validateIdentifier('search_columns')).not.toThrow();
            expect(() => SqlSanitizer.validateIdentifier('_private')).not.toThrow();
            expect(() => SqlSanitizer.validateIdentifier('col123')).not.toThrow();
        });

        it('accepts schema-qualified identifiers', () => {
            expect(() => SqlSanitizer.validateIdentifier('public.users')).not.toThrow();
            expect(() => SqlSanitizer.validateIdentifier('mySchema.myTable')).not.toThrow();
        });

        it('throws SqlInjectionError for empty string', () => {
            expect(() => SqlSanitizer.validateIdentifier('')).toThrow(SqlInjectionError);
        });

        it('throws SqlInjectionError for SQL injection attempts', () => {
            expect(() => SqlSanitizer.validateIdentifier("users; DROP TABLE users--")).toThrow(SqlInjectionError);
            expect(() => SqlSanitizer.validateIdentifier("' OR 1=1--")).toThrow(SqlInjectionError);
            expect(() => SqlSanitizer.validateIdentifier("col UNION SELECT")).toThrow(SqlInjectionError);
        });

        it('throws SqlInjectionError for identifiers starting with a digit', () => {
            expect(() => SqlSanitizer.validateIdentifier('1invalid')).toThrow(SqlInjectionError);
        });

        it('throws SqlInjectionError when identifier contains spaces', () => {
            expect(() => SqlSanitizer.validateIdentifier('my column')).toThrow(SqlInjectionError);
        });

        it('throws SqlInjectionError for special characters', () => {
            expect(() => SqlSanitizer.validateIdentifier('col-name')).toThrow(SqlInjectionError);
            expect(() => SqlSanitizer.validateIdentifier('col$name')).toThrow(SqlInjectionError);
        });

        it('includes the label in the error message', () => {
            expect(() => SqlSanitizer.validateIdentifier('bad col', 'tableName'))
                .toThrow(/tableName/);
        });
    });

    describe('quoteIdentifier', () => {
        it('wraps a valid identifier in double quotes', () => {
            expect(SqlSanitizer.quoteIdentifier('users')).toBe('"users"');
        });

        it('handles schema-qualified identifiers', () => {
            expect(SqlSanitizer.quoteIdentifier('public.users')).toBe('"public"."users"');
        });

        it('throws SqlInjectionError for invalid identifier', () => {
            expect(() => SqlSanitizer.quoteIdentifier("bad col")).toThrow(SqlInjectionError);
        });
    });

    describe('validateIdentifiers (batch)', () => {
        it('passes for all valid identifiers', () => {
            expect(() => SqlSanitizer.validateIdentifiers(['col1', 'col2', 'col3'])).not.toThrow();
        });

        it('throws if any identifier is invalid', () => {
            expect(() => SqlSanitizer.validateIdentifiers(['col1', "bad col", 'col3'])).toThrow(SqlInjectionError);
        });
    });

    describe('validateLanguage', () => {
        it('accepts known PostgreSQL FTS languages', () => {
            expect(SqlSanitizer.validateLanguage('english')).toBe('english');
            expect(SqlSanitizer.validateLanguage('russian')).toBe('russian');
            expect(SqlSanitizer.validateLanguage('ENGLISH')).toBe('english'); // case insensitive
        });

        it('falls back to english for unknown languages', () => {
            expect(SqlSanitizer.validateLanguage('klingon')).toBe('english');
            expect(SqlSanitizer.validateLanguage(undefined)).toBe('english');
        });

        it('falls back to english for empty string', () => {
            expect(SqlSanitizer.validateLanguage('')).toBe('english');
        });
    });
});
