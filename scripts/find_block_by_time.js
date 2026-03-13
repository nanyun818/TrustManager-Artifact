#!/usr/bin/env node
// Binary-search the block number nearest to a given timestamp (ISO8601 or epoch seconds)
// Usage:
//   node scripts/find_block_by_time.js --rpc https://arb1.arbitrum.io/rpc --time 2025-11-03T15:48:00+08:00

const { ethers } = require('ethers');

function parseArgs() {
  const argv = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rpc') opts.rpc = argv[++i];
    else if (a === '--time') opts.time = argv[++i];
  }
  if (!opts.rpc) throw new Error('missing --rpc');
  if (!opts.time) throw new Error('missing --time');
  return opts;
}

function toEpochSeconds(t) {
  if (/^\d{10}$/.test(t)) return Number(t);
  const ms = Date.parse(t);
  if (Number.isNaN(ms)) throw new Error('invalid time format');
  return Math.floor(ms / 1000);
}

async function findByTime(provider, ts) {
  const latest = await provider.getBlockNumber();
  // Expand lower bound until timestamp is below
  let lo = 0;
  let hi = latest;
  // Binary search for block with timestamp <= ts
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const b = await provider.getBlock(mid);
    const bt = (b && b.timestamp) || 0;
    if (bt <= ts) lo = mid; else hi = mid - 1;
  }
  const before = lo;
  const after = Math.min(before + 1, latest);
  const bBefore = await provider.getBlock(before);
  const bAfter = await provider.getBlock(after);
  return { before, beforeTs: bBefore.timestamp, after, afterTs: bAfter.timestamp, latest };
}

async function main() {
  const opts = parseArgs();
  const ts = toEpochSeconds(opts.time);
  const provider = new ethers.providers.JsonRpcProvider(opts.rpc);
  const net = await provider.getNetwork();
  console.log(`Connected chainId=${net.chainId}`);
  const res = await findByTime(provider, ts);
  console.log(JSON.stringify({ targetTs: ts, ...res }, null, 2));
  const window = 50000;
  const start = Math.max(0, res.before - window);
  const end = res.before + window;
  console.log(`Suggested range: start=${start} end=${end} (±${window})`);
}

main().catch((e) => { console.error('find_block_by_time failed:', e.message || e); process.exit(1); });