import { ThresholdCalculator } from '../../src/core/threshold-calculator';

describe('ThresholdCalculator', () => {
    describe('calculate', () => {
        it('returns 0.8 for very short single-word queries (< 5 chars)', () => {
            expect(ThresholdCalculator.calculate('abc')).toBe(0.8);
            expect(ThresholdCalculator.calculate('hi')).toBe(0.8);
        });

        it('returns 0.7 for exactly 5-char single-word queries', () => {
            expect(ThresholdCalculator.calculate('hello')).toBe(0.7);
            expect(ThresholdCalculator.calculate('world')).toBe(0.7);
        });

        it('returns 0.5 for 6-9 char single-word queries', () => {
            expect(ThresholdCalculator.calculate('search')).toBe(0.5);   // 6 chars
            expect(ThresholdCalculator.calculate('postgres')).toBe(0.5); // 8 chars
        });

        it('returns 0.4 for medium-length queries (10-29 chars)', () => {
            expect(ThresholdCalculator.calculate('hello there world')).toBe(0.4); // 17 chars
            expect(ThresholdCalculator.calculate('a'.repeat(29))).toBe(0.4);
        });

        it('returns 0.3 for long queries (30+ chars)', () => {
            expect(ThresholdCalculator.calculate('a'.repeat(30))).toBe(0.3);
            expect(ThresholdCalculator.calculate('a'.repeat(100))).toBe(0.3);
        });

        it('treats multi-word short queries as medium (not single-word branch)', () => {
            // "ab cd" is 5 chars but 2 words — should not hit the single-word short branch
            const result = ThresholdCalculator.calculate('ab cd');
            expect(result).toBeLessThanOrEqual(0.7);
        });
    });
});
