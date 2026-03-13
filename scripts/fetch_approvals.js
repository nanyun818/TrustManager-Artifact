#!/usr/bin/env node
/**
 * Batch fetch ERC20 Approval logs for tokens and spender targets.
 * - Supports RPC (ETH_RPC_URL) via eth_getLogs for broad filtering (topics only)
 * - Fallback to Etherscan (ETHERSCAN_API_KEY) for per-token queries
 * - Outputs per-target JSON and CSV with raw fields preserved and flags for anomalies
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f714f8f1a80b9d9558b6b7f9a6c9f3fa6f2f9f5b5c20f'; // keccak256(Approval(address,address,uint256))

const SAFE_SPENDERS = new Set([
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', // Uniswap V2
  '0xe592427a0aece92dee3dee1f18e0157c05861564', // Uniswap V3
  '0xdef1c0ded9bec7f1a1670819833240f027b25eff', // 0x
  '0x00000000006c3852cbef3e08e8df289169ede581', // Seaport
  '0x7d2768de32b0b80b7a3454c06bdac7569008b0c0', // Aave v2
  '0xa5407eae9ba414226955e420dabb33ad20efyetb', // Curve pool (note: verify address typo?)
  '0xba12222222228d8ba445958a75a0704d566bf2c8', // Balancer Vault
  '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f', // Sushi router
]);

const KNOWN_TOKEN_DECIMALS = {
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 6, // USDT
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6, // USDC
  '0x6b175474e89094c44da98b954eedeac495271d0f': 18, // DAI
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 18, // WETH
};

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--start') opts.start = parseInt(args[++i], 10);
    else if (a === '--end') opts.end = parseInt(args[++i], 10);
    else if (a === '--window') opts.window = parseInt(args[++i], 10);
    else if (a === '--targets') opts.targetsPath = args[++i];
  }
  opts.start ||= parseInt(process.env.START_BLOCK || '14000000', 10);
  opts.end ||= parseInt(process.env.END_BLOCK || '18500000', 10);
  opts.window ||= parseInt(process.env.BLOCK_WINDOW_SIZE || '20000', 10);
  opts.targetsPath ||= path.join(__dirname, 'approval_targets.json');
  return opts;
}

function loadTargets(targetsPath) {
  const raw = fs.readFileSync(targetsPath, 'utf-8');
  const json = JSON.parse(raw);
  return json.targets.map(t => ({
    label: t.label,
    address: t.address.toLowerCase(),
    type: t.type,
  }));
}

function toPaddedTopicAddress(addr) {
  return '0x' + addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

function ensureOutDir() {
  const outDir = path.join(process.cwd(), 'out');
  fs.mkdirSync(outDir, { recursive: true });
  return outDir;
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function writeCSV(filePath, rows) {
  if (!rows.length) {
    fs.writeFileSync(filePath, '');
    return;
  }
  const header = Object.keys(rows[0]);
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map(k => csvEscape(r[k])).join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
}

async function rpcCall(url, method, params) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params });
    const u = new URL(url);
    const req = https.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.error) return reject(new Error(json.error.message || 'RPC error'));
          resolve(json.result);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.setTimeout(15000, () => {
      req.destroy(new Error('RPC timeout'));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function rpcGetLogs(providerUrl, filter) {
  const result = await rpcCall(providerUrl, 'eth_getLogs', [filter]);
  return result;
}

async function rpcGetDecimals(providerUrl, token) {
  try {
    const data = '0x313ce567'; // decimals()
    const res = await rpcCall(providerUrl, 'eth_call', [{ to: token, data }, 'latest']);
    if (typeof res === 'string' && res.startsWith('0x') && res.length >= 66) {
      return parseInt(res, 16);
    }
  } catch (_) {}
  return KNOWN_TOKEN_DECIMALS[token.toLowerCase()] || 18;
}

function etherscanGetLogs(apikey, params) {
  const q = new URLSearchParams({ module: 'logs', action: 'getLogs', ...params });
  if (apikey) q.set('apikey', apikey);
  const url = `https://api.etherscan.io/api?${q.toString()}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.status === '1' && Array.isArray(json.result)) return resolve(json.result);
          if (json.status === '0' && json.result === 'No records found') return resolve([]);
          reject(new Error(json.message || 'Etherscan error'));
        } catch (e) { reject(e); }
      });
    });
    req.setTimeout(15000, () => {
      req.destroy(new Error('Etherscan timeout'));
    });
    req.on('error', reject);
  });
}

function hexToBigInt(hex) {
  try { return BigInt(hex); } catch (_) { return 0n; }
}

function decodeApprovalLog(log) {
  const owner = '0x' + log.topics[1].slice(26);
  const spender = '0x' + log.topics[2].slice(26);
  const value = hexToBigInt(log.data);
  return { owner: owner.toLowerCase(), spender: spender.toLowerCase(), value };
}

function computeFlags(entry, decimals) {
  const maxUint = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  const unlimited = entry.value === maxUint;
  const thresholdTokens = 1_000_000; // 1M tokens
  const threshold = BigInt(thresholdTokens) * BigInt(10) ** BigInt(decimals || 18);
  const large = entry.value >= threshold && !unlimited;
  const unusualSpender = !SAFE_SPENDERS.has(entry.spender);
  return { unlimited, large, unusualSpender };
}

function toCsvRow(label, target, log, dec, entry, flags, extraFlags) {
  return {
    label,
    target_address: target.address,
    target_type: target.type,
    log_address: log.address.toLowerCase(),
    blockNumber: parseInt(log.blockNumber, 16),
    transactionHash: log.transactionHash,
    logIndex: parseInt(log.logIndex, 16),
    owner: entry.owner,
    spender: entry.spender,
    value: entry.value.toString(),
    decimals: dec,
    valueHuman: (Number(entry.value) / Math.pow(10, dec)).toString(),
    unlimited: flags.unlimited ? 1 : 0,
    large: flags.large ? 1 : 0,
    unusualSpender: flags.unusualSpender ? 1 : 0,
    repeated: extraFlags.repeated ? 1 : 0,
    shortInterval: extraFlags.shortInterval ? 1 : 0,
  };
}

async function fetchForTokenRPC(providerUrl, token, start, end, window) {
  const decimals = await rpcGetDecimals(providerUrl, token);
  const rows = [];
  const seen = new Map(); // key: owner|spender => lastBlock
  for (let from = start; from <= end; from += window + 1) {
    let to = Math.min(from + window, end);
    let logs = [];
    try {
      const filter = {
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + to.toString(16),
        address: token,
        topics: [APPROVAL_TOPIC],
      };
      logs = await rpcGetLogs(providerUrl, filter);
    } catch (e) {
      const msg = String(e && e.message || e || '');
      if (msg.includes('10 block range')) {
        // 降低窗口到最多10区块（包含端点时需 end-start<=9）并重试一次
        to = Math.min(from + 9, end);
        const filter2 = {
          fromBlock: '0x' + from.toString(16),
          toBlock: '0x' + to.toString(16),
          address: token,
          topics: [APPROVAL_TOPIC],
        };
        try { logs = await rpcGetLogs(providerUrl, filter2); }
        catch (e2) { console.error('RPC重试仍失败:', e2.message || e2); logs = []; }
      } else {
        console.error('RPC查询失败:', msg);
        logs = [];
      }
    }
    for (const log of logs) {
      if (!Array.isArray(log.topics) || log.topics.length < 3) continue;
      const entry = decodeApprovalLog(log);
      const flags = computeFlags(entry, decimals);
      const key = `${entry.owner}|${entry.spender}`;
      const block = parseInt(log.blockNumber, 16);
      const last = seen.get(key);
      const extra = {
        repeated: last !== undefined,
        shortInterval: last !== undefined && (block - last) <= 100, // ~100 blocks ~ < 30 min, heuristic
      };
      seen.set(key, block);
      rows.push({ log, entry, flags, extra, decimals });
    }
    process.stdout.write(`Token ${token} ${from}-${to}: logs=${logs.length}\n`);
  }
  return rows;
}

async function fetchForSpenderRPC(providerUrl, spender, start, end, window) {
  const rows = [];
  const seen = new Map();
  for (let from = start; from <= end; from += window + 1) {
    let to = Math.min(from + window, end);
    let logs = [];
    try {
      const filter = {
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + to.toString(16),
        topics: [APPROVAL_TOPIC, null, toPaddedTopicAddress(spender)],
      };
      logs = await rpcGetLogs(providerUrl, filter);
    } catch (e) {
      const msg = String(e && e.message || e || '');
      if (msg.includes('10 block range')) {
        to = Math.min(from + 9, end);
        const filter2 = {
          fromBlock: '0x' + from.toString(16),
          toBlock: '0x' + to.toString(16),
          topics: [APPROVAL_TOPIC, null, toPaddedTopicAddress(spender)],
        };
        try { logs = await rpcGetLogs(providerUrl, filter2); }
        catch (e2) { console.error('RPC重试仍失败:', e2.message || e2); logs = []; }
      } else {
        console.error('RPC查询失败:', msg);
        logs = [];
      }
    }
    for (const log of logs) {
      if (!Array.isArray(log.topics) || log.topics.length < 3) continue;
      const token = log.address.toLowerCase();
      const decimals = KNOWN_TOKEN_DECIMALS[token] || 18;
      const entry = decodeApprovalLog(log);
      const flags = computeFlags(entry, decimals);
      const key = `${entry.owner}|${entry.spender}`;
      const block = parseInt(log.blockNumber, 16);
      const last = seen.get(key);
      const extra = {
        repeated: last !== undefined,
        shortInterval: last !== undefined && (block - last) <= 100,
      };
      seen.set(key, block);
      rows.push({ log, entry, flags, extra, decimals });
    }
    process.stdout.write(`Spender ${spender} ${from}-${to}: logs=${logs.length}\n`);
  }
  return rows;
}

async function fetchForTokenEtherscan(apikey, token, start, end, window) {
  const decimals = KNOWN_TOKEN_DECIMALS[token] || 18;
  const rows = [];
  const seen = new Map();
  for (let from = start; from <= end; from += window + 1) {
    const to = Math.min(from + window, end);
    let logs = [];
    // 简单重试机制以提高抗临时网络波动能力
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        logs = await etherscanGetLogs(apikey, {
          fromBlock: from.toString(),
          toBlock: to.toString(),
          address: token,
          topic0: APPROVAL_TOPIC,
        });
        break;
      } catch (e) {
        const msg = e && e.message || String(e);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1500 * attempt));
          continue;
        }
        console.error(`Etherscan查询失败(${attempt}):`, msg);
        logs = [];
      }
    }
    for (const log of logs) {
      const entry = decodeApprovalLog(log);
      const flags = computeFlags(entry, decimals);
      const key = `${entry.owner}|${entry.spender}`;
      const block = parseInt(log.blockNumber, 16);
      const last = seen.get(key);
      const extra = {
        repeated: last !== undefined,
        shortInterval: last !== undefined && (block - last) <= 100,
      };
      seen.set(key, block);
      rows.push({ log, entry, flags, extra, decimals });
    }
    process.stdout.write(`Token ${token} ${from}-${to}: logs=${logs.length}\n`);
  }
  return rows;
}

async function main() {
  const opts = parseArgs();
  const targets = loadTargets(opts.targetsPath);
  const outDir = ensureOutDir();
  const providerUrl = process.env.ETH_RPC_URL || '';
  const etherscanKey = process.env.ETHERSCAN_API_KEY || '';
  const useRPC = Boolean(providerUrl);
  const useEtherscan = !useRPC && Boolean(etherscanKey);

  if (!useRPC && !useEtherscan) {
    console.error('缺少网络配置：请设置 ETH_RPC_URL（推荐）或 ETHERSCAN_API_KEY 执行真实抓取。');
    process.exit(1);
  }

  const summary = [];

  for (const target of targets) {
    let rows = [];
    try {
      if (useRPC) {
        if (target.type === 'token') {
          rows = await fetchForTokenRPC(providerUrl, target.address, opts.start, opts.end, opts.window);
        } else {
          rows = await fetchForSpenderRPC(providerUrl, target.address, opts.start, opts.end, opts.window);
        }
      } else if (useEtherscan) {
        if (target.type === 'token') {
          rows = await fetchForTokenEtherscan(etherscanKey, target.address, opts.start, opts.end, opts.window);
        } else {
          // Etherscan 不支持无 address 跨合约按 spender 过滤；退化为常见代币遍历
          const commonTokens = [
            '0xdac17f958d2ee523a2206206994597c13d831ec7',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0x6b175474e89094c44da98b954eedeac495271d0f',
            '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          ];
          for (const token of commonTokens) {
            const part = await fetchForTokenEtherscan(etherscanKey, token, opts.start, opts.end, opts.window);
            rows.push(...part.filter(r => r.entry.spender === target.address));
          }
        }
      }
    } catch (e) {
      console.error(`抓取目标 ${target.label} 失败:`, e.message || e);
    }

    const csvRows = rows.map(r => toCsvRow(target.label, target, r.log, r.decimals, r.entry, r.flags, r.extra));
    const jsonOut = rows.map(r => ({
      label: target.label,
      target,
      raw: r.log,
      decoded: r.entry,
      flags: { ...r.flags, ...r.extra },
      decimals: r.decimals,
    }));

    const jsonPath = path.join(outDir, `approvals_${target.label}.json`);
    const csvPath = path.join(outDir, `approvals_${target.label}.csv`);
    fs.writeFileSync(jsonPath, JSON.stringify(jsonOut, null, 2), 'utf-8');
    writeCSV(csvPath, csvRows);

    const stat = {
      label: target.label,
      count: rows.length,
      unlimited: rows.filter(r => r.flags.unlimited).length,
      large: rows.filter(r => r.flags.large).length,
      repeated: rows.filter(r => r.extra.repeated).length,
      shortInterval: rows.filter(r => r.extra.shortInterval).length,
      unusualSpender: rows.filter(r => r.flags.unusualSpender).length,
    };
    summary.push(stat);
    console.log(`完成 ${target.label}: 总计 ${stat.count}, unlimited ${stat.unlimited}, large ${stat.large}, repeated ${stat.repeated}`);
  }

  const summaryPath = path.join(outDir, 'approvals_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log('摘要输出:', summaryPath);
}

main().catch((e) => {
  console.error('执行失败:', e);
  process.exit(1);
});