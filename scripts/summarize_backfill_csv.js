#!/usr/bin/env node
// Summarize a Balancer backfill CSV: counts, topic distribution, unique pools.
// Usage:
//   node scripts/summarize_backfill_csv.js --in out/balancer_backfill_mainnet_narrow.csv [--label mainnet]
// Outputs a JSON summary to stdout and writes a CSV summary file next to the input.

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const argv = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') opts.in = argv[++i];
    else if (a === '--label') opts.label = argv[++i];
  }
  if (!opts.in) {
    console.error('Usage: node scripts/summarize_backfill_csv.js --in <csv> [--label <name>]');
    process.exit(1);
  }
  return opts;
}

function summarize(csvText) {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return { total: 0, topics: {}, pools: [] };
  const header = lines[0].split(',');
  const idxTopic = header.indexOf('topic0');
  const idxPool = header.indexOf('poolAddress');
  const idxHash = header.indexOf('transactionHash');
  const topicMap = new Map();
  const poolSet = new Set();
  const hashes = new Set();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (idxTopic >= 0) {
      const t = (cols[idxTopic] || '').toLowerCase();
      topicMap.set(t, (topicMap.get(t) || 0) + 1);
    }
    if (idxPool >= 0) {
      const p = (cols[idxPool] || '').toLowerCase();
      if (p) poolSet.add(p);
    }
    if (idxHash >= 0) {
      const h = (cols[idxHash] || '').toLowerCase();
      if (h) hashes.add(h);
    }
  }
  const topics = Object.fromEntries(Array.from(topicMap.entries()).sort((a, b) => b[1] - a[1]));
  const pools = Array.from(poolSet.values());
  return { total: lines.length - 1, topics, pools, uniqueTxs: hashes.size };
}

function main() {
  const opts = parseArgs();
  const fp = path.resolve(opts.in);
  const text = fs.readFileSync(fp, 'utf8');
  const s = summarize(text);
  const label = opts.label || path.basename(fp).replace(/\.csv$/, '');
  const outJson = {
    label,
    totalLogs: s.total,
    uniqueTxs: s.uniqueTxs,
    topicDistribution: s.topics,
    poolAddresses: s.pools,
  };
  console.log(JSON.stringify(outJson, null, 2));
  const outDir = path.dirname(fp);
  const outPath = path.join(outDir, label + '_summary.json');
  fs.writeFileSync(outPath, JSON.stringify(outJson, null, 2));
}

main();