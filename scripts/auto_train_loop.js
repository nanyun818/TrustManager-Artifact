// Auto training loop: periodically aggregate, label, train, and evaluate
// Usage: node scripts/auto_train_loop.js [--interval <ms>] [--once]
// Env overrides:
//   AUTO_TRAIN_INTERVAL_MS: default 3600000 (1 hour)
//   AUTO_TRAIN_MIN_DELTA_ALERTS: default 1 (run if new alerts count >= N)
// Writes logs to out/auto_train.log and maintains out/auto_train_state.json

require('dotenv').config({ override: true });
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname ? path.resolve(__dirname, '..') : process.cwd();
const OUT_DIR = path.join(ROOT, 'out');
const MODELS_DIR = path.join(ROOT, 'models');
const LOG_PATH = path.join(OUT_DIR, 'auto_train.log');
const STATE_PATH = path.join(OUT_DIR, 'auto_train_state.json');

function nowCST() {
  const d = new Date();
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  const y = parts.year, m = parts.month, day = parts.day;
  const hh = parts.hour, mm = parts.minute, ss = parts.second;
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}.${ms} +08:00`;
}

function stampCST() {
  const d = new Date();
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}-${parts.minute}-${parts.second}-${ms}+08-00`;
}

function log(msg, obj) {
  const line = `[${nowCST()}] ${msg}` + (obj !== undefined ? ` ${JSON.stringify(obj)}` : '');
  console.log(line);
  try {
    fs.appendFileSync(LOG_PATH, line + '\n', 'utf8');
  } catch (_) {}
}

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function writeJsonSafe(p, obj) {
  try {
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, p);
  } catch (_) {}
}

function ensureDirs() {
  try { if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR); } catch (_) {}
  try { if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR); } catch (_) {}
}

function countCsvRows(p) {
  try {
    if (!fs.existsSync(p)) return 0;
    const txt = fs.readFileSync(p, 'utf8');
    const lines = txt.split(/\r?\n/).filter(Boolean);
    return Math.max(0, lines.length - 1);
  } catch (_) { return 0; }
}

function countJsonArray(p) {
  const j = readJsonSafe(p);
  if (!j) return 0;
  if (Array.isArray(j)) return j.length;
  if (Array.isArray(j.records)) return j.records.length;
  if (Array.isArray(j.items)) return j.items.length;
  return 0;
}

function writePhaseSummary() {
  try {
    const stamp = stampCST();
    const outP = path.join(OUT_DIR, `run_summary_${stamp}.json`);
    const labeled = readJsonSafe(path.join(OUT_DIR, 'labeled_dataset.json')) || {};
    const pipeline = readJsonSafe(path.join(OUT_DIR, 'pipeline_results.json')) || {};
    const fortaCount = countJsonArray(path.join(OUT_DIR, 'forta_alerts_live_array.json'));
    const riskRows = countCsvRows(path.join(OUT_DIR, 'node_risk_agg.csv'));
    const beh = readJsonSafe(path.join(OUT_DIR, 'behavior_indicators.json')) || [];
    const metrics = readJsonSafe(path.join(OUT_DIR, 'metrics_report.json')) || {};
    const cv = readJsonSafe(path.join(OUT_DIR, 'cv_report.json')) || {};
    const obj = {
      ts: nowCST(),
      samples: labeled.summary || {},
      pipeline_totals: pipeline.totals || {},
      forta_live_alerts_total: fortaCount,
      node_risk_rows: riskRows,
      behavior_indicators_count: Array.isArray(beh) ? beh.length : 0,
      metrics_summary: metrics.summary || {},
      cv_summary: cv.summary || {},
    };
    writeJsonSafe(outP, obj);
    log('phase summary written', { path: outP });
  } catch (e) {
    log('phase summary failed', { error: e && e.message });
  }
}

function _listRunSummaries(maxN) {
  try {
    const files = fs.readdirSync(OUT_DIR).filter(f => f.startsWith('run_summary_') && f.endsWith('.json'));
    const stats = files.map(f => ({ f, t: fs.statSync(path.join(OUT_DIR, f)).mtimeMs || 0 }));
    stats.sort((a,b) => b.t - a.t);
    const picked = stats.slice(0, maxN).map(x => path.join(OUT_DIR, x.f));
    return picked.map(p => readJsonSafe(p)).filter(Boolean);
  } catch (_) { return []; }
}

