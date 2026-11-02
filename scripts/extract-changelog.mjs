#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const [component, version] = process.argv.slice(2);
if (!['core', 'desktop', 'harmony'].includes(component) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || '')) {
  throw new Error('Usage: node scripts/extract-changelog.mjs <core|desktop|harmony> <version>');
}
const lines = readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/);
const heading = `## [${component}-${version}]`;
const starts = lines.flatMap((line, i) => line === heading || line.startsWith(`${heading} `) ? [i] : []);
if (starts.length !== 1) throw new Error(`Expected exactly one ${heading} section`);
const end = lines.findIndex((line, i) => i > starts[0] && /^##\s/.test(line));
const body = lines.slice(starts[0] + 1, end < 0 ? undefined : end).join('\n').trim();
if (!body) throw new Error(`Empty ${heading} section`);
console.log(body);
