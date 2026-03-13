// Off-chain fast-response bot: watches contract activity and reacts quickly
// Goals:
// - Detect rapid anomaly patterns (failed contract calls) per node address
// - Immediately push down trust via metrics update and/or negative recommendation
// - Observe NodeBlacklisted events to confirm quarantine
// - (Extended) Watch ERC20 Approval and Balancer activity for real-time alerts
//
// Usage:
// 1) Configure .env with PROVIDER_URL, CONTRACT_ADDRESS, PRIVATE_KEY (owner or hot wallet)
// 2) Optional env: FAIL_THRESHOLD=3, WINDOW_SEC=20, COOLDOWN_SEC=60, DRY_RUN=0/1
// 3) npm install --save ethers@5 dotenv
// 4) node scripts/bot_fast_response.js --rpc <url> --rpcFallback <url> --scoreThreshold 0.8 --whitelistMultiplier 0.5 --enableBalancer 1

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { ethers } = require('ethers');

const APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f714f8f4f5f3c6ab5a1fc'; // keccak("Approval(address,address,uint256)")

const ROOT = __dirname ? path.resolve(__dirname, '..') : process.cwd();

function log(msg, obj) {
  if (obj !== undefined) console.log(msg, obj);
  else console.log(msg);
}

function loadConfig() {
  const cfgPath = path.join(ROOT, 'forta-bot', 'config.json');
  let cfg = {};
  try {
    let raw = fs.readFileSync(cfgPath, 'utf8');
    raw = raw.replace(/^[\uFEFF]/, ''); // strip BOM
    // Remove /* */ comments
    raw = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    // Remove // comments at end of line
    raw = raw.split(/\r?\n/).map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
    // Remove trailing commas before } or ]
    raw = raw.replace(/,\s*(\]|\})/g, '$1');
    cfg = JSON.parse(raw);
  } catch (e) {
    log('[warn] loadConfig failed:', e && e.message ? e.message : e);
  }
  return cfg;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const kv = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.replace(/^--/, '');
      const val = (i + 1 < args.length && !args[i + 1].startsWith('--')) ? args[i + 1] : '1';
      kv[key] = val;
      if (val !== '1') i++;
    }
  }
  return kv;
}

function isUnlimited(amountHex) {
  try {
    const clean = (amountHex || '').toLowerCase();
    if (!clean.startsWith('0x')) return false;
    // 2^256-1
    return clean === '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  } catch (_) { return false; }
}

function computeScore({ unlimited, shortRepeat, unusualSpender }, { whitelist, multiplier, base = 0 }) {
  let score = base;
  if (unlimited) score += 0.6;
  if (shortRepeat) score += 0.2;
  if (unusualSpender) score += 0.4;
  if (whitelist) score = score * (multiplier || 1);
  return Math.max(0, Math.min(1, score));
}

function writeAlert(outPath, finding) {
  try {
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const prev = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : { alerts: [] };
    prev.alerts.push(finding);
    fs.writeFileSync(outPath, JSON.stringify(prev, null, 2));
  } catch (e) {
    log('[warn] writeAlert failed:', e && e.message ? e.message : e);
  }
}

function addrEq(a, b) { return String(a || '').toLowerCase() === String(b || '').toLowerCase(); }

function startApprovalWatch(provider, cfg) {
  const shortBlocks = Number(cfg.short_interval_blocks || 30);
  const knownSafe = new Set((cfg.known_safe_spenders || []).map((x) => String(x).toLowerCase()));
  const stablecoins = new Set((cfg.stablecoins || []).map((x) => String(x).toLowerCase()));
  const scoreThreshold = Number(cfg.score_threshold || 0.8);
  const wlMultiplier = Number(cfg.whitelist_score_multiplier || 1);
  const outPath = path.join(ROOT, 'out', 'forta_alerts_live.json');

  // recent approvals: (owner, spender, token) -> lastBlock, count
  const recent = new Map();

  function keyOf(owner, spender, token) {
    return `${String(owner).toLowerCase()}|${String(spender).toLowerCase()}|${String(token).toLowerCase()}`;
  }

  function onApprovalLog(log) {
    try {
      const topics = log.topics || [];
      if (topics.length < 3) return;
      if (String(topics[0]).toLowerCase() !== APPROVAL_TOPIC) return;
      const owner = ethers.utils.getAddress('0x' + topics[1].slice(26));
      const spender = ethers.utils.getAddress('0x' + topics[2].slice(26));
      const token = ethers.utils.getAddress(log.address);
      const amountHex = (typeof log.data === 'string') ? log.data.toLowerCase() : (log.data.hex || '').toLowerCase();
      const blockNumber = (typeof log.blockNumber === 'number') ? log.blockNumber : parseInt(log.blockNumber || '0');

      const unlimited = isUnlimited(amountHex);
      const k = keyOf(owner, spender, token);
      const prev = recent.get(k) || { last: undefined, count: 0 };
      let shortRepeat = false;
      if (prev.last === undefined || (blockNumber - prev.last) > shortBlocks) {
        recent.set(k, { last: blockNumber, count: 1 });
        shortRepeat = false;
      } else {
        recent.set(k, { last: blockNumber, count: (prev.count || 0) + 1 });
        shortRepeat = true;
      }
      const unusualSpender = !knownSafe.has(String(spender).toLowerCase());
      const inStableScope = stablecoins.has(String(token).toLowerCase());

      if (!inStableScope) return; // limit scope to known stables for performance
      const finalScore = computeScore({ unlimited, shortRepeat, unusualSpender }, { whitelist: !unusualSpender, multiplier: wlMultiplier });
      if (finalScore >= scoreThreshold) {
        const finding = {
          name: 'ERC20 Approval Risk',
          description: `Approval risk score=${finalScore.toFixed(2)} unlimited=${unlimited} shortRepeat=${shortRepeat} unusual=${unusualSpender}`,
          alert_id: 'FAST-APPROVAL-RISK',
          severity: finalScore >= 0.9 ? 'High' : 'Medium',
          type: 'Suspicious',
          metadata: {
            owner, spender, token,
            block: String(blockNumber),
            amount_hex: amountHex,
            score: finalScore.toFixed(2),
            level: finalScore >= 0.9 ? 'high' : 'medium',
            signals: [unlimited ? 'unlimited' : null, shortRepeat ? 'shortRepeat' : null, unusualSpender ? 'unknown' : 'safe']
              .filter(Boolean).join(',')
          }
        };
        log('[alert] approval:', finding);
        writeAlert(outPath, finding);
      }
    } catch (e) {
      log('[warn] onApprovalLog failed:', e && e.message ? e.message : e);
    }
  }

  // Fallback: subscribe to all logs and filter in handler (provider topic validation is flaky on some L2s)
  provider.on('logs', onApprovalLog);
  log('[watch] Approval (global logs subscription)');
}

function startBalancerWatch(provider, cfg) {
  if (!cfg.enable_balancer) { log('[balancer] disabled'); return; }
  const chain = (cfg.network || '').toLowerCase();
  const bal = (cfg.balancer || {});
  const set = (bal[chain] || { vaults: [], pools: [] });
  const vaults = (set.vaults || []).map((x) => String(x).toLowerCase());
  const pools = (set.pools || []).map((x) => String(x).toLowerCase());
  if (vaults.length === 0 && pools.length === 0) {
    log('[balancer] no addresses configured; awaiting config update');
    return;
  }

  const outPath = path.join(ROOT, 'out', 'balancer_alerts_live.json');
  const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const SWAP_TOPIC = ethers.utils.id('Swap(bytes32,address,address,int256,int256,uint256)');
  const POOL_BALANCE_CHANGED_TOPIC = ethers.utils.id('PoolBalanceChanged(bytes32,address[],int256[],int256[])');

  function onBalancerLog(log) {
    try {
      const addr = String(log.address).toLowerCase();
      const isVault = vaults.includes(addr);
      const isPool = pools.includes(addr);
      if (!isVault && !isPool) return;
      const bn = (typeof log.blockNumber === 'number') ? log.blockNumber : parseInt(log.blockNumber || '0');
      const topics = log.topics || [];
      const t0 = String(topics[0] || '').toLowerCase();
      // Heuristic: flag bursts of ERC20 transfers in same tx touching vault/pool
      if (t0 === TRANSFER_TOPIC) {
        const from = ethers.utils.getAddress('0x' + topics[1].slice(26));
        const to = ethers.utils.getAddress('0x' + topics[2].slice(26));
        const amountHex = (typeof log.data === 'string') ? log.data.toLowerCase() : (log.data.hex || '').toLowerCase();
        const unlimitedLike = amountHex.length > 66 && amountHex.startsWith('0x000'); // crude size proxy
        const finding = {
          name: 'Balancer Activity Heuristic',
          description: `Vault/Pool transfer tx=${log.transactionHash} unlimitedLike=${unlimitedLike}`,
          alert_id: 'FAST-BALANCER-HEUR',
          severity: unlimitedLike ? 'High' : 'Medium',
          type: 'Suspicious',
          metadata: { address: ethers.utils.getAddress(log.address), from, to, block: String(bn), tx_hash: log.transactionHash }
        };
        log('[alert] balancer:', finding);
        writeAlert(outPath, finding);
      } else if (t0 === String(SWAP_TOPIC).toLowerCase()) {
        const finding = {
          name: 'Balancer Swap Event',
          description: `Swap observed at ${ethers.utils.getAddress(log.address)}`,
          alert_id: 'FAST-BALANCER-SWAP',
          severity: 'Medium',
          type: 'Suspicious',
          metadata: { address: ethers.utils.getAddress(log.address), block: String(bn), tx_hash: log.transactionHash }
        };
        log('[alert] balancer:', finding);
        writeAlert(outPath, finding);
      } else if (t0 === String(POOL_BALANCE_CHANGED_TOPIC).toLowerCase()) {
        const finding = {
          name: 'Balancer Join/Exit Event',
          description: `PoolBalanceChanged at ${ethers.utils.getAddress(log.address)}`,
          alert_id: 'FAST-BALANCER-JOINEXIT',
          severity: 'Medium',
          type: 'Suspicious',
          metadata: { address: ethers.utils.getAddress(log.address), block: String(bn), tx_hash: log.transactionHash }
        };
        log('[alert] balancer:', finding);
        writeAlert(outPath, finding);
      }
    } catch (e) {
      log('[warn] onBalancerLog failed:', e && e.message ? e.message : e);
    }
  }

  // Subscribe to vaults and pools logs
  for (const v of vaults) {
    provider.on({ address: v }, onBalancerLog);
    log(`[watch] Balancer vault address=${v}`);
  }
  for (const p of pools) {
    provider.on({ address: p }, onBalancerLog);
    log(`[watch] Balancer pool address=${p}`);
  }
}

function startDexWatch(provider, cfg) {
  const enableDex = !!cfg.enable_dex;
  if (!enableDex) { log('[dex] disabled'); return; }
  const chain = (cfg.network || '').toLowerCase();
  const uni = (cfg.uniswap_v3 || {});
  const cur = (cfg.curve || {});
  const uniSet = (uni[chain] || { pools: [] });
  const curSet = (cur[chain] || { pools: [] });
  const pools = []
    .concat(uniSet.pools || [])
    .concat(curSet.pools || [])
    .map((x) => String(x).toLowerCase());
  if (pools.length === 0) {
    log('[dex] no pools configured; awaiting config update');
    return;
  }

  const outPath = path.join(ROOT, 'out', 'dex_alerts_live.json');
  const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

  function onDexLog(log) {
    try {
      const addr = String(log.address).toLowerCase();
      if (!pools.includes(addr)) return;
      const bn = (typeof log.blockNumber === 'number') ? log.blockNumber : parseInt(log.blockNumber || '0');
      const topics = log.topics || [];
      const t0 = String(topics[0] || '').toLowerCase();
      if (t0 === TRANSFER_TOPIC) {
        const from = ethers.utils.getAddress('0x' + topics[1].slice(26));
        const to = ethers.utils.getAddress('0x' + topics[2].slice(26));
        const finding = {
          name: 'DEX Pool Transfer Heuristic',
          description: `ERC20 transfer touching pool ${ethers.utils.getAddress(log.address)}`,
          alert_id: 'FAST-DEX-TRANSFER',
          severity: 'Medium',
          type: 'Suspicious',
          metadata: { address: ethers.utils.getAddress(log.address), from, to, block: String(bn), tx_hash: log.transactionHash }
        };
        log('[alert] dex:', finding);
        writeAlert(outPath, finding);
      } else {
        const finding = {
          name: 'DEX Pool Activity',
          description: `Pool log observed at ${ethers.utils.getAddress(log.address)}`,
          alert_id: 'FAST-DEX-LOG',
          severity: 'Low',
          type: 'Info',
          metadata: { address: ethers.utils.getAddress(log.address), block: String(bn), tx_hash: log.transactionHash }
        };
        writeAlert(outPath, finding);
      }
    } catch (e) {
      log('[warn] onDexLog failed:', e && e.message ? e.message : e);
    }
  }

  for (const p of pools) {
    provider.on({ address: p }, onDexLog);
    log(`[watch] DEX pool address=${p}`);
  }
}

function loadAbi() {
  const artifact = path.join(ROOT, 'artifacts', 'TrustManager.json');
  if (!fs.existsSync(artifact)) {
    throw new Error('artifacts/TrustManager.json not found; compile contract first.');
  }
  const j = JSON.parse(fs.readFileSync(artifact, 'utf8'));
  if (!j || !j.abi) throw new Error('Invalid TrustManager.json: missing ABI');
  return j.abi;
}

function nowMs() { return Date.now(); }

// --- Forta Alerts Bridge ---
function startFortaBridge(provider, cfg, contract, alertsPath) {
  try {
    fs.accessSync(alertsPath, fs.constants.F_OK);
  } catch (e) {
    log(`[forta-bridge] alerts file not found: ${alertsPath}`);
    return;
  }
  if (!contract) {
    log('[forta-bridge] CONTRACT_ADDRESS not set; bridge disabled');
    return;
  }

  const NETOUT_THRESHOLD = Number(process.env.BRIDGE_NETOUT_TOKENS || 100000);
  const CALL_COOLDOWN_MS = Number(process.env.BRIDGE_COOLDOWN_MS || 60_000);
  const state = {
    lastPauseAt: 0,
    lastBlockCall: new Map(), // spender => timestamp
    seen: new Set(),          // dedupe by tx_hash or composed key
  };

  const readAlerts = () => {
    let content;
    try { content = fs.readFileSync(alertsPath, 'utf8'); } catch { return []; }
    content = content.trim();
    if (!content) return [];

    // Support two formats: NDJSON lines OR { alerts: [...] }
    let arr = [];
    try {
      const obj = JSON.parse(content);
      if (obj && Array.isArray(obj.alerts)) arr = obj.alerts;
      else if (Array.isArray(obj)) arr = obj; // in case whole file is a JSON array
      else arr = [];
    } catch {
      // NDJSON fallback
      arr = content.split(/\r?\n/).map((s) => {
        try { return JSON.parse(s); } catch { return null; }
      }).filter(Boolean);
    }
    return arr.slice(-300); // keep tail
  };

  const shouldPause = (a) => {
    const name = (a.name || a.alert_id || '').toLowerCase();
    const sev = ((a.severity || a.severity_label || '') + '').toLowerCase();
    const reasons = ((a.reasons || a.metadata?.reasons || a.metadata?.signals || '') + '').toLowerCase();
    const netOut = Number(a.net_out_tokens || a.metadata?.net_out_tokens || 0);
    return sev.includes('high') && name.includes('transfer') && reasons.includes('net') && netOut >= NETOUT_THRESHOLD;
  };

  const shouldBlockSpender = (a) => {
    const name = (a.name || a.alert_id || '').toLowerCase();
    const sev = ((a.severity || a.severity_label || '') + '').toLowerCase();
    const reasons = ((a.reasons || a.metadata?.reasons || a.metadata?.signals || '') + '').toLowerCase();
    const spender = a.spender || a.metadata?.spender;
    const unlimited = reasons.includes('unlimited');
    const unusual = reasons.includes('unusual') || reasons.includes('unknown');
    return sev.includes('high') && name.includes('approval') && unlimited && unusual && spender;
  };

  const callPause = async () => {
    const now = nowMs();
    if (now - state.lastPauseAt < CALL_COOLDOWN_MS) return;
    try {
      const tx = await contract.pause({ gasLimit: 200000 });
      log(`[forta-bridge] pause() sent: ${tx.hash}`);
      state.lastPauseAt = now;
    } catch (e) {
      log(`[forta-bridge] pause() failed: ${e.message}`);
    }
  };

  const callBlockSpender = async (spender) => {
    const now = nowMs();
    const last = state.lastBlockCall.get(spender) || 0;
    if (now - last < CALL_COOLDOWN_MS) return;
    try {
      const tx = await contract.blockSpender(spender, { gasLimit: 200000 });
      log(`[forta-bridge] blockSpender(${spender}) sent: ${tx.hash}`);
      state.lastBlockCall.set(spender, now);
    } catch (e) {
      log(`[forta-bridge] blockSpender(${spender}) failed: ${e.message}`);
    }
  };

  const intervalMs = Number(process.env.BRIDGE_POLL_MS || 5000);
  setInterval(async () => {
    const alerts = readAlerts();
    for (const a of alerts) {
      const key = a.tx_hash || `${a.block_number || ''}:${a.owner || a.from || ''}:${a.spender || a.to || ''}:${a.name || ''}`;
      if (!key) continue;
      if (state.seen.has(key)) continue;
      state.seen.add(key);

      try {
        if (shouldPause(a)) await callPause();
        if (shouldBlockSpender(a)) await callBlockSpender(a.spender || a.metadata?.spender);
      } catch (e) {
        log(`[forta-bridge] action failed: ${e.message}`);
      }
    }
  }, intervalMs);

  log(`[forta-bridge] started. reading ${alertsPath} every ${intervalMs}ms`);
}

async function main() {
  const cfg = loadConfig();
  const args = parseArgs();
  const RPC_URL = args.rpc || process.env.PROVIDER_URL || process.env.RPC_URL || cfg.rpc_url_primary || 'http://127.0.0.1:8545';
  const RPC_FALLBACK = args.rpcFallback || cfg.rpc_url_backup || '';
  const CONTRACT_ADDRESS = (process.env.CONTRACT_ADDRESS || '').trim();
  const PRIVATE_KEY = process.env.PRIVATE_KEY_OVERRIDE || process.env.PRIVATE_KEY || '';

  const FAIL_THRESHOLD = Number(process.env.FAIL_THRESHOLD || 3);
  const WINDOW_SEC = Number(process.env.WINDOW_SEC || 20);
  const COOLDOWN_SEC = Number(process.env.COOLDOWN_SEC || 60);
  const DRY_RUN = String(process.env.DRY_RUN || '0') === '1';

  let provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  log(`Bot connected: chainId=${network.chainId} rpc=${RPC_URL}`);
  provider.on('error', (e) => {
    log('[provider] error:', e && e.message ? e.message : e);
    if (RPC_FALLBACK) {
      log('[provider] switching to fallback RPC');
      provider = new ethers.providers.JsonRpcProvider(RPC_FALLBACK);
    }
  });

  // signer: prefer provided key; fallback to unlocked account[0]
  let signer;
  if (PRIVATE_KEY) {
    signer = new ethers.Wallet(PRIVATE_KEY, provider);
    log(`Using signer pk_head=${PRIVATE_KEY.slice(0, 14)} addr=${await signer.getAddress()}`);
  } else {
    signer = provider.getSigner(0);
    log('Using unlocked account index=0');
  }

  let contract, iface;
  try {
    if (CONTRACT_ADDRESS) {
      const abi = loadAbi();
      iface = new ethers.utils.Interface(abi);
      contract = new ethers.Contract(CONTRACT_ADDRESS, abi, signer);
    } else {
      log('[info] CONTRACT_ADDRESS not set; skipping TrustManager-specific watchers');
    }
  } catch (e) {
    log('[warn] TrustManager ABI/contract init failed:', e && e.message ? e.message : e);
  }

  // Failure ring: per suspect address, keep recent failure timestamps
  const failRing = new Map(); // addr -> number[] of ms
  const lastAction = new Map(); // addr -> ms

  function gcFailures(addr) {
    const arr = failRing.get(addr) || [];
    if (arr.length === 0) return arr;
    const cutoff = nowMs() - WINDOW_SEC * 1000;
    const kept = arr.filter((t) => t >= cutoff);
    failRing.set(addr, kept);
    return kept;
  }

  function recordFailure(addr) {
    const arr = gcFailures(addr);
    arr.push(nowMs());
    failRing.set(addr, arr);
    return arr.length;
  }

  async function mitigate(addr) {
    const now = nowMs();
    const la = lastAction.get(addr) || 0;
    if (now - la < COOLDOWN_SEC * 1000) {
      return; // respect cooldown
    }
    lastAction.set(addr, now);

    log(`[mitigate] addr=${addr} dryRun=${DRY_RUN}`);
    if (DRY_RUN) return;

    // Compose overrides with safe gas policy
    let fee;
    try { fee = await provider.getFeeData(); } catch (_) { fee = {}; }
    const overrides = {};
    if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
      overrides.maxFeePerGas = fee.maxFeePerGas;
      overrides.maxPriorityFeePerGas = fee.maxPriorityFeePerGas;
    } else {
      // Legacy style for local chains
      overrides.gasPrice = ethers.utils.parseUnits('20', 'gwei');
    }
    overrides.gasLimit = ethers.BigNumber.from('200000');

    // Strategy 1: push severe metrics to trigger recalculation & blacklist
    try {
      const tx1 = await contract.updateNodeMetrics(addr, 0, 1000, 0, overrides);
      log('[tx] updateNodeMetrics sent:', tx1.hash);
      await tx1.wait(1);
    } catch (e) {
      log('[warn] updateNodeMetrics failed:', e && e.message ? e.message : e);
    }

    // Strategy 2: negative recommendation with max weight to accelerate fusion
    try {
      const tx2 = await contract.addRecommendation(addr, 10, 100, overrides);
      log('[tx] addRecommendation sent:', tx2.hash);
      await tx2.wait(1);
    } catch (e) {
      log('[warn] addRecommendation failed:', e && e.message ? e.message : e);
    }
  }

  // Subscribe to selective events: NodeBlacklisted
  if (contract) {
    contract.on('NodeBlacklisted', (node, trustValue, ts) => {
      log(`[event] NodeBlacklisted node=${node} trust=${trustValue} ts=${ts.toString()}`);
    });
  }

  // Block watcher: scan receipts for failures, map to node address
  if (contract && iface) provider.on('block', async (bn) => {
    let block;
    try {
      block = await provider.getBlockWithTransactions(bn);
    } catch (e) {
      log('[warn] getBlockWithTransactions failed:', e && e.message ? e.message : e);
      return;
    }
    for (const tx of block.transactions) {
      if (!tx.to || tx.to.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) continue;
      let receipt;
      try { receipt = await provider.getTransactionReceipt(tx.hash); } catch (_) {}
      if (!receipt) continue;
      if (receipt.status === 1) continue; // success

      // status==0: classify and extract target node
      let nodeAddr = tx.from; // fallback
      try {
        const parsed = iface.parseTransaction({ data: tx.data, value: tx.value });
        if (parsed && parsed.name) {
          const name = parsed.name;
          if (name === 'updateNodeMetrics' && parsed.args && parsed.args.length >= 3) {
            nodeAddr = parsed.args[0];
          } else if (name === 'addRecommendation' && parsed.args && parsed.args.length >= 3) {
            nodeAddr = parsed.args[0];
          } else if (name === 'recordInteraction' && parsed.args && parsed.args.length >= 2) {
            // both participants are suspects; record both failures
            const a1 = String(parsed.args[0]).toLowerCase();
            const a2 = String(parsed.args[1]).toLowerCase();
            const c1 = recordFailure(a1);
            const c2 = recordFailure(a2);
            log(`[fail] recordInteraction tx=${tx.hash} a1=${a1} a2=${a2} counts=[${c1},${c2}]`);
            if (c1 >= FAIL_THRESHOLD) await mitigate(a1);
            if (c2 >= FAIL_THRESHOLD) await mitigate(a2);
            continue; // don't double-handle below
          }
        }
      } catch (_) {}

      const count = recordFailure(String(nodeAddr).toLowerCase());
      log(`[fail] tx=${tx.hash} node=${nodeAddr} count=${count}`);
      if (count >= FAIL_THRESHOLD) {
        await mitigate(nodeAddr);
      }
    }
  });

  log('Bot started: approval/Balancer watchers active; TrustManager watchers ' + (contract ? 'enabled' : 'skipped'));

  // Extended watchers
  try { startApprovalWatch(provider, cfg); } catch (e) { log('[warn] startApprovalWatch failed:', e && e.message ? e.message : e); }
  try { startBalancerWatch(provider, cfg); } catch (e) { log('[warn] startBalancerWatch failed:', e && e.message ? e.message : e); }
  try { startDexWatch(provider, cfg); } catch (e) { log('[warn] startDexWatch failed:', e && e.message ? e.message : e); }
  try {
    const fortaPath = path.join(ROOT, 'out', 'forta_alerts_live.json');
    startFortaBridge(provider, cfg, contract, fortaPath);
  } catch (e) { log('[warn] startFortaBridge failed:', e && e.message ? e.message : e); }
}

main().catch((err) => {
  console.error('Bot failed:', err);
  process.exit(1);
});
