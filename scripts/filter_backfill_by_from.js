// Filter Balancer backfill CSV rows by transaction sender (from) or tx hashes.
// Usage:
//   node scripts/filter_backfill_by_from.js --in out/balancer_backfill_base.csv \
//     --rpc https://mainnet.base.org --address 0x... [--out out/balancer_backfill_base_by_addr.csv]
// Advanced:
//   - Multiple addresses: --addresses 0xA,0xB,0xC or --addrFile path/to/addrs.txt
//   - Filter by tx hashes: --txlist 0xH1,0xH2 or --txfile path/to/hashes.txt (one per line)
//   - Combine filters: rows must satisfy BOTH (address match AND tx hash listed) when both provided

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
      const val = args[i + 1];
      out[key] = val;
      i++;
    }
  }
  return out;
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function parseListArg(val) {
  if (!val) return [];
  return String(val)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadLinesFile(p) {
  try {
    const text = fs.readFileSync(path.resolve(p), 'utf8');
    return text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

async function main() {
  const { in: inputPathArg, rpc, address, addresses, addrFile, txlist, txfile, out: outPathArg } = parseArgs();
  if (!inputPathArg || !rpc) {
    console.error('Usage: node scripts/filter_backfill_by_from.js --in <csv> --rpc <rpcUrl> --address <0xAddr> [--addresses <comma>] [--addrFile <file>] [--txlist <comma>] [--txfile <file>] [--out <csv>]');
    process.exit(1);
  }
  const inputPath = path.resolve(inputPathArg);
  const provider = new ethers.providers.JsonRpcProvider(rpc);
  const addrSet = new Set(
    []
      .concat(address ? [address] : [])
      .concat(parseListArg(addresses))
      .concat(loadLinesFile(addrFile))
      .map((x) => String(x).toLowerCase())
  );
  const txSet = new Set(
    []
      .concat(parseListArg(txlist))
      .concat(loadLinesFile(txfile))
      .map((x) => String(x).toLowerCase())
  );

  const text = fs.readFileSync(inputPath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    console.error('Input CSV is empty');
    process.exit(1);
  }
  const header = lines[0].split(',');
  const txIndex = header.indexOf('transactionHash');
  if (txIndex === -1) {
    console.error('CSV missing transactionHash column');
    process.exit(1);
  }

  // Collect unique tx hashes
  const hashes = new Set();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const h = (cols[txIndex] || '').trim();
    if (h) hashes.add(h);
  }

  // Map txHash -> from
  const fromMap = new Map();
  let queried = 0;
  for (const h of hashes) {
    // If a tx hash filter is provided and this hash is not in it, we can skip the RPC call
    if (txSet.size > 0 && !txSet.has(h.toLowerCase())) continue;
    try {
      const tx = await provider.getTransaction(h);
      if (tx && tx.from) {
        fromMap.set(h.toLowerCase(), tx.from.toLowerCase());
      }
    } catch (e) {
      // swallow and continue
    }
    queried++;
    if (queried % 100 === 0) {
      process.stderr.write(`Queried ${queried}/${hashes.size} txs\r`);
    }
  }

  const outDir = path.resolve(path.join(path.dirname(inputPath), '..', 'out'));
  ensureDir(outDir);
  const outPath = outPathArg
    ? path.resolve(outPathArg)
    : path.join(outDir, path.basename(inputPath).replace(/\.csv$/, '') + `_by_${address.slice(0,6)}.csv`);

  // Write filtered rows with an extra from column
  const outHeader = [...header, 'from'];
  const outLines = [outHeader.join(',')];
  let matchCount = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const h = (cols[txIndex] || '').trim().toLowerCase();
    const from = fromMap.get(h) || '';
    // Apply tx hash filter when provided
    if (txSet.size > 0 && !txSet.has(h)) continue;
    // Apply address filter when provided
    if (addrSet.size > 0) {
      if (!from) continue;
      if (!addrSet.has(from)) continue;
    }
    outLines.push([...cols, from].join(','));
    matchCount++;
  }

  fs.writeFileSync(outPath, outLines.join('\n'));
  console.log(`Filtered ${matchCount} rows written to ${outPath}`);
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});