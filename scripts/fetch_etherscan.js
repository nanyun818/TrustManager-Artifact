// Fetch failures from Etherscan-like API and export CSV/JSON
// Usage:
//   ETHERSCAN_API_KEY=<key> node scripts/fetch_etherscan.js --address 0x.. [--start 0] [--end latest] [--network sepolia] [--offset 10000]
// Env:
//   ETHERSCAN_API_KEY (required)
//   ETHERSCAN_NETWORK (optional: mainnet|sepolia|goerli)
//   ETHERSCAN_BASE (optional: override base host, e.g. https://api.etherscan.io)
// Output:
//   out/etherscan_failures.json
//   out/etherscan_failures.csv

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
let HttpsProxyAgent;
try {
    HttpsProxyAgent = require('https-proxy-agent').HttpsProxyAgent;
} catch (e) {
    // console.warn("Optional dependency 'https-proxy-agent' not found. Proxy support disabled.");
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.replace(/^--/, '');
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      opts[key] = val;
    }
  }
  return opts;
}

function getChainId(network) {
  const net = (network || 'mainnet').toLowerCase();
  switch (net) {
    case 'mainnet': return 1;
    case 'ropsten': return 3;
    case 'rinkeby': return 4;
    case 'goerli': return 5;
    case 'kovan': return 42;
    case 'bsc': return 56;
    case 'bsc_testnet': return 97;
    case 'polygon': return 137;
    case 'mumbai': return 80001;
    case 'sepolia': return 11155111;
    case 'base': return 8453;
    default: return 1;
  }
}

function getBaseUrl(network, override) {
  // Always use V2 Unified Endpoint if not overridden
  if (override) return override.replace(/\/$/, '');
  return 'https://api.etherscan.io/v2';
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const options = {
      hostname: opts.hostname,
      path: opts.pathname + (opts.search || ''),
      protocol: opts.protocol,
      method: 'GET',
      headers: headers || {},
    };

    if (process.env.PROXY_URL && HttpsProxyAgent) {
        options.agent = new HttpsProxyAgent(process.env.PROXY_URL);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error(`Invalid JSON from ${url}: ${e.message}`));
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.end();
  });
}

