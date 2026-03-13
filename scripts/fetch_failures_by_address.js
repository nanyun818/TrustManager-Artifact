#!/usr/bin/env node
// Scan a block range via RPC to find failed transactions to a specific address
// Usage:
//   node scripts/fetch_failures_by_address.js --address 0x... --start <startBlock> --end <endBlock> --rpc <rpcUrl> [--outSuffix <label>]
// Outputs:
//   out/failures_<label>.json
//   out/failures_<label>.csv

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

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

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/\"/g, '""') + '"';
    }
    return s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => escape(r[h])).join(','));
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs();
  const target = (opts.address || '').trim().toLowerCase();
  if (!target) {
    console.error('Error: --address is required');
    process.exit(1);
  }
  const start = Number(opts.start || 0);
  const end = Number(opts.end || 0);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0 || end < start) {
    console.error('Error: invalid --start/--end');
    process.exit(1);
  }
  const rpcUrl = (opts.rpc || process.env.RPC_URL || process.env.PROVIDER_URL || '').trim();
  if (!rpcUrl) {
    console.error('Error: --rpc or RPC_URL/PROVIDER_URL must be set');
    process.exit(1);
  }
  const label = (opts.outSuffix || 'scan').trim();
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

  const failures = [];
  let lastProgress = Date.now();
  for (let b = start; b <= end; b++) {
    let block;
    try {
      block = await provider.getBlockWithTransactions(b);
    } catch (e) {
      // transient network error: retry once
      try { block = await provider.getBlockWithTransactions(b); } catch (_) { block = null; }
    }
    if (!block) continue;
    const candidates = block.transactions.filter((tx) => (tx.to || '').toLowerCase() === target);
    for (const tx of candidates) {
      let receipt;
      try {
        receipt = await provider.getTransactionReceipt(tx.hash);
      } catch (_) { receipt = null; }
      if (!receipt) continue;
      const failed = receipt.status === 0;
      if (failed) {
        failures.push({
          txHash: tx.hash,
          blockNumber: tx.blockNumber,
          timeStamp: block.timestamp,
          from: tx.from,
          to: tx.to,
          status: 0,
          gasUsed: receipt.gasUsed ? receipt.gasUsed.toString() : '',
          effectiveGasPrice: receipt.effectiveGasPrice ? receipt.effectiveGasPrice.toString() : '',
          type: tx.type,
          maxFeePerGas: tx.maxFeePerGas ? tx.maxFeePerGas.toString() : '',
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? tx.maxPriorityFeePerGas.toString() : '',
          input: tx.data,
        });
      }
    }
    if (Date.now() - lastProgress > 1500) {
      process.stdout.write(`Scanned block ${b}/${end}, failures=${failures.length}\r`);
      lastProgress = Date.now();
    }
  }

  const OUT_DIR = path.join(__dirname, '..', 'out');
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, `failures_${label}.json`);
  const csvPath = path.join(OUT_DIR, `failures_${label}.csv`);
  fs.writeFileSync(jsonPath, JSON.stringify({ address: target, rpcUrl, start, end, count: failures.length, rows: failures }, null, 2), 'utf8');
  fs.writeFileSync(csvPath, toCsv(failures), 'utf8');
  console.log(`\nSaved ${failures.length} failures ->`);
  console.log(' -', jsonPath);
  console.log(' -', csvPath);
}

main().catch((err) => {
  console.error('fetch_failures_by_address error:', err && err.message ? err.message : err);
  process.exit(1);
});