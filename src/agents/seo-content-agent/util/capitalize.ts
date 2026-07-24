// Tiny shared text helper: title-cases a keyword phrase for use in
// generated titles/section headings (e.g. "plumber near me" -> "Plumber
// Near Me"). Purely cosmetic text formatting, not a data claim of any kind.
export function capitalize(text: string): string {
  return text.replace(/\b\w/g, (character) => character.toUpperCase());
}