async function httpsGetWithRetry(url, maxAttempts = 3, headers) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await httpsGet(url, headers);
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) {
        const delayMs = 1500 * attempt;
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
    }
  }
  throw lastErr;
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('\"') || s.includes('\n')) {
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
  const address = (opts.address || '').trim();
  if (!address) throw new Error('--address is required');
  let apiKey = (opts.apikey || process.env.ETHERSCAN_API_KEY || '').trim();
  if (!apiKey) {
    // Fallback: read from local .env directly
    try {
      const envPath = path.join(__dirname, '..', '.env');
      if (fs.existsSync(envPath)) {
        const raw = fs.readFileSync(envPath, 'utf8');
        const m = raw.match(/^\s*ETHERSCAN_API_KEY\s*=\s*(.+)\s*$/m);
        if (m && m[1]) apiKey = m[1].trim();
      }
    } catch {}
  }
  if (!apiKey) throw new Error('ETHERSCAN_API_KEY must be set');
  const network = (opts.network || process.env.ETHERSCAN_NETWORK || 'mainnet').trim();
  const baseOverride = (process.env.ETHERSCAN_BASE || '').trim();
  const baseUrl = getBaseUrl(network, baseOverride);
  const chainId = getChainId(network);

  const startBlock = opts.start ? String(opts.start) : '0';
  const endBlock = opts.end && opts.end !== 'latest' ? String(opts.end) : '99999999';
  const sort = (opts.sort || 'asc').toLowerCase();
  // Single page size (max 10000 for Etherscan)
  const pageSize = 2000; 
  // Total limit desired
  const limit = Number(opts.limit || 10000);
  
  console.log(`Fetching up to ${limit} txs (Page Size: ${pageSize})...`);

  let allRows = [];
  let page = 1;
  let currentStartBlock = startBlock;

  while (allRows.length < limit) {
    // V2 Unified URL
    const url = `${baseUrl}/api?chainid=${chainId}&module=account&action=txlist&address=${address}&startblock=${currentStartBlock}&endblock=${endBlock}&sort=${sort}&offset=${pageSize}&page=${page}&apikey=${apiKey}`;
    const headers = undefined;
    
    console.log(`[Page ${page}] Fetching (Start Block: ${currentStartBlock})... ${url.replace(apiKey, '***')}`);

    try {
      const json = await httpsGetWithRetry(url, 3, headers);
      if (json.status !== '1' || !Array.isArray(json.result)) {
        if (json.message === 'No transactions found') {
           console.log('No more transactions found.');
           break;
        }
        
        // Handle 10k limit error specifically
        if (json.message && json.message.includes('Result window is too large')) {
             console.log('⚠️ Hit 10k limit. Advancing startBlock...');
             if (allRows.length > 0) {
                 const lastTx = allRows[allRows.length - 1];
                 const lastBlock = Number(lastTx.blockNumber);
                 if (!isNaN(lastBlock) && lastBlock > Number(currentStartBlock)) {
                     currentStartBlock = String(lastBlock + 1); // Advance block
                     page = 1; // Reset page
                     continue; // Retry with new block
                 }
             }
             console.warn(`Cannot advance cursor (Last Block: ${currentStartBlock}). Stopping.`);
             break;
        }

        console.warn(`Page ${page} failed: Etherscan error: status=${json.status} message=${json.message} result=${json.result}`);
        break;
      }

      const txs = json.result;
      console.log(`Page ${page}: Got ${txs.length} txs`);
      if (txs.length === 0) break;

      allRows.push(...txs);
      console.log(`  -> Got ${txs.length} txs. Total: ${allRows.length}`);

      if (allRows.length >= limit) break;
      
      // If we got a full page, check if we need to advance cursor proactively to avoid 10k limit
      // Etherscan limit is 10000 records. page * pageSize <= 10000.
      // If page * pageSize >= 10000, we must advance.
      if (page * pageSize >= 10000) {
          console.log('🔄 Approaching 10k limit. Advancing cursor...');
          const lastTx = txs[txs.length - 1];
          currentStartBlock = String(Number(lastTx.blockNumber) + 1);
          page = 1;
      } else {
          page++;
      }
      
      // Rate limit safety
      await new Promise((r) => setTimeout(r, 200));

    } catch (e) {
      console.error(`Page ${page} failed: ${e.message}`);
      break;
    }
  }

  // Slice to exact limit
  if (allRows.length > limit) {
    allRows = allRows.slice(0, limit);
  }

  // Post-process rows for output
  const outputRows = allRows.map((t) => ({
    txHash: t.hash,
    blockNumber: Number(t.blockNumber),
    timeStamp: Number(t.timeStamp),
    from: t.from,
    to: t.to,
    valueWei: t.value,
    gas: Number(t.gas),
    gasPrice: t.gasPrice,
    gasUsed: Number(t.gasUsed || 0),
    nonce: Number(t.nonce),
    input: t.input,
    methodId: t.methodId || (t.input ? t.input.slice(0, 10) : ''),
    status: t.isError === '1' ? 0 : 1, // Normalized status: 1=Success, 0=Fail
    isError: t.isError,
    contractAddress: t.contractAddress || '',
  }));

  if (!outputRows.length) {
    console.log('No transactions collected.');
    return;
  }

  // Save outputs
  const outDir = path.join(__dirname, '..', 'out');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, 'etherscan_failures.json');
  const csvPath = path.join(outDir, 'etherscan_failures.csv');

  console.log(`Saved ${outputRows.length} transactions ->`);
  console.log(` - ${jsonPath}`);
  console.log(` - ${csvPath}`);

  fs.writeFileSync(jsonPath, JSON.stringify(outputRows, null, 2));
  fs.writeFileSync(csvPath, toCsv(outputRows));
}

main().catch((err) => {
  console.error('fetch_etherscan failed:', err && err.message ? err.message : err);
  process.exit(1);
});