#!/usr/bin/env node
// Summarize failures_* JSON exports into per-label and combined statistics.
// Usage:
//   node scripts/summarize_failures.js [--inputs out/failures_*.json]
//   node scripts/summarize_failures.js --auto true
//
// Outputs (for each label):
//   out/<label>_summary.json
//   out/<label>_summary_by_block.csv
//   out/<label>_summary_by_method.csv
// Combined outputs:
//   out/failures_summary.json
//   out/failures_summary_by_method.csv

require('dotenv').config();
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.replace(/^--/, '');
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      out[key] = val;
    }
  }
  return out;
}

function fileExists(p) {
  try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; }
}

function ensureOutDir() {
  const outDir = path.join(__dirname, '..', 'out');
  if (!fileExists(outDir)) fs.mkdirSync(outDir, { recursive: true });
  return outDir;
}

function readJson(p) {
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function writeCSV(filePath, rows) {
  if (!rows.length) { fs.writeFileSync(filePath, ''); return; }
  const header = Object.keys(rows[0]);
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map(k => csvEscape(r[k])).join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function methodIdOf(input) {
  if (typeof input !== 'string') return 'none';
  const s = input.toLowerCase();
  if (!s.startsWith('0x') || s.length < 10) return 'none';
  return s.slice(0, 10);
}

function summarizeOne(label, data, samplePerMethod = 5, recentSample = 20) {
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const byBlock = new Map();
  const byMethod = new Map();
  const samplesByMethod = new Map();

  for (const r of rows) {
    const bn = Number(r.blockNumber || 0);
    const mid = methodIdOf(r.input);
    byBlock.set(bn, (byBlock.get(bn) || 0) + 1);
    byMethod.set(mid, (byMethod.get(mid) || 0) + 1);
    const arr = samplesByMethod.get(mid) || [];
    if (arr.length < samplePerMethod) arr.push({ txHash: r.txHash, blockNumber: bn, methodId: mid, gasUsed: r.gasUsed || '', effectiveGasPrice: r.effectiveGasPrice || '' });
    samplesByMethod.set(mid, arr);
  }

  const byBlockArr = Array.from(byBlock.entries()).map(([blockNumber, count]) => ({ blockNumber, count }))
    .sort((a, b) => a.blockNumber - b.blockNumber);
  const byMethodArr = Array.from(byMethod.entries()).map(([methodId, count]) => ({ methodId, count }))
    .sort((a, b) => b.count - a.count || a.methodId.localeCompare(b.methodId));

  const recent = rows
    .map(r => ({ txHash: r.txHash, blockNumber: Number(r.blockNumber || 0), methodId: methodIdOf(r.input), gasUsed: r.gasUsed || '', effectiveGasPrice: r.effectiveGasPrice || '' }))
    .sort((a, b) => b.blockNumber - a.blockNumber)
    .slice(0, recentSample);

  return {
    label,
    address: data.address || '',
    rpcUrl: data.rpcUrl || '',
    start: data.start || 0,
    end: data.end || 0,
    count: rows.length,
    byBlock: byBlockArr,
    byMethod: byMethodArr,
    samples: {
      byMethod: Array.from(samplesByMethod.entries()).map(([methodId, arr]) => ({ methodId, samples: arr })),
      recent,
    },
  };
}

function main() {
  const args = parseArgs();
  const OUT_DIR = ensureOutDir();

  let inputs = [];
  if (args.inputs && args.inputs !== 'true') {
    inputs = args.inputs.split(',').map(s => s.trim()).filter(Boolean);
  } else if (args.auto === 'true') {
    // auto discover failures_*.json under out/
    const dir = OUT_DIR;
    const files = fs.readdirSync(dir).filter(f => /^failures_.*\.json$/i.test(f));
    inputs = files.map(f => path.join(dir, f));
  } else {
    console.error('Usage: node scripts/summarize_failures.js --auto true OR --inputs <comma-separated paths>');
    process.exit(1);
  }

  const perLabel = [];
  const combinedByMethod = new Map();

  for (const p of inputs) {
    try {
      const data = readJson(p);
      const base = path.basename(p).replace(/^failures_/, '').replace(/\.json$/i, '');
      const summary = summarizeOne(base, data);
      perLabel.push(summary);

      // write per-label JSON
      const outJson = path.join(OUT_DIR, `${base}_summary.json`);
      fs.writeFileSync(outJson, JSON.stringify(summary, null, 2), 'utf8');

      // write per-label CSVs
      writeCSV(path.join(OUT_DIR, `${base}_summary_by_block.csv`), summary.byBlock);
      writeCSV(path.join(OUT_DIR, `${base}_summary_by_method.csv`), summary.byMethod);

      // accumulate combined method distribution
      for (const { methodId, count } of summary.byMethod) {
        combinedByMethod.set(methodId, (combinedByMethod.get(methodId) || 0) + count);
      }
    } catch (e) {
      console.warn('Skip file due to error:', p, e && e.message || e);
    }
  }

  // Write combined summary
  const combined = {
    totals: perLabel.map(s => ({ label: s.label, count: s.count })),
    byMethod: Array.from(combinedByMethod.entries()).map(([methodId, count]) => ({ methodId, count }))
      .sort((a, b) => b.count - a.count || a.methodId.localeCompare(b.methodId)),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'failures_summary.json'), JSON.stringify(combined, null, 2), 'utf8');
  writeCSV(path.join(OUT_DIR, 'failures_summary_by_method.csv'), combined.byMethod);

  console.log('Summaries saved:');
  for (const s of perLabel) {
    console.log(' -', path.join(OUT_DIR, `${s.label}_summary.json`));
    console.log(' -', path.join(OUT_DIR, `${s.label}_summary_by_block.csv`));
    console.log(' -', path.join(OUT_DIR, `${s.label}_summary_by_method.csv`));
  }
  console.log(' -', path.join(OUT_DIR, 'failures_summary.json'));
  console.log(' -', path.join(OUT_DIR, 'failures_summary_by_method.csv'));
}

main();