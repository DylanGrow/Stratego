import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outputDir = join(process.cwd(), 'dist');
mkdirSync(outputDir, { recursive: true });

const headers = `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
`;

const robots = `User-agent: *
Allow: /
Sitemap: https://yourusername.github.io/stratego-game/sitemap.xml
`;

writeFileSync(join(outputDir, '_headers'), headers, 'utf8');
writeFileSync(join(outputDir, 'robots.txt'), robots, 'utf8');
console.log('Security headers and robots.txt generated.');
