import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('../frontend/vendor', { recursive: true });
for (const [source, target] of [
  ['marked/lib/marked.esm.js', 'marked.js'],
  ['marked/LICENSE', 'MARKED-LICENSE'],
  ['dompurify/dist/purify.es.mjs', 'dompurify.js'],
  ['dompurify/LICENSE', 'DOMPURIFY-LICENSE'],
]) await copyFile(`node_modules/${source}`, `../frontend/vendor/${target}`);
