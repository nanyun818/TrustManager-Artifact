#!/usr/bin/env node
/**
 * Backfill Balancer Vault/Pool events for a given block range on any EVM chain.
 * - Reads addresses from forta-bot/config.json (balancer.<network>.vaults/pools) or CLI flags
 * - Uses eth_getLogs with windowing and retries for rate-limited providers
 * - Exports JSON and CSV to out/balancer_backfill.* for quick verification
 *
 * Usage examples:
 *   node scripts/backfill_balancer_logs.js --rpc https://arb1.arbitrum.io/rpc --network arbitrum --start 180000000 --end latest
 *   node scripts/backfill_balancer_logs.js --rpc <url> --network arbitrum --window 5000
 *   node scripts/backfill_balancer_logs.js --rpc <url> --vault 0xBA12222222228d8Ba445958a75a0704d566BF2C8 --pool 0x32296969ef14eb0c6d29669c550d4a0449130230
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

function parseArgs() {
  const argv = process.argv.slice(2);
  const opts = { vaults: [], pools: [], onlyPools: [], outSuffix: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rpc') opts.rpc = argv[++i];
    else if (a === '--start') opts.start = argv[++i];
    else if (a === '--end') opts.end = argv[++i];
    else if (a === '--window') opts.window = parseInt(argv[++i], 10);
    else if (a === '--network') opts.network = String(argv[++i]).toLowerCase();
    else if (a === '--config') opts.config = argv[++i];
    else if (a === '--vault') opts.vaults.push(argv[++i]);
    else if (a === '--pool') opts.pools.push(argv[++i]);
    else if (a === '--topics') opts.topics = String(argv[++i]).toLowerCase();
    else if (a === '--onlyPool') opts.onlyPools.push(String(argv[++i]).toLowerCase());
    else if (a === '--outSuffix') opts.outSuffix = String(argv[++i]);
  }
  opts.window ||= parseInt(process.env.BLOCK_WINDOW_SIZE || '5000', 10);
  opts.network ||= (process.env.NETWORK || 'arbitrum').toLowerCase();
  opts.config ||= path.join(process.cwd(), 'forta-bot', 'config.json');
  return opts;
}

function ensureOutDir() {
  const outDir = path.join(process.cwd(), 'out');
  fs.mkdirSync(outDir, { recursive: true });
  return outDir;
}

async function rpcCall(rpc, method, params) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params });
    const u = new URL(rpc);
    const req = https.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.error) return reject(new Error(json.error.message || 'RPC error'));
          resolve(json.result);
        } catch (e) { reject(e); }
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('RPC timeout')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function hexToNum(h) {
  if (typeof h === 'number') return h;
  try { return parseInt(String(h), 16); } catch (_) { return 0; }
}

function stripJsonComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\/\/.*$/gm, ''); // line comments (anywhere in line)
}

function loadAddressesFromConfig(configPath, network) {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const cfg = JSON.parse(stripJsonComments(raw));
    const s = (((cfg || {}).balancer || {})[network]) || { vaults: [], pools: [] };
    const vaults = (s.vaults || []).map((x) => String(x).toLowerCase());
    const pools = (s.pools || []).map((x) => String(x).toLowerCase());
    return { vaults, pools };
  } catch (e) {
    return { vaults: [], pools: [] };
  }
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
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(','));
  return lines.join('\n');
}

async function getLatestBlock(rpc) {
  const hex = await rpcCall(rpc, 'eth_blockNumber', []);
  return hexToNum(hex);
}

async function getLogs(rpc, filter) {
  try {
    return await rpcCall(rpc, 'eth_getLogs', [filter]);
  } catch (e) {
    const msg = String(e && e.message || e || '');
    if (msg.includes('block range is too wide') || msg.includes('10 block range')) {
      throw new Error('RANGE_LIMIT');
    }
    throw e;
  }
}

function topicIds() {
  const ethers = require('ethers');
  return {
    TRANSFER: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    SWAP: ethers.utils.id('Swap(bytes32,address,address,uint256,uint256)'),
    POOL_BALANCE_CHANGED: ethers.utils.id('PoolBalanceChanged(bytes32,address[],int256[],int256[])'),
  };
}

async function backfill(opts) {
  const rpc = opts.rpc || process.env.ETH_RPC_URL || process.env.RPC_URL;
  if (!rpc) throw new Error('缺少 --rpc 或 ETH_RPC_URL');
  const outDir = ensureOutDir();
  const latest = await getLatestBlock(rpc);
  const start = String(opts.start || Math.max(0, latest - 20000));
  const endStr = String(opts.end || latest);
  const end = endStr === 'latest' ? latest : Number(endStr);
  const window = Number(opts.window || 5000);

  // Addresses
  const fromCfg = loadAddressesFromConfig(opts.config, opts.network);
  let vaults = fromCfg.vaults.concat((opts.vaults || [])).map((x) => String(x).toLowerCase());
  let pools = fromCfg.pools.concat((opts.pools || [])).map((x) => String(x).toLowerCase());
  vaults = Array.from(new Set(vaults.filter(Boolean)));
  pools = Array.from(new Set(pools.filter(Boolean)));
  if (vaults.length === 0 && pools.length === 0) throw new Error('未找到任何 Vault/Pool 地址');

  const topics = topicIds();
  const useTopic = (opts.topics || 'all');
  const want = [];
  if (useTopic === 'all' || useTopic.includes('transfer')) want.push(topics.TRANSFER);
  if (useTopic === 'all' || useTopic.includes('swap')) want.push(String(topics.SWAP).toLowerCase());
  if (useTopic === 'all' || useTopic.includes('balance')) want.push(String(topics.POOL_BALANCE_CHANGED).toLowerCase());

  const rows = [];
  const addresses = vaults.concat(pools);
  for (const addr of addresses) {
    for (const t0 of want) {
      for (let from = Number(start); from <= end; from += (window + 1)) {
        let to = Math.min(from + window, end);
        const filter = {
          fromBlock: '0x' + from.toString(16),
          toBlock: '0x' + to.toString(16),
          address: addr,
          topics: [t0],
        };
        let logs = [];
        try {
          logs = await getLogs(rpc, filter);
        } catch (e) {
          if (String(e.message || '').includes('RANGE_LIMIT')) {
            to = Math.min(from + 9, end);
            const filter2 = { ...filter, toBlock: '0x' + to.toString(16) };
            try { logs = await getLogs(rpc, filter2); }
            catch (e2) { logs = []; }
          } else {
            logs = [];
          }
        }
        for (const lg of logs) {
          const topic0Str = String(lg.topics && lg.topics[0] || '').toLowerCase();
          const topic1 = String(lg.topics && lg.topics[1] || '');
          let poolAddressFromId = '';
          if (topic1 && topic1.startsWith('0x') && topic1.length === 66) {
            // poolId encodes pool address in the FIRST 20 bytes of the 32-byte value.
            poolAddressFromId = '0x' + topic1.slice(2, 42);
            poolAddressFromId = poolAddressFromId.toLowerCase();
          }
          const row = {
            address: String(lg.address).toLowerCase(),
            blockNumber: hexToNum(lg.blockNumber),
            transactionHash: lg.transactionHash,
            topic0: topic0Str,
            poolId: topic1,
            poolAddress: poolAddressFromId,
          };
          if (opts.onlyPools.length > 0) {
            // When filtering by pool, include only Vault events whose poolAddress matches target list.
            const isVaultEvent = row.address === addr; // addr is vault currently in loop
            const matchPool = poolAddressFromId && opts.onlyPools.includes(poolAddressFromId);
            if (isVaultEvent && matchPool) rows.push(row);
            else if (!isVaultEvent) rows.push(row); // Non-vault address (e.g., direct pool logs)
          } else {
            rows.push(row);
          }
        }
        process.stdout.write(`addr ${addr} topic ${t0.slice(0,10)} ${from}-${to} logs=${logs.length}\n`);
      }
    }
  }

  const baseName = 'balancer_backfill' + (opts.outSuffix ? '_' + opts.outSuffix : '');
  const jsonPath = path.join(outDir, baseName + '.json');
  const csvPath = path.join(outDir, baseName + '.csv');
  fs.writeFileSync(jsonPath, JSON.stringify({ network: opts.network, count: rows.length, rows }, null, 2), 'utf-8');
  fs.writeFileSync(csvPath, toCsv(rows), 'utf-8');
  return { jsonPath, csvPath, count: rows.length };
}

async function main() {
  const opts = parseArgs();
  try {
    const { jsonPath, csvPath, count } = await backfill(opts);
    console.log(`Saved ${count} logs ->`);
    console.log(' -', jsonPath);
    console.log(' -', csvPath);
  } catch (e) {
    console.error('backfill_balancer_logs failed:', e.message || e);
    process.exit(1);
  }
}

main();