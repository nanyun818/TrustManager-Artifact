#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const ethers = require('ethers');

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'out');

const ERC20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

function parseArgs() {
  const args = process.argv.slice(2);
  const cfg = {
    rpc: process.env.PROVIDER_URL || process.env.RPC_URL || '',
    rpcPool: (process.env.RPC_POOL || '').split(',').map(s => s.trim()).filter(Boolean),
    tokens: (process.env.TARGET_TOKENS || '').split(',').map(s => s.trim()).filter(Boolean),
    fromBlock: undefined,
    toBlock: undefined,
    blocks: 10000,
    chunk: 3000,
    multi: false,
    outSuffix: ''
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--rpc') cfg.rpc = args[++i];
    else if (a === '--rpcPool') cfg.rpcPool = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--tokens') cfg.tokens = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--fromBlock') cfg.fromBlock = Number(args[++i]);
    else if (a === '--toBlock') cfg.toBlock = Number(args[++i]);
    else if (a === '--blocks') cfg.blocks = Number(args[++i]);
    else if (a === '--chunk') cfg.chunk = Number(args[++i]);
    else if (a === '--multi') cfg.multi = true;
    else if (a === '--outSuffix') cfg.outSuffix = args[++i];
  }
  const defaults = [
    '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
    '0x514910771AF9Ca656af840dff83E8264EcF986CA',
    '0x7Fc66500C84A76Ad7e9c93437bFc5Ac33E2DDaE9',
    '0xc00e94Cb662C3520282E6f5717214004A7f26888',
    '0x6B3595068778DD592e39A122f4f5a5Cf09C90fE2',
    '0x9f8F72aA9304c8B593d555F12ef6589cC3A579A2'
  ];
  if (!cfg.tokens.length) cfg.tokens = defaults;
  if (!cfg.rpc && (!cfg.rpcPool || cfg.rpcPool.length === 0)) throw new Error('Missing RPC, set PROVIDER_URL/RPC_URL or use --rpc/--rpcPool');
  return cfg;
}

async function getBlockRange(provider, cfg) {
  const latest = await provider.getBlockNumber();
  const toBlock = cfg.toBlock || latest;
  const fromBlock = cfg.fromBlock || Math.max(0, toBlock - (cfg.blocks || 10000));
  return { fromBlock, toBlock };
}

async function fetchTokenMeta(provider, token) {
  const c = new ethers.Contract(token, ERC20_ABI, provider);
  let symbol = token.slice(0, 6);
  let decimals = 18;
  try { symbol = await c.symbol(); } catch {}
  try { decimals = await c.decimals(); } catch {}
  return { symbol, decimals };
}

function bnToStr(v) { return (typeof v === 'bigint') ? v.toString() : String(v); }
function formatHuman(vStr, decimals) {
  try {
    const v = BigInt(vStr);
    const base = BigInt(10) ** BigInt(decimals);
    const q = v / base;
    const r = v % base;
    const rStr = r.toString().padStart(decimals, '0').replace(/0+$/, '');
    return rStr.length ? `${q}.${rStr}` : q.toString();
  } catch { return '0'; }
}

async function fetchLogs(provider, token, range, chunk) {
  const iface = new ethers.utils.Interface(ERC20_ABI);
  const topic0 = ethers.utils.id('Transfer(address,address,uint256)');
  const out = [];
  for (let start = range.fromBlock; start <= range.toBlock; start += chunk + 1) {
    const fromBlock = start;
    const toBlock = Math.min(range.toBlock, start + chunk);
    const filter = { address: token, topics: [topic0], fromBlock, toBlock };
    const logs = await provider.getLogs(filter);
    for (const log of logs) {
      let parsed;
      try { parsed = iface.parseLog(log); } catch { continue; }
      const from = parsed.args.from.toLowerCase();
      const to = parsed.args.to.toLowerCase();
      const value = bnToStr(parsed.args.value);
      out.push({
        tokenAddress: token.toLowerCase(),
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        from,
        to,
        value
      });
    }
    process.stdout.write(`Fetched ${logs.length} logs for ${token} [${fromBlock}-${toBlock}]\r`);
  }
  process.stdout.write('\n');
  return out;
}

async function attachTimestamps(provider, records) {
  const byBlock = new Map();
  for (const r of records) byBlock.set(r.blockNumber, 0);
  const unique = Array.from(byBlock.keys());
  const cache = new Map();
  for (const b of unique) {
    const blk = await provider.getBlock(b);
    cache.set(b, blk.timestamp);
  }
  for (const r of records) r.timestamp = cache.get(r.blockNumber) || 0;
}

function writeOutputs(all, metaByToken, suffix = '') {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const jsonPath = path.join(OUT, `transfers${suffix ? '_' + suffix : ''}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(all, null, 2));
  const headers = ['tokenAddress','tokenSymbol','decimals','from','to','value','valueHuman','blockNumber','timestamp','txHash','logIndex'];
  const rows = [headers.join(',')];
  for (const r of all) {
    const meta = metaByToken[r.tokenAddress] || { symbol: r.tokenAddress.slice(0,6), decimals: 18 };
    const valueHuman = formatHuman(r.value, meta.decimals);
    rows.push([
      r.tokenAddress,
      meta.symbol,
      meta.decimals,
      r.from,
      r.to,
      r.value,
      valueHuman,
      r.blockNumber,
      r.timestamp || '',
      r.txHash,
      r.logIndex
    ].join(','));
  }
  const csvPath = path.join(OUT, `transfers${suffix ? '_' + suffix : ''}.csv`);
  fs.writeFileSync(csvPath, rows.join('\n'));
  console.log(`Wrote: ${csvPath} and ${jsonPath}`);
}

async function pickProvider(cfg) {
  const list = (cfg.rpcPool || []).concat(cfg.rpc ? [cfg.rpc] : []);
  for (const endpoint of list) {
    try {
      const p = new ethers.providers.JsonRpcProvider(endpoint);
      await p.getBlockNumber();
      return { provider: p, rpc: endpoint };
    } catch (_) { continue; }
  }
  const p = new ethers.providers.JsonRpcProvider(cfg.rpc);
  await p.getBlockNumber();
  return { provider: p, rpc: cfg.rpc };
}

async function pickAllProviders(cfg) {
  const out = [];
  const list = (cfg.rpcPool || []).concat(cfg.rpc ? [cfg.rpc] : []);
  for (const endpoint of list) {
    try {
      const p = new ethers.providers.JsonRpcProvider(endpoint);
      await p.getBlockNumber();
      out.push({ provider: p, rpc: endpoint });
    } catch (_) { /* skip */ }
  }
  if (!out.length && cfg.rpc) {
    const p = new ethers.providers.JsonRpcProvider(cfg.rpc);
    await p.getBlockNumber();
    out.push({ provider: p, rpc: cfg.rpc });
  }
  return out;
}

async function main() {
  const cfg = parseArgs();
  const sources = [];
  if (!cfg.tokens.length) { console.error('No tokens'); process.exit(1); }
  const all = [];
  const metaByToken = {};

  if (cfg.multi || (cfg.rpcPool && cfg.rpcPool.length > 1)) {
    const providers = await pickAllProviders(cfg);
    for (const { provider, rpc } of providers) {
      const { fromBlock, toBlock } = await getBlockRange(provider, cfg);
      const range = { fromBlock, toBlock };
      let recsBefore = all.length;
      for (const token of cfg.tokens) {
        const meta = await fetchTokenMeta(provider, token);
        if (!metaByToken[token.toLowerCase()]) metaByToken[token.toLowerCase()] = meta;
        const logs = await fetchLogs(provider, token, range, cfg.chunk);
        all.push(...logs);
      }
      try { await attachTimestamps(provider, all.slice(recsBefore)); } catch (e) { console.warn('attachTimestamps failed for source', rpc, e && e.message); }
      sources.push({ rpc, fromBlock, toBlock, tokens: cfg.tokens.length, records: all.length - recsBefore });
      process.stdout.write(`Source done rpc=${rpc} records=${all.length - recsBefore}\n`);
    }
  } else {
    const { provider, rpc } = await pickProvider(cfg);
    const { fromBlock, toBlock } = await getBlockRange(provider, cfg);
    const range = { fromBlock, toBlock };
    for (const token of cfg.tokens) {
      const meta = await fetchTokenMeta(provider, token);
      metaByToken[token.toLowerCase()] = meta;
      const logs = await fetchLogs(provider, token, range, cfg.chunk);
      all.push(...logs);
    }
    try { await attachTimestamps(provider, all); } catch (e) { console.warn('attachTimestamps failed', e && e.message); }
    sources.push({ rpc, fromBlock, toBlock, tokens: cfg.tokens.length, records: all.length });
  }

  writeOutputs(all, metaByToken, cfg.outSuffix || '');
  try {
    const extra = { sources };
    fs.writeFileSync(path.join(OUT, 'transfers_sources.json'), JSON.stringify(extra, null, 2));
  } catch {}
  const summary = sources.map(s => `${s.rpc}[${s.fromBlock}-${s.toBlock}] recs=${s.records}`).join(' ; ');
  process.stdout.write(`SOURCES: ${summary}\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
