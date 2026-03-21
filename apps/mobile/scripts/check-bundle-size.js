#!/usr/bin/env node
/**
 * Task #616 — Bundle size monitoring
 *
 * Measures the total uncompressed size and the sum of per-file gzip-compressed
 * sizes for TypeScript/TSX/JS source files under src/. This serves as a fast
 * CI proxy for bundle growth: if source balloons, so will the Metro bundle.
 * Note: summing per-file gzip values is a conservative upper-bound estimate —
 * a real bundled artifact would compress even further due to cross-file
 * deduplication, but this approach avoids running Metro in CI.
 *
 * Thresholds (adjust as the project grows):
 *   Raw source:   4 000 KB  (~4 MB)
 *   Sum-of-gzip:  1 200 KB  (~1.2 MB)
 *
 * Usage:
 *   node scripts/check-bundle-size.js            # check & report
 *   node scripts/check-bundle-size.js --json     # machine-readable output
 *   node scripts/check-bundle-size.js --verbose  # list per-directory breakdown
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ─── Configuration ────────────────────────────────────────────────────────────

const SRC_DIR = path.resolve(__dirname, '../src');
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const THRESHOLDS = {
  rawKB: 4000,    // fail if total raw source exceeds 4 MB
  gzipKB: 1200,   // fail if estimated gzip size exceeds 1.2 MB
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function walkDir(dir, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip test directories from size measurement
      if (!['__tests__', '__mocks__', 'coverage', '.jest-cache'].includes(entry.name)) {
        walkDir(fullPath, results);
      }
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

function estimateGzip(content) {
  return zlib.gzipSync(content).length;
}

// ─── Measure ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isJson = args.includes('--json');
const isVerbose = args.includes('--verbose');

const files = walkDir(SRC_DIR);

let totalRaw = 0;
let totalGzip = 0;
const dirStats = {};

for (const file of files) {
  const content = fs.readFileSync(file);
  const rawSize = content.length;
  const gzipSize = estimateGzip(content);
  totalRaw += rawSize;
  totalGzip += gzipSize;

  if (isVerbose) {
    const relDir = path.relative(SRC_DIR, path.dirname(file));
    dirStats[relDir] = dirStats[relDir] || { raw: 0, gzip: 0, files: 0 };
    dirStats[relDir].raw += rawSize;
    dirStats[relDir].gzip += gzipSize;
    dirStats[relDir].files++;
  }
}

const totalRawKB = (totalRaw / 1024).toFixed(1);
const totalGzipKB = (totalGzip / 1024).toFixed(1);
const rawPassed = totalRaw / 1024 <= THRESHOLDS.rawKB;
const gzipPassed = totalGzip / 1024 <= THRESHOLDS.gzipKB;
const passed = rawPassed && gzipPassed;

// ─── Output ───────────────────────────────────────────────────────────────────

if (isJson) {
  console.log(JSON.stringify({
    rawKB: parseFloat(totalRawKB),
    gzipKB: parseFloat(totalGzipKB),
    thresholds: THRESHOLDS,
    passed,
    rawPassed,
    gzipPassed,
    fileCount: files.length,
  }, null, 2));
} else {
  console.log('\n📦 Bundle Size Check (Task #616)\n' + '─'.repeat(50));
  console.log(`  Source files measured : ${files.length}`);
  console.log(`  Raw source total      : ${totalRawKB} KB  (limit: ${THRESHOLDS.rawKB} KB)  ${rawPassed ? '✅' : '❌'}`);
  console.log(`  Estimated gzip        : ${totalGzipKB} KB  (limit: ${THRESHOLDS.gzipKB} KB)  ${gzipPassed ? '✅' : '❌'}`);

  if (isVerbose) {
    console.log('\nPer-directory breakdown:');
    const sorted = Object.entries(dirStats).sort((a, b) => b[1].raw - a[1].raw);
    for (const [dir, stats] of sorted.slice(0, 15)) {
      const rawK = (stats.raw / 1024).toFixed(1).padStart(7);
      const gzK = (stats.gzip / 1024).toFixed(1).padStart(7);
      console.log(`  ${rawK} KB raw  ${gzK} KB gz  [${stats.files} files]  ${dir || '.'}`);
    }
  }

  if (!passed) {
    const failures = [];
    if (!rawPassed) {
      failures.push(`  ❌ Raw source ${totalRawKB} KB exceeds limit of ${THRESHOLDS.rawKB} KB`);
    }
    if (!gzipPassed) {
      failures.push(`  ❌ Gzip estimate ${totalGzipKB} KB exceeds limit of ${THRESHOLDS.gzipKB} KB`);
    }
    console.error('\nBundle size check FAILED:\n' + failures.join('\n'));
    console.error('\nTo update thresholds, edit THRESHOLDS in scripts/check-bundle-size.js');
    process.exit(1);
  } else {
    console.log('\n✅ Bundle size check passed.\n');
  }
}
