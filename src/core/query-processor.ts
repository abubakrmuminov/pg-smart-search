import { TransliterationUtils } from './transliteration-utils';

export class QueryProcessor {
    /**
     * Normalize query: lowercase, trim, remove redundant punctuation
     */
    static normalize(query: string): string {
        return query
            .toLowerCase()
            .trim()
            .replace(/[.,!?;:]+$/, '') // Remove trailing punctuation
            .replace(/\s+/g, ' ');      // Collapse multiple spaces
    }

    /**
     * Convert English keyboard layout to Russian (Smart Layout Fallback)
     */
    static convertLayout(query: string): string {
        const en = "qwertyuiop[]asdfghjkl;'zxcvbnm,./QWERTYUIOP{}ASDFGHJKL:\"ZXCVBNM<>?".split('');
        const ru = "йцукенгшщзхъфывапролджэячсмитьбю.ЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ,".split('');
        
        const map: Record<string, string> = {};
        en.forEach((char, i) => map[char] = ru[i]);

        return query.split('').map(char => map[char] || char).join('');
    }

    /**
     * Transliterate Cyrillic characters to their Latin equivalents using ISO 9:1995.
     * Useful for cross-language matching (e.g. searching "рамадан" against "ramadan")
     */
    static transliterate(text: string): string {
        return TransliterationUtils.transliterate(text);
    }

    /**
     * Basic validation for search queries
     */
    static validate(query: string): { valid: boolean; reason?: string } {
        if (!query) return { valid: false, reason: 'empty' };
        if (query.trim().length < 2) return { valid: false, reason: 'too_short' };
        
        // Check for at least one alphanumeric character (including Arabic/Cyrillic)
        if (!/[а-яА-ЯёЁa-zA-Z0-9\u0600-\u06FF]/.test(query)) {
            return { valid: false, reason: 'no_valid_chars' };
        }
        
        return { valid: true };
    }
}
