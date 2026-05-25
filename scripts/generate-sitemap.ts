import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const domain = process.env.SITE_URL ?? 'https://yourusername.github.io/stratego-game';
const outputDir = join(process.cwd(), 'dist');
const outputFile = join(outputDir, 'sitemap.xml');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${domain}</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputFile, xml, 'utf8');
console.log(`Sitemap written to ${outputFile}`);
