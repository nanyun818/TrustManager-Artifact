#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const argv = process.argv.slice(2);
  const opts = { suffix: '', in: '', out: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--suffix') opts.suffix = argv[++i];
    else if (a === '--in') opts.in = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
  }
  return opts;
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/\"/g, '""') + '"';
    }
    return s;
  };
  const out = [headers.join(',')];
  for (const r of rows) out.push(headers.map((h) => esc(r[h])).join(','));
  return out.join('\n');
}

function summarize(rows) {
  const byPool = new Map();
  for (const r of rows) {
    const key = (r.poolAddress || '').toLowerCase();
    if (!key) continue;
    const cur = byPool.get(key) || { poolAddress: key, transfers: 0, swaps: 0, balanceChanged: 0, firstBlock: r.blockNumber, lastBlock: r.blockNumber, txs: new Set() };
    const t0 = String(r.topic0 || '').toLowerCase();
    if (t0.startsWith('0xddf252ad')) cur.transfers++;
    else if (t0.startsWith('0x877d3ea8')) cur.swaps++;
    else if (t0.startsWith('0x2170c741')) cur.balanceChanged++;
    cur.firstBlock = Math.min(cur.firstBlock, r.blockNumber);
    cur.lastBlock = Math.max(cur.lastBlock, r.blockNumber);
    (cur.txs).add(r.transactionHash);
    byPool.set(key, cur);
  }
  const out = [];
  for (const v of byPool.values()) {
    out.push({ poolAddress: v.poolAddress, firstBlock: v.firstBlock, lastBlock: v.lastBlock, uniqueTxs: v.txs.size, transfers: v.transfers, swaps: v.swaps, balanceChanged: v.balanceChanged });
  }
  out.sort((a,b)=> b.uniqueTxs - a.uniqueTxs);
  return out;
}

function main() {
  const opts = parseArgs();
  let inPath = opts.in;
  if (!inPath) {
    const base = 'balancer_backfill' + (opts.suffix ? '_' + opts.suffix : '');
    inPath = path.join(process.cwd(), 'out', base + '.json');
  }
  const raw = fs.readFileSync(inPath, 'utf-8');
  const data = JSON.parse(raw);
  const rows = (data.rows || []);
  const summary = summarize(rows);
  let outPath = opts.out || path.join(process.cwd(), 'out', 'balancer_summary' + (opts.suffix ? '_' + opts.suffix : '') + '.csv');
  fs.writeFileSync(outPath, toCsv(summary), 'utf-8');
  console.log(`Summary written -> ${outPath} (pools=${summary.length})`);
}

main();