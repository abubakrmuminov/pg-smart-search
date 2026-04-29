/**
 * SqlSanitizer — Utilities for safely embedding identifiers in SQL.
 *
 * PostgreSQL does not allow parameterized placeholders for table names,
 * column names, or language strings. These must be validated and quoted
 * before being embedded into SQL strings.
 */

/** Regex for valid SQL identifiers: letters, digits, underscores, dots (schema.table) */
const IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;

/** Allowed PostgreSQL FTS language names (from pg_catalog.pg_ts_config) */
const ALLOWED_LANGUAGES: ReadonlySet<string> = new Set([
  "simple",
  "arabic",
  "armenian",
  "basque",
  "catalan",
  "danish",
  "dutch",
  "english",
  "finnish",
  "french",
  "german",
  "greek",
  "hindi",
  "hungarian",
  "indonesian",
  "irish",
  "italian",
  "lithuanian",
  "nepali",
  "norwegian",
  "portuguese",
  "romanian",
  "russian",
  "serbian",
  "spanish",
  "swedish",
  "tamil",
  "turkish",
  "yiddish",
]);

export class SqlInjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SqlInjectionError";
  }
}

export class SqlSanitizer {
  /**
   * Validates that an identifier is safe to embed in SQL.
   * Throws `SqlInjectionError` if validation fails.
   *
   * @param name - The identifier to validate (table name, column name, etc.)
   * @param label - Human-readable label for error messages (e.g. "tableName")
   */
  static validateIdentifier(name: string, label = "identifier"): void {
    if (!name || typeof name !== "string") {
      throw new SqlInjectionError(`${label} must be a non-empty string`);
    }
    if (!IDENTIFIER_REGEX.test(name)) {
      throw new SqlInjectionError(
        `Invalid ${label}: "${name}". Only letters, digits, underscores, and dots are allowed.`,
      );
    }
  }

  /**
   * Validates and returns a double-quoted SQL identifier.
   * Prevents ambiguity with reserved words and injection via identifier names.
   *
   * @param name - The identifier to quote
   * @param label - Human-readable label for error messages
   */
  static quoteIdentifier(name: string, label = "identifier"): string {
    SqlSanitizer.validateIdentifier(name, label);
    // Dots are for schema-qualified names (e.g. public.users) — split and quote each part
    return name
      .split(".")
      .map((part) => `"${part}"`)
      .join(".");
  }

  /**
   * Validates all identifiers in an array (e.g. searchColumns).
   */
  static validateIdentifiers(names: string[], label = "column"): void {
    for (const name of names) {
      SqlSanitizer.validateIdentifier(name, label);
    }
  }

  /**
   * Validates a PostgreSQL FTS language name against a known-safe allowlist.
   * Falls back to 'english' if the provided value is not in the allowlist.
   *
   * @param language - The language string to validate
   * @returns The safe language name to use
   */
  static validateLanguage(language: string | undefined): string {
    const lang = (language || "english").toLowerCase().trim();
    if (!ALLOWED_LANGUAGES.has(lang)) {
      // Do NOT throw — silently fall back to 'english' to avoid breaking searches
      return "english";
    }
    return lang;
  }
}
