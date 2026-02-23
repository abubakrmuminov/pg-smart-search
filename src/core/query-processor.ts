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
     * Transliterate Cyrillic characters to their Latin equivalents.
     * Useful for cross-language matching (e.g. searching "рамадан" against "ramadan")
     */
    static transliterate(text: string): string {
        const map: Record<string, string> = {
            'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo',
            'ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m',
            'н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u',
            'ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'shch',
            'ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
        };
        return text.toLowerCase().split('').map(ch => map[ch] ?? ch).join('');
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
