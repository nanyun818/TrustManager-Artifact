const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

function readCsv(p) {
  if (!fs.existsSync(p)) return [];
  const s = fs.readFileSync(p, 'utf8');
  const lines = s.split(/\r?\n/).filter((x) => x.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(',').map((x) => x.trim());
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = (cols[j] || '').trim();
    out.push(row);
  }
  return out;
}

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (const a of args) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main() {
  const ROOT = process.cwd();
  const OUT = path.join(ROOT, 'out');
  const args = parseArgs();
  const mode = String(args.mode || process.env.MODE || 'simulate');
  const rpc = String(args.rpc || process.env.RPC_URL || 'http://127.0.0.1:8545');
  const pk = String(args.pk || process.env.PRIVATE_KEY || '');
  const addr = String(args.contract || process.env.CONTRACT_ADDRESS || '');
  const alpha = Number(args.alpha || process.env.ALPHA_BP || 4000);
  const beta = Number(args.beta || process.env.BETA_BP || 3000);
  const gamma = Number(args.gamma || process.env.GAMMA_BP || 3000);
  const lambda = Number(args.lambda || process.env.LAMBDA_BP || 7000);
  const theta = Number(args.theta || process.env.THETA_BP || 0);
  const respCap = Number(args.respCap || process.env.RESP_CAP || 1000);
  const onlineMax = Number(args.onlineMax || process.env.ONLINE_MAX || 3600);
  const decay = Number(args.decay || process.env.DECAY_BP || 0);
  const penalty = Number(args.penalty || process.env.PENALTY_BP || 0);
  const c2cAlpha = Number(args.c2cAlpha || process.env.C2C_ALPHA_BP || 6000);
  const c2cBeta = Number(args.c2cBeta || process.env.C2C_BETA_BP || 2000);
  const c2cGamma = Number(args.c2cGamma || process.env.C2C_GAMMA_BP || 2000);
  const b2cAlpha = Number(args.b2cAlpha || process.env.B2C_ALPHA_BP || 2500);
  const b2cBeta = Number(args.b2cBeta || process.env.B2C_BETA_BP || 5000);
  const b2cGamma = Number(args.b2cGamma || process.env.B2C_GAMMA_BP || 2500);
  const b2bAlpha = Number(args.b2bAlpha || process.env.B2B_ALPHA_BP || 3334);
  const b2bBeta = Number(args.b2bBeta || process.env.B2B_BETA_BP || 3333);
  const b2bGamma = Number(args.b2bGamma || process.env.B2B_GAMMA_BP || 3333);
  const limitN = Number(args.limit || process.env.LIMIT_N || 0);
  const gasLimit = Number(args.gasLimit || process.env.GAS_LIMIT || 8000000);
  const exec = String(args.exec || process.env.EXEC || 'all');

  let alphaBp = alpha, betaBp = beta, gammaBp = gamma, lambdaBp = lambda;
  if (String(args.useTopK || process.env.USE_TOPK || '0') === '1') {
    const p = readJson(path.join(OUT, 'onchain_plan.json')) || {};
    const tk = Array.isArray(p.topK) ? p.topK : [];
    if (tk.length) {
      const t0 = tk[0];
      const okW = typeof t0.alpha === 'number' && typeof t0.beta === 'number' && typeof t0.gamma === 'number';
      const okL = typeof t0.lambda === 'number';
      if (okW) {
        alphaBp = Math.max(0, Math.min(10000, Math.round(Number(t0.alpha)*10000)));
        betaBp = Math.max(0, Math.min(10000, Math.round(Number(t0.beta)*10000)));
        gammaBp = Math.max(0, Math.min(10000, Math.round(Number(t0.gamma)*10000)));
      }
      if (okL) {
        lambdaBp = Math.max(0, Math.min(10000, Math.round(Number(t0.lambda)*10000)));
      }
    }
  }
  const plan = { calls: [], recs: [], limits: [], blocks: [], config: { alpha: alphaBp, beta: betaBp, gamma: gammaBp, lambda: lambdaBp } };

  const riskCsv = readCsv(path.join(OUT, 'node_risk_agg.csv'));
  const behJson = readJson(path.join(OUT, 'behavior_indicators.json')) || [];
  const trustCsv = readCsv(path.join(OUT, 'trust_series.csv'));
  const byAddrBeh = {};
  if (Array.isArray(behJson)) {
    for (const x of behJson) {
      const a = String(x.address || x.addr || '').toLowerCase();
      if (a) byAddrBeh[a] = x;
    }
  }

  for (const r of riskCsv) {
    const a = String(r.address || r.addr || '').toLowerCase();
    if (!a) continue;
    const beh = byAddrBeh[a] || {};
    const successRate = Math.max(0, Math.min(100, Number(beh.successRate || 100 - Number(r.model_avg_risk || 0))));
    const responseTime = Math.max(0, Number(beh.response_ms || beh.responseTime || 100));
    const onlineDelta = Math.max(0, Number(beh.online_delta || 60));
    plan.calls.push({ op: 'updateNodeMetrics', address: a, successRate, responseTime, onlineDelta });
    const riskAvg = Number(r.model_avg_risk || r.avg_risk || 0);
    if (riskAvg <= 0.2) {
      const recWeight = 10;
      const recValue = Math.max(0, Math.min(200, Math.round((1 - riskAvg) * 200)));
      plan.recs.push({ op: 'addRecommendation', address: a, value: recValue, weight: recWeight });
    }
    let riskExposure = Math.max(0, Math.min(100, Math.round((riskAvg || 0) * 100)));
    const bl = Number(beh.blacklist_contact_count || 0) + Number(beh.blacklist_transfer_count || 0);
    const appr = Number(beh.approval_anomaly_count || 0);
    if (bl > 0) riskExposure = Math.min(100, riskExposure + 80);
    if (appr > 0) riskExposure = Math.min(100, riskExposure + 60);
    plan.calls.push({ op: 'updateRiskExposure', address: a, risk: riskExposure });
  }

  if (limitN > 0) {
    plan.calls = plan.calls.slice(0, limitN);
    plan.recs = plan.recs.slice(0, limitN);
    plan.blocks = plan.blocks.slice(0, limitN);
    plan.limits = plan.limits.slice(0, limitN);
  }

  for (const x of behJson) {
    const a = String(x.address || x.addr || '').toLowerCase();
    const spender = String(x.spender || '').toLowerCase();
    const token = String(x.token || '').toLowerCase();
    const flags = Array.isArray(x.flags) ? x.flags.map((f) => String(f).toLowerCase()) : [];
    const bad = flags.some((f) => f.includes('approve') || f.includes('new_spender') || f.includes('anomalous'));
    if (bad && spender) plan.blocks.push({ op: 'blockSpender', spender });
    if (bad && token) plan.limits.push({ op: 'setSpendLimit', token, cap: 0 });
  }

  const outFile = String(args.out || process.env.OUT_FILE || 'onchain_call_plan.json');
  const outPlan = path.join(OUT, outFile);
  fs.writeFileSync(outPlan, JSON.stringify(plan, null, 2));

  if (mode !== 'write') {
    process.stdout.write(outPlan + '\n');
    return;
  }

  if (!addr) {
    throw new Error('Missing CONTRACT_ADDRESS');
  }

  const provider = new ethers.providers.JsonRpcProvider(rpc);
  const wallet = pk ? new ethers.Wallet(pk, provider) : provider.getSigner(0);
  const abi = [
    'function registerNode(address _node) public',
    'function updateNodeMetrics(address _node,uint _successRate,uint _responseTime,uint _onlineTime) public',
    'function addRecommendation(address _node,uint _recommendValue,uint _weight) public',
    'function manualUpdateTrustValue(address _node,uint _newTrustValue,string _reason) public',
    'function updateWeights(uint _alpha,uint _beta,uint _gamma) public',
    'function updateLambda(uint _lambda) public',
    'function updateTheta(uint _theta) public',
    'function updateCaps(uint _respCap,uint _onlineMax) public',
    'function updateDecayPerHour(uint _bp) public',
    'function updatePenaltyBp(uint _bp) public',
    'function updateRiskExposure(address _node,uint _risk) public',
    'function blockSpender(address spender) public',
    'function setSpendLimit(address token,uint256 cap) public',
    'function updatePenaltyBpFor(address _node,uint _bp) public',
    'function fastRespond(address _node,uint _risk,uint _bp,uint _until) public',
  ];
  const c = new ethers.Contract(addr, abi, wallet);

  const txs = [];
  const updWeights = await c.updateWeights(alphaBp, betaBp, gammaBp, { gasLimit });
  await updWeights.wait();
  txs.push(updWeights.hash);
  const updLambda = await c.updateLambda(lambdaBp, { gasLimit });
  await updLambda.wait();
  txs.push(updLambda.hash);
  const updTheta = await c.updateTheta(theta, { gasLimit });
  await updTheta.wait();
  txs.push(updTheta.hash);
  const updCaps = await c.updateCaps(respCap, onlineMax, { gasLimit });
  await updCaps.wait();
  txs.push(updCaps.hash);
  if (decay > 0) { const u = await c.updateDecayPerHour(decay, { gasLimit }); await u.wait(); txs.push(u.hash); }
  if (penalty > 0) { const u2 = await c.updatePenaltyBp(penalty, { gasLimit }); await u2.wait(); txs.push(u2.hash); }
  try {
    const r0 = await c.updateRelWeights(0, c2cAlpha, c2cBeta, c2cGamma, { gasLimit });
    await r0.wait(); txs.push(r0.hash);
    const r1 = await c.updateRelWeights(1, b2cAlpha, b2cBeta, b2cGamma, { gasLimit });
    await r1.wait(); txs.push(r1.hash);
    const r2 = await c.updateRelWeights(2, b2bAlpha, b2bBeta, b2bGamma, { gasLimit });
    await r2.wait(); txs.push(r2.hash);
  } catch (_) {}

  if (exec === 'all' || exec === 'calls' || exec === 'metrics' || exec === 'recs' || exec === 'limits') {
    for (const call of plan.calls) {
      const nodeAddr = ethers.utils.getAddress(call.address);
      try { const r = await c.registerNode(nodeAddr, { gasLimit }); await r.wait(); } catch (e) {}
    }
    for (const call of plan.calls) {
      const nodeAddr = ethers.utils.getAddress(call.address);
      if (typeof call.successRate !== 'undefined') {
        const tx = await c.updateNodeMetrics(nodeAddr, call.successRate, call.responseTime, call.onlineDelta, { gasLimit });
        await tx.wait();
        txs.push(tx.hash);
      }
      if (typeof call.risk !== 'undefined') {
        const until = Math.floor(Date.now()/1000) + 3600;
        const bp = 700;
        try {
          const tx2a = await c.fastRespond(nodeAddr, call.risk, bp, until, { gasLimit });
          await tx2a.wait();
          txs.push(tx2a.hash);
        } catch (_) {
          const tx2 = await c.updateRiskExposure(nodeAddr, call.risk, { gasLimit });
          await tx2.wait();
          txs.push(tx2.hash);
        }
      }
    }
  }

  if (exec === 'all' || exec === 'recs') {
    for (const rec of plan.recs) {
      const nodeAddr = ethers.utils.getAddress(rec.address);
      try { const r = await c.registerNode(nodeAddr, { gasLimit }); await r.wait(); } catch (e) {}
      const tx = await c.addRecommendation(nodeAddr, rec.value, rec.weight, { gasLimit });
      await tx.wait();
      txs.push(tx.hash);
    }
  }

  if (exec === 'all' || exec === 'limits') {
    for (const b of plan.blocks) {
      const sp = ethers.utils.getAddress(b.spender);
      const tx = await c.blockSpender(sp, { gasLimit });
      await tx.wait();
      txs.push(tx.hash);
    }
    for (const lm of plan.limits) {
      const tk = ethers.utils.getAddress(lm.token);
      const tx = await c.setSpendLimit(tk, ethers.BigNumber.from(String(lm.cap)), { gasLimit });
      await tx.wait();
      txs.push(tx.hash);
    }
  }

  fs.writeFileSync(path.join(OUT, 'onchain_txs.json'), JSON.stringify({ txs }, null, 2));
  process.stdout.write('WROTE\n');
}

main().catch((e) => { process.stderr.write(String(e && e.message ? e.message : e) + '\n'); process.exit(1); });
