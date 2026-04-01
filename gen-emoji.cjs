const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'public', 'emoji');
const cats = fs.readdirSync(dir)
  .filter(d => fs.statSync(path.join(dir, d)).isDirectory() && d !== 'web');

const result = {};
cats.forEach(c => {
  const files = fs.readdirSync(path.join(dir, c))
    .filter(f => f.endsWith('.webp'))
    .map(f => f.replace('.webp', ''));
  result[c] = files;
});

// Write as TypeScript module
const lines = ['// AUTO-GENERATED — do not edit', ''];
lines.push('export const EMOJI_CATEGORIES: { name: string; icon: string; emojis: string[] }[] = [');
const icons = {
  'Smileys': '😀', 'People': '👋', 'Animals and Nature': '🐶',
  'Food and Drink': '🍕', 'Travel and Places': '✈️', 'Activity': '⚽',
  'Objects': '💡', 'Symbols': '❤️', 'Flags': '🏁'
};
for (const [cat, files] of Object.entries(result)) {
  lines.push(`  { name: '${cat}', icon: '${icons[cat] || '📁'}', emojis: [`);
  files.forEach(f => lines.push(`    '${f.replace(/'/g, "\\'")}',`));
  lines.push('  ] },');
}
lines.push('];');
lines.push('');
lines.push('export function getEmojiUrl(category: string, name: string): string {');
lines.push("  return `/emoji/${encodeURIComponent(category)}/${encodeURIComponent(name)}.webp`;");
lines.push('}');

fs.writeFileSync(path.join(__dirname, 'src', 'lib', 'emojiData.ts'), lines.join('\n'));
console.log('Done! Categories:', Object.keys(result).length, 'Total emojis:', Object.values(result).reduce((a, b) => a + b.length, 0));