function _metricsStable(lastN) {
  const arr = _listRunSummaries(lastN).map(x => x.metrics_summary || {});
  if (arr.length < lastN) return false;
  const vals = (k) => arr.map(s => Number((s && s[k]) || 0)).filter(v => Number.isFinite(v));
  const ok = (xs, tol) => {
    if (!xs.length) return false;
    const mx = Math.max.apply(null, xs);
    const mn = Math.min.apply(null, xs);
    return (mx - mn) <= tol;
  };
  return ok(vals('f1'), 0.03) && ok(vals('precision'), 0.03) && ok(vals('recall'), 0.03);
}

function _deltaTrustStats() {
  try {
    const p = path.join(OUT_DIR, 'onchain_compare_top100_recs_eval_after.csv');
    if (!fs.existsSync(p)) return { count: 0, mean: 0, pos: 0, neg: 0 };
    const s = fs.readFileSync(p, 'utf8');
    const lines = s.split(/\r?\n/).filter(x => x.trim().length > 0);
    if (lines.length <= 1) return { count: 0, mean: 0, pos: 0, neg: 0 };
    const hdr = lines[0].split(',');
    const di = hdr.indexOf('delta_trust');
    const arr = lines.slice(1).map(l => Number(l.split(',')[di] || 0));
    const mean = arr.reduce((a,b)=>a+b,0) / arr.length;
    const pos = arr.filter(d => d > 0).length;
    const neg = arr.filter(d => d < 0).length;
    return { count: arr.length, mean, pos, neg };
  } catch (_) { return { count: 0, mean: 0, pos: 0, neg: 0 }; }
}

function checkStopConditions() {
  const labeledRows = countCsvRows(path.join(OUT_DIR, 'labeled_dataset.csv'));
  const pipelineRows = countCsvRows(path.join(OUT_DIR, 'pipeline_results.csv'));
  const metricsOk = _metricsStable(5);
  const plan = readJsonSafe(path.join(OUT_DIR, 'onchain_plan.json')) || {};
  const healthPass = Boolean(plan.health_gate && plan.health_gate.pass);
  const deltaStats = _deltaTrustStats();
  const state = readJsonSafe(STATE_PATH) || {};
  state.health_gate_pass_streak = (healthPass ? (Number(state.health_gate_pass_streak || 0) + 1) : 0);
  const dtPos = (deltaStats.mean > 0) && (deltaStats.pos >= Math.max(1, deltaStats.neg));
  state.delta_trust_positive_streak = (dtPos ? (Number(state.delta_trust_positive_streak || 0) + 1) : 0);
  const dataOk = (labeledRows >= 5000) && (pipelineRows >= 20000);
  const healthOk = state.health_gate_pass_streak >= 5;
  const deltaOk = state.delta_trust_positive_streak >= 3;
  const pass = dataOk && metricsOk && healthOk && deltaOk;
  const status = {
    ts: nowCST(),
    pass,
    data: { labeled_rows: labeledRows, pipeline_rows: pipelineRows },
    metrics_stable: metricsOk,
    health_pass_streak: state.health_gate_pass_streak || 0,
    delta_trust: { count: deltaStats.count, mean_delta_trust: Number((deltaStats.mean||0).toFixed(4)), positive_count: deltaStats.pos, negative_count: deltaStats.neg, positive_streak: state.delta_trust_positive_streak || 0 }
  };
  writeJsonSafe(path.join(OUT_DIR, 'stop_conditions_status.json'), status);
  writeJsonSafe(STATE_PATH, state);
  if (pass) {
    runCmd('node', ['scripts/build_chart_options.js']);
    runCmd('node', ['scripts/build_charts.js']);
  }
  log('stop_conditions', status);
  return pass;
}

function runCmd(cmd, args, opts = {}) {
  log(`run: ${cmd} ${args.join(' ')}`);
  // On Windows, npm.cmd often requires shell=true to resolve correctly.
  const isNpm = /^npm(\.cmd)?$/i.test(cmd);
  const shellDefault = isNpm && process.platform === 'win32';
  const res = spawnSync(cmd, args, { cwd: ROOT, env: process.env, shell: (opts.shell !== undefined ? opts.shell : shellDefault), stdio: 'pipe', ...opts });
  const stdout = (res.stdout || '').toString();
  const stderr = (res.stderr || '').toString();
  const ok = res.status === 0;
  if (stdout) log(`stdout: ${stdout.trim().slice(-800)}`);
  if (stderr) log(`stderr: ${stderr.trim().slice(-800)}`);
  if (!ok) log(`cmd failed: ${cmd}`, { code: res.status });
  return { ok, code: res.status, stdout, stderr };
}

function readAlertsSignal() {
  const fortaLive = path.join(OUT_DIR, 'forta_alerts_live.json');
  let count = 0; let mtimeMs = 0;
  try {
    if (fs.existsSync(fortaLive)) {
      const st = fs.statSync(fortaLive);
      mtimeMs = st.mtimeMs || 0;
      const txt = fs.readFileSync(fortaLive, 'utf8').trim();
      if (txt.length) {
        const j = JSON.parse(txt);
        if (Array.isArray(j)) count = j.length; else count = Object.keys(j || {}).length;
      }
    }
  } catch (_) {}
  return { count, mtimeMs };
}

function versionModel() {
  const modelPath = path.join(MODELS_DIR, 'logreg.json');
  if (!fs.existsSync(modelPath)) return;
  const stamp = stampCST();
  const versioned = path.join(MODELS_DIR, `logreg.${stamp}.json`);
  try {
    fs.copyFileSync(modelPath, versioned);
    log('Versioned model', { versioned });
  } catch (e) {
    log('Versioning failed', { error: e && e.message });
  }
}

function _readTailLines(p, n) {
  try {
    if (!fs.existsSync(p)) return [];
    const txt = fs.readFileSync(p, 'utf8').trim();
    if (!txt) return [];
    const lines = txt.split(/\r?\n/).filter(Boolean);
    return lines.slice(Math.max(0, lines.length - n));
  } catch (_) { return []; }
}

function _nodeHealthStats(maxTail) {
  const lines = _readTailLines(path.join(OUT_DIR, 'node_health_live.json'), maxTail);
  let reqSum = 0, errSum = 0;
  const lts = [];
  const sks = [];
  for (const ln of lines) {
    try {
      const j = JSON.parse(ln);
      const req = Number(j.requests || 0);
      const err = Number(j.errors || 0);
      const l = Number(j.avg_latency_ms || 0);
      const s = Number(j.skew_sec || 0);
      if (req >= 0) reqSum += Math.max(0, req);
      if (err >= 0) errSum += Math.max(0, err);
      if (l >= 0 && Number.isFinite(l)) lts.push(l);
      if (s >= 0 && Number.isFinite(s)) sks.push(s);
    } catch (_) {}
  }
  const avg = arr => arr.length ? (arr.reduce((a,b)=>a+b,0) / arr.length) : 0;
  const cap = Number(process.env.SGRPO_SKEW_OUTLIER_SEC || 7200);
  const skFiltered = sks.filter(v => v <= cap && v >= 0);
  const skUse = skFiltered.length ? skFiltered : sks;
  const er = (reqSum + errSum) > 0 ? (errSum / (reqSum + errSum)) : 0;
  return { error_rate: er, avg_latency_ms: avg(lts), skew_sec: avg(skUse) };
}

function _dirichlet3() {
  const a = Math.random();
  const b = Math.random();
  const c = Math.random();
  const sum = a + b + c;
  return [a / sum, b / sum, c / sum];
}

function _metricsReport() {
  const m = readJsonSafe(path.join(OUT_DIR, 'metrics_report.json')) || {};
  const grid = Array.isArray(m.grid) ? m.grid : [];
  const ext = m.summary_ext || {};
  const sum = m.summary || {};
  return { grid, ext, sum };
}

function _closestGrid(grid, thr) {
  if (!grid.length) return null;
  let best = grid[0];
  let d = Math.abs(Number(best.threshold || 0) - thr);
  for (const g of grid) {
    const dd = Math.abs(Number(g.threshold || 0) - thr);
    if (dd < d) { d = dd; best = g; }
  }
  return best;
}

function _onchainValidity(alpha, beta, gamma, lambda) {
  const s = alpha + beta + gamma;
  const okW = Math.abs(s - 1.0) < 1e-6 && [alpha, beta, gamma].every(v => v >= 0 && v <= 1);
  const okL = lambda >= 0.5 && lambda <= 0.9;
  return okW && okL ? 1 : 0;
}

function _computeReward(cand, metrics, health, weights) {
  const g = _closestGrid(metrics.grid, cand.threshold) || {};
  const tp = Number(g.tp || metrics.sum.tp || 0);
  const fp = Number(g.fp || metrics.sum.fp || 0);
  const rec = Number(g.recall || metrics.sum.recall || 0);
  const fpr = (tp + fp) > 0 ? (fp / (tp + fp)) : 0;
  const er = Math.min(1, Math.max(0, Number(health.error_rate || 0)));
  const lt = Math.max(0, Number(health.avg_latency_ms || 0));
  const sk = Math.max(0, Number(health.skew_sec || 0));
  const ltNorm = Math.min(1, lt / Number(process.env.SGRPO_LATENCY_NORM_MS || 2000));
  const skPen = Math.min(1, sk / Number(process.env.SGRPO_SKEW_NORM_SEC || 120));
  const explain = Math.max(0, Math.min(1, Number(metrics.ext.explain_coverage || 0)));
  const valid = _onchainValidity(cand.alpha, cand.beta, cand.gamma, cand.lambda);
  const rSec = weights.w1 * rec - weights.w2 * fpr - weights.w3 * er;
  const rCom = weights.w4 * (1 - er) - weights.w5 * skPen - weights.w6 * ltNorm;
  const rFmt = weights.w7 * explain + weights.w8 * valid;
  const R = rSec + rCom + rFmt;
  return { R, parts: { rSec, rCom, rFmt, rec, fpr, er, ltNorm, skPen, explain, valid } };
}

function _sgrpoCandidates() {
  const thresholds = [0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5];
  const blockWins = [5000,10000,20000];
  const fallbacks = [true,false];
  const cands = [];
  const dist = readJsonSafe(path.join(OUT_DIR, 'sgrpo_dist.json')) || {};
  const plan = readJsonSafe(path.join(OUT_DIR, 'onchain_plan.json')) || {};
  const prevTop = Array.isArray(plan.topK) ? plan.topK : [];
  if (prevTop.length) {
    const biasN = Math.min(prevTop.length, 4);
    for (let i = 0; i < biasN; i++) {
      const t0 = Number(prevTop[i].threshold || thresholds[0]);
      const l0 = Number(prevTop[i].lambda || 0.7);
      const a0 = Number(prevTop[i].alpha || 0.4);
      const b0 = Number(prevTop[i].beta || 0.3);
      const g0 = Number(prevTop[i].gamma || 0.3);
      const bw0 = Number(prevTop[i].blockWindow || blockWins[0]);
      const fb0 = Boolean(prevTop[i].enableRuleFallback);
      const t = Math.max(0.1, Math.min(0.9, t0 + (Math.random()-0.5)*0.1));
      const l = Math.max(0.5, Math.min(0.9, l0 + (Math.random()-0.5)*0.1));
      let aa = Math.max(0, a0 + (Math.random()-0.5)*0.2);
      let bb = Math.max(0, b0 + (Math.random()-0.5)*0.2);
      let gg = Math.max(0, g0 + (Math.random()-0.5)*0.2);
      const sum = aa + bb + gg || 1;
      aa = aa / sum; bb = bb / sum; gg = gg / sum;
      const bw = Math.random() < 0.7 ? bw0 : blockWins[Math.floor(Math.random()*blockWins.length)];
      const fb = Math.random() < 0.7 ? fb0 : fallbacks[Math.floor(Math.random()*fallbacks.length)];
      cands.push({ threshold: t, blockWindow: bw, enableRuleFallback: fb, alpha: aa, beta: bb, gamma: gg, lambda: l });
    }
  }
  for (const t of thresholds) {
    let [a,b,g] = _dirichlet3();
    let l = 0.5 + 0.4*Math.random();
    let bw = blockWins[Math.floor(Math.random()*blockWins.length)];
    let fb = fallbacks[Math.floor(Math.random()*fallbacks.length)];
    if (dist.weightsMean && dist.lambdaMean) {
      a = Math.max(0, Math.min(1, Number(dist.weightsMean.alpha || a) + (Math.random()-0.5)*0.1));
      b = Math.max(0, Math.min(1, Number(dist.weightsMean.beta || b) + (Math.random()-0.5)*0.1));
      g = Math.max(0, Math.min(1, Number(dist.weightsMean.gamma || g) + (Math.random()-0.5)*0.1));
      const s = a + b + g || 1; a/=s; b/=s; g/=s;
      l = Math.max(0.5, Math.min(0.9, Number(dist.lambdaMean || l) + (Math.random()-0.5)*0.05));
    }
    if (dist.thresholds && dist.blockWins && dist.fallbacks && Math.random() < 0.7) {
      const tProb = Number(dist.thresholds[String(t)] || 0);
      const bwIdx = Math.random() < 0.5 ? 0 : (Math.random() < 0.5 ? 1 : 2);
      const bwVal = blockWins[bwIdx];
      const bwProb = Number(dist.blockWins[String(bwVal)] || 0);
      const fbVal = fallbacks[Math.random() < 0.5 ? 0 : 1];
      const fbProb = Number(dist.fallbacks[String(fbVal)] || 0);
      if (tProb + bwProb + fbProb > 0) { bw = bwVal; fb = fbVal; }
    }
    cands.push({ threshold: t, blockWindow: bw, enableRuleFallback: fb, alpha: a, beta: b, gamma: g, lambda: l });
  }
  return cands;
}

function _sgrpoRankAndWritePlan() {
  const metrics = _metricsReport();
  const health = _nodeHealthStats(Number(process.env.SGRPO_HEALTH_TAIL || 50));
  const weights = {
    w1: Number(process.env.SGRPO_W1 || 1.0),
    w2: Number(process.env.SGRPO_W2 || 0.5),
    w3: Number(process.env.SGRPO_W3 || 0.5),
    w4: Number(process.env.SGRPO_W4 || 0.3),
    w5: Number(process.env.SGRPO_W5 || 0.2),
    w6: Number(process.env.SGRPO_W6 || 0.2),
    w7: Number(process.env.SGRPO_W7 || 0.2),
    w8: Number(process.env.SGRPO_W8 || 0.2),
  };
  const cands = _sgrpoCandidates();
  const scored = cands.map(c => {
    const r = _computeReward(c, metrics, health, weights);
    return { ...c, reward: r.R, parts: r.parts };
  });
  const mean = scored.reduce((a,b)=>a+b.reward,0) / Math.max(1, scored.length);
  const withAdv = scored.map(x => ({ ...x, advantage: x.reward - mean }));
  withAdv.sort((a,b)=>b.reward - a.reward);
  const topK = withAdv.slice(0, Number(process.env.SGRPO_TOPK || 3));
  const minSec = Number(process.env.SGRPO_MIN_SEC || 0.2);
  const maxErr = Number(process.env.SGRPO_MAX_ERR || 0.2);
  const maxLat = Number(process.env.SGRPO_MAX_LAT_NORM || 0.5);
  const maxSk = Number(process.env.SGRPO_MAX_SKEW_PEN || 0.5);
  const ok = topK.length ? ((Number(topK[0].parts.rec || 0) >= minSec) && (Number(topK[0].parts.er || 0) <= maxErr) && (Number(topK[0].parts.ltNorm || 0) <= maxLat) && (Number(topK[0].parts.skPen || 0) <= maxSk)) : false;
  const dist = { thresholds: {}, blockWins: {}, fallbacks: {}, weightsMean: { alpha: 0.3333, beta: 0.3333, gamma: 0.3334 }, lambdaMean: 0.7 };
  const parts0 = topK.length ? (topK[0].parts || {}) : {};
  const healthGate = {
    pass: ok,
    thresholds: { min_sec: minSec, max_err: maxErr, max_lat_norm: maxLat, max_skew_pen: maxSk },
    metrics: {
      rec: Number(parts0.rec || 0),
      er: Number(parts0.er || 0),
      ltNorm: Number(parts0.ltNorm || 0),
      skPen: Number(parts0.skPen || 0),
      error_rate: Number(health.error_rate || 0),
      avg_latency_ms: Number(health.avg_latency_ms || 0),
      skew_sec: Number(health.skew_sec || 0)
    }
  };
  let wSum = 0, aSum = 0, bSum = 0, gSum = 0, lSum = 0;
  for (const x of withAdv) {
    const w = Math.max(0, Number(x.advantage || 0));
    if (w > 0) {
      dist.thresholds[String(x.threshold)] = (dist.thresholds[String(x.threshold)] || 0) + w;
      dist.blockWins[String(x.blockWindow)] = (dist.blockWins[String(x.blockWindow)] || 0) + w;
      dist.fallbacks[String(x.enableRuleFallback)] = (dist.fallbacks[String(x.enableRuleFallback)] || 0) + w;
      aSum += w * Number(x.alpha || 0);
      bSum += w * Number(x.beta || 0);
      gSum += w * Number(x.gamma || 0);
      lSum += w * Number(x.lambda || 0);
      wSum += w;
    }
  }
  if (wSum > 0) {
    const s = aSum + bSum + gSum || 1;
    dist.weightsMean.alpha = Math.max(0, Math.min(1, aSum / s));
    dist.weightsMean.beta = Math.max(0, Math.min(1, bSum / s));
    dist.weightsMean.gamma = Math.max(0, Math.min(1, gSum / s));
    dist.lambdaMean = Math.max(0.5, Math.min(0.9, lSum / wSum));
  }
  const plan = {
    ts: nowCST(),
    health,
    weights,
    candidates_count: withAdv.length,
    mean_reward: mean,
    topK,
    candidates: withAdv,
    health_gate: healthGate,
    recommendation: ok ? { updateNodeMetrics: true, addRecommendation: true, applyPenalty: false } : { updateNodeMetrics: false, addRecommendation: false, applyPenalty: false }
  };
  writeJsonSafe(path.join(OUT_DIR, 'onchain_plan.json'), plan);
  writeJsonSafe(path.join(OUT_DIR, 'sgrpo_dist.json'), dist);
  writeJsonSafe(path.join(OUT_DIR, 'health_gate_status.json'), { ts: nowCST(), pass: healthGate.pass, thresholds: healthGate.thresholds, metrics: healthGate.metrics });
  log('health gate', { pass: healthGate.pass });
  log('sgrpo plan written', { topK: topK.length, mean_reward: mean.toFixed(6) });
}

function cycleOnce() {
  ensureDirs();
  log('--- cycle start ---');

  const rpcPool = process.env.RPC_POOL || '';
  const tokens = process.env.TARGET_TOKENS || '';
  if (rpcPool || process.env.PROVIDER_URL || process.env.RPC_URL) {
    const args = ['scripts/fetch_transfers.js'];
    if (rpcPool) { args.push('--rpcPool', rpcPool); } else if (process.env.PROVIDER_URL || process.env.RPC_URL) { args.push('--rpc', String(process.env.PROVIDER_URL || process.env.RPC_URL)); }
    if (tokens) { args.push('--tokens', tokens); }
    args.push('--blocks', String(process.env.FETCH_BLOCKS || '5000'));
    args.push('--chunk', String(process.env.FETCH_CHUNK || '3000'));
    runCmd('node', args);
  }

  // 1) Aggregate detection scores -> out/pipeline_results.json,csv
  const r1 = runCmd('node', ['scripts/rules_engine.js']);
  if (!r1.ok) return log('cycle aborted at rules_engine');

  // 2) Convert live Forta NDJSON to JSON array/CSV
  runCmd('node', [
    'scripts/forta_live_to_array.js',
    '--in', path.join('out', 'forta_alerts_live.json'),
    '--json', path.join('out', 'forta_alerts_live_array.json'),
    '--csv', path.join('out', 'forta_alerts_live.csv'),
    '--limit', '200000',
  ]);

  // 3) Label from Forta -> out/labeled_dataset.csv
  const r2 = runCmd('node', [
    'scripts/label_from_forta.js',
    '--input', path.join('out', 'pipeline_results.csv'),
    '--forta', [path.join('out', 'forta_alerts.csv'), path.join('out', 'forta_alerts_live_array.json')].join(','),
    '--output', path.join('out', 'labeled_dataset.csv'),
    '--blockWindow', '10000',
    '--timeWindowSec', '0',
    '--enableRuleFallback', 'true',
  ]);
  if (!r2.ok) return log('cycle aborted at label_from_forta');

  // 3) Train model -> models/logreg.json
  const r3 = runCmd(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'models:train']);
  if (!r3.ok) return log('cycle aborted at models:train');
  versionModel();

  // 5) Evaluate model
  const r4 = runCmd(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'models:evaluate']);
  if (!r4.ok) log('models:evaluate failed (non-blocking)');

  // Update state
  const alerts = readAlertsSignal();
  const state = readJsonSafe(STATE_PATH) || {};
  state.last_run_iso = nowCST();
  state.last_alerts_count = alerts.count;
  state.last_alerts_mtime = alerts.mtimeMs;
  writeJsonSafe(STATE_PATH, state);
  writePhaseSummary();
  _sgrpoRankAndWritePlan();
  const plan = readJsonSafe(path.join(OUT_DIR, 'onchain_plan.json')) || {};
  const mode = String(process.env.ONCHAIN_MODE || 'simulate');
  const limitArg = String(process.env.ONCHAIN_LIMIT_N || '100');
  if (mode === 'write' && !(plan.health_gate && plan.health_gate.pass)) {
    try {
      const p = path.join(OUT_DIR, 'skip_rounds.jsonl');
      const item = { ts: nowCST(), reason: 'health_gate_not_pass', metrics: plan.health_gate && plan.health_gate.metrics ? plan.health_gate.metrics : {} };
      fs.appendFileSync(p, JSON.stringify(item) + '\n', 'utf8');
      log('onchain write skipped', { reason: 'health_gate_not_pass' });
    } catch (_) {}
  } else {
    runCmd('node', [
      'scripts/onchain_responder.js',
      `--mode=${mode}`,
      `--limit=${limitArg}`,
      `--out=onchain_call_plan.json`,
    ]);
  }
  checkStopConditions();
  log('--- cycle end ---');
}

function main() {
  process.on('SIGINT', () => {
    try {
      const state = readJsonSafe(STATE_PATH) || {};
      state.last_run_iso = nowCST();
      state.shutdown = true;
      writeJsonSafe(STATE_PATH, state);
      log('shutdown(SIGINT)');
    } finally { process.exit(0); }
  });
  process.on('SIGTERM', () => {
    try {
      const state = readJsonSafe(STATE_PATH) || {};
      state.last_run_iso = nowCST();
      state.shutdown = true;
      writeJsonSafe(STATE_PATH, state);
      log('shutdown(SIGTERM)');
    } finally { process.exit(0); }
  });
  process.on('uncaughtException', (e) => {
    try {
      const state = readJsonSafe(STATE_PATH) || {};
      state.last_run_iso = nowCST();
      state.error = (e && e.message) || String(e);
      writeJsonSafe(STATE_PATH, state);
      log('uncaughtException', { error: state.error });
    } finally { process.exit(1); }
  });
  const argv = process.argv.slice(2);
  const once = argv.includes('--once');
  const idx = argv.indexOf('--interval');
  const intervalEnv = Number(process.env.AUTO_TRAIN_INTERVAL_MS || 3600000);
  const intervalArg = (idx >= 0 && argv[idx + 1]) ? Number(argv[idx + 1]) : intervalEnv;
  const minDeltaAlerts = Number(process.env.AUTO_TRAIN_MIN_DELTA_ALERTS || 1);

  // Initial cycle always runs
  const before = readJsonSafe(STATE_PATH) || { last_alerts_count: 0, last_alerts_mtime: 0 };
  cycleOnce();
  if (once) return;

  log('Auto-train loop started', { interval_ms: intervalArg, min_delta_alerts: minDeltaAlerts });
  setInterval(() => {
    try {
      const prev = readJsonSafe(STATE_PATH) || before;
      const cur = readAlertsSignal();
      const deltaCount = Math.max(0, (cur.count || 0) - (prev.last_alerts_count || 0));
      const deltaMtime = Math.max(0, (cur.mtimeMs || 0) - (prev.last_alerts_mtime || 0));
      const shouldRun = (deltaCount >= minDeltaAlerts) || (deltaMtime > 0);
      log('tick', { deltaCount, deltaMtime, shouldRun });
      if (shouldRun) cycleOnce();
    } catch (e) {
      log('tick error', { error: e && e.message });
    }
  }, Math.max(60000, intervalArg)); // clamp to >= 60s
}

main();
