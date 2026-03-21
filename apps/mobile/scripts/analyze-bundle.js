#!/usr/bin/env node
/**
 * Task #276 — Bundle analysis & image audit
 *
 * Reports:
 *   1. Source file sizes (raw + gzip per directory)
 *   2. Large image assets that should be converted to WebP
 *   3. Dependency count (top-level node_modules)
 *
 * This is a static analysis tool — no Metro build required.
 * Run before/after changes to track bundle growth.
 *
 * Usage:
 *   node scripts/analyze-bundle.js            # full report
 *   node scripts/analyze-bundle.js --json     # machine-readable output
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC_DIR = path.resolve(__dirname, '../src');
const ASSETS_DIR = path.resolve(__dirname, '../assets');
const PKG_JSON = path.resolve(__dirname, '../package.json');

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp']);
// Images larger than this (KB) should be considered for WebP conversion
const IMAGE_SIZE_WARN_KB = 50;

const isJson = process.argv.includes('--json');

// ─── Source size ─────────────────────────────────────────────────────────────

function walkDir(dir, exts, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['__tests__', '__mocks__', 'coverage', '.jest-cache', 'node_modules'].includes(entry.name)) {
        walkDir(full, exts, results);
      }
    } else if (exts.has(path.extname(entry.name).toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}

const srcFiles = walkDir(SRC_DIR, EXTENSIONS);
let totalRaw = 0, totalGzip = 0;
const dirStats = {};

for (const file of srcFiles) {
  const content = fs.readFileSync(file);
  const raw = content.length;
  const gz = zlib.gzipSync(content).length;
  totalRaw += raw;
  totalGzip += gz;
  const relDir = path.relative(SRC_DIR, path.dirname(file));
  dirStats[relDir] = dirStats[relDir] || { raw: 0, gzip: 0, count: 0 };
  dirStats[relDir].raw += raw;
  dirStats[relDir].gzip += gz;
  dirStats[relDir].count++;
}

// ─── Image audit ─────────────────────────────────────────────────────────────

const imageFiles = walkDir(ASSETS_DIR, IMAGE_EXTENSIONS);
const largeImages = imageFiles
  .map(f => ({ file: path.relative(ASSETS_DIR, f), sizeKB: +(fs.statSync(f).size / 1024).toFixed(1) }))
  .filter(i => i.sizeKB >= IMAGE_SIZE_WARN_KB)
  .sort((a, b) => b.sizeKB - a.sizeKB);

// ─── Dependency count ─────────────────────────────────────────────────────────

let directDeps = 0, devDeps = 0;
try {
  const pkg = JSON.parse(fs.readFileSync(PKG_JSON, 'utf8'));
  directDeps = Object.keys(pkg.dependencies || {}).length;
  devDeps = Object.keys(pkg.devDependencies || {}).length;
} catch {
  // skip
}

// ─── Output ──────────────────────────────────────────────────────────────────

if (isJson) {
  console.log(JSON.stringify({
    source: {
      fileCount: srcFiles.length,
      rawKB: +(totalRaw / 1024).toFixed(1),
      gzipKB: +(totalGzip / 1024).toFixed(1),
    },
    largeImages,
    deps: { direct: directDeps, dev: devDeps },
  }, null, 2));
} else {
  console.log('\n📦 Bundle Analysis Report (Task #276)\n' + '─'.repeat(55));

  console.log(`\n📄 Source Files`);
  console.log(`  Files     : ${srcFiles.length}`);
  console.log(`  Raw total : ${(totalRaw / 1024).toFixed(1)} KB`);
  console.log(`  Gzip est. : ${(totalGzip / 1024).toFixed(1)} KB`);

  const topDirs = Object.entries(dirStats)
    .sort((a, b) => b[1].raw - a[1].raw)
    .slice(0, 10);
  console.log('\n  Top directories by raw size:');
  for (const [dir, s] of topDirs) {
    console.log(`    ${(s.raw / 1024).toFixed(1).padStart(7)} KB raw  [${s.count} files]  ${dir || '.'}`);
  }

  console.log(`\n🖼️  Image Assets (>= ${IMAGE_SIZE_WARN_KB} KB, consider WebP conversion)`);
  if (largeImages.length === 0) {
    console.log('  ✅ No large images found.');
  } else {
    for (const img of largeImages) {
      console.log(`  ⚠️  ${img.sizeKB} KB  ${img.file}`);
    }
  }

  console.log(`\n📦 Dependencies`);
  console.log(`  Direct : ${directDeps}`);
  console.log(`  Dev    : ${devDeps}`);

  console.log('\n💡 Performance targets (Task #276): <50 MB app · <3 s cold start');
  console.log('   Run with --json to get machine-readable output for CI.\n');
}
