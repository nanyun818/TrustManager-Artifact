// Scan historical blocks to find anomalous transactions and relevant contract events
// Usage:
// 1) Set PROVIDER_URL in .env or environment (e.g., http://127.0.0.1:8545)
// 2) Optionally set START_BLOCK, END_BLOCK, CONTRACT_ADDRESS, ADDRESS_WHITELIST (comma-separated)
// 3) npm install --save ethers@5 dotenv
// 4) node scripts/scan_history.js

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { ethers } = require('ethers');

const ROOT = __dirname ? path.resolve(__dirname, '..') : process.cwd();

function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch (_) {}
}

function log(msg, obj) {
  if (obj !== undefined) {
    console.log(msg, obj);
  } else {
    console.log(msg);
  }
}

function loadAbi() {
  const artifact = path.join(ROOT, 'artifacts', 'TrustManager.json');
  if (!fs.existsSync(artifact)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(artifact, 'utf8'));
    if (j && j.abi) return j.abi;
  } catch (_) {}
  return null;
}

function toCsvRow(fields) {
  return fields
    .map((x) => {
      if (x === null || x === undefined) return '';
      const s = String(x);
      if (s.includes(',') || s.includes('\n') || s.includes('"')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    })
    .join(',');
}

async function main() {
  const RPC_URL = process.env.PROVIDER_URL || process.env.RPC_URL || 'http://127.0.0.1:8545';
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  log(`Connected: chainId=${network.chainId} rpc=${RPC_URL}`);

  // Load ABI to decode function names and events (best-effort)
  const abi = loadAbi();
  const iface = abi ? new ethers.utils.Interface(abi) : null;
  if (iface) log('ABI loaded: events/functions will be decoded when possible');
  else log('ABI missing: will output signatures only');

  const latestBlock = await provider.getBlockNumber();
  const START_BLOCK = Number(process.env.START_BLOCK || Math.max(0, latestBlock - 5000));
  const END_BLOCK = Number(process.env.END_BLOCK || latestBlock);

  const CONTRACT_ADDRESS = (process.env.CONTRACT_ADDRESS || '').toLowerCase();
  const WHITELIST = (process.env.ADDRESS_WHITELIST || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s);
  const WL = new Set(WHITELIST);

  log(`Scanning blocks [${START_BLOCK}, ${END_BLOCK}] total=${END_BLOCK - START_BLOCK + 1}`);

  // Check debug availability (optional)
  let debugOk = false;
  try {
    // Use a fake call to see if the RPC supports debug_traceTransaction
    await provider.send('rpc_modules', []); // Some nodes expose available modules
    // We won't rely on modules list. We'll try a harmless trace later.
    debugOk = true; // mark as tentatively ok; we'll handle per-tx errors
  } catch (_) {
    // Not critical; we'll try per transaction and swallow errors
  }

  const outDir = path.join(ROOT, 'out');
  ensureDir(outDir);
  const jsonOut = path.join(outDir, 'history_anomalies.json');
  const csvOut = path.join(outDir, 'history_anomalies.csv');

  const rows = [];
  const records = [];
  const header = [
    'hash',
    'blockNumber',
    'timestamp',
    'from',
    'to',
    'status',
    'method',
    'methodSig',
    'gasUsed',
    'classifiedError',
    'decodedEvents',
  ];
  rows.push(toCsvRow(header));

  for (let b = START_BLOCK; b <= END_BLOCK; b++) {
    let block;
    try {
      block = await provider.getBlockWithTransactions(b);
    } catch (e) {
      log(`Warning: failed to get block ${b}: ${e.message || e}`);
      continue;
    }
    const ts = new Date((block.timestamp || 0) * 1000).toISOString();
    for (const tx of block.transactions) {
      // Filter by whitelist/contract when provided
      const fromLc = (tx.from || '').toLowerCase();
      const toLc = (tx.to || '').toLowerCase();
      if (CONTRACT_ADDRESS && toLc !== CONTRACT_ADDRESS) continue;
      if (WL.size > 0 && !WL.has(fromLc) && !WL.has(toLc)) continue;

      let receipt;
      try {
        receipt = await provider.getTransactionReceipt(tx.hash);
      } catch (e) {
        // Skip if receipt not ready
        continue;
      }
      if (!receipt) continue;

      const status = receipt.status; // 1 success, 0 failure
      const gasUsed = receipt.gasUsed ? receipt.gasUsed.toString() : '';
      const methodSig = tx.data && tx.data.length >= 10 ? tx.data.slice(0, 10) : '';
      let methodName = '';
      if (iface) {
        try {
          const parsed = iface.parseTransaction({ data: tx.data, value: tx.value });
          methodName = parsed && parsed.name ? parsed.name : '';
        } catch (_) {}
      }

      // Decode events if ABI available
      const decodedEvents = [];
      if (iface && receipt.logs && receipt.logs.length > 0) {
        for (const lg of receipt.logs) {
          try {
            const ev = iface.parseLog(lg);
            if (ev && ev.name) decodedEvents.push(ev.name);
          } catch (_) {}
        }
      }

      // Attempt classification via debug trace (optional)
      let classifiedError = '';
      if (status === 0) {
        try {
          const trace = await provider.send('debug_traceTransaction', [tx.hash, { disableStorage: true, disableStack: false }]);
          if (trace && trace.error) {
            classifiedError = String(trace.error);
          } else if (trace && trace.returnValue === '0x') {
            classifiedError = 'revert/no data';
          } else if (trace && trace.structLogs && Array.isArray(trace.structLogs)) {
            // Heuristic: look for Out of gas in error or last op
            const last = trace.structLogs[trace.structLogs.length - 1];
            if (last && typeof last.gas === 'number' && last.gas === 0) {
              classifiedError = 'out of gas (heuristic)';
            }
          }
        } catch (e) {
          // Debug unavailable; fallback classification
          classifiedError = 'failed (no debug)';
        }
      }

      const rec = {
        hash: tx.hash,
        blockNumber: receipt.blockNumber,
        timestamp: ts,
        from: tx.from,
        to: tx.to,
        status,
        method: methodName || '',
        methodSig,
        gasUsed,
        classifiedError,
        decodedEvents,
      };
      records.push(rec);
      rows.push(
        toCsvRow([
          rec.hash,
          rec.blockNumber,
          rec.timestamp,
          rec.from,
          rec.to,
          rec.status,
          rec.method,
          rec.methodSig,
          rec.gasUsed,
          rec.classifiedError,
          rec.decodedEvents.join('|'),
        ])
      );
    }
  }

  fs.writeFileSync(jsonOut, JSON.stringify(records, null, 2));
  fs.writeFileSync(csvOut, rows.join('\n'));
  log('Scan complete. Outputs:');
  log('JSON: ' + jsonOut);
  log('CSV:  ' + csvOut);
}

main().catch((err) => {
  console.error('Scan failed:', err);
  process.exit(1);
});