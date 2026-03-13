const fs = require('fs');
const path = require('path');

function readCsv(p) {
  if (!fs.existsSync(p)) return [];
  const s = fs.readFileSync(p, 'utf8');
  const lines = s.split(/\r?\n/).filter((x) => x.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(',').map((x) => x.trim());
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const o = {};
    for (let j = 0; j < header.length; j++) o[header[j]] = (cols[j] || '').trim();
    out.push(o);
  }
  return out;
}

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function toFixed(n, d=2) {
  return Number(Number(n || 0).toFixed(d));
}

function buildTrustCurve(compRows) {
  const arr = compRows.map((r) => ({ address: r.address, delta: Number(r.delta_trust || 0) }));
  arr.sort((a,b) => a.address.localeCompare(b.address));
  return { addresses: arr.map((x) => x.address), delta_trust: arr.map((x) => x.delta) };
}

function summarizeBehavior(beh) {
  const failByMethod = {};
  const Rs = [], Ss = [], Ds = [], fails = [];
  for (const x of beh) {
    const m = String(x.fail_method_transfer || x.fail_method_swapExactETHForTokens || x.fail_method_swapExactTokensForTokens || x.fail_method_approve || '').trim();
    if (m) failByMethod[m] = (failByMethod[m] || 0) + 1;
    Rs.push(Number(x.R || 0));
    Ss.push(Number(x.S || 0));
    Ds.push(Number(x.D || 0));
    fails.push(Number(x.fail_count || 0));
  }
  const mean = (arr) => (arr.length ? arr.reduce((a,b) => a + b, 0) / arr.length : 0);
  const dist = Object.entries(failByMethod).map(([k,v]) => ({ method: k, count: v })).sort((a,b) => b.count - a.count);
  return {
    mean_R: toFixed(mean(Rs)),
    mean_S: toFixed(mean(Ss)),
    mean_D: toFixed(mean(Ds)),
    mean_fail_count: toFixed(mean(fails)),
    fail_method_distribution: dist
  };
}

function compareParams(betaComp, neighComp) {
  const parse = (rows) => {
    const deltas = rows.map((r) => Number(r.delta_trust || 0));
    const mean = deltas.length ? deltas.reduce((a,b) => a + b, 0) / deltas.length : 0;
    const pos = deltas.filter((d) => d > 0).length;
    const neg = deltas.filter((d) => d < 0).length;
    return { mean_delta_trust: toFixed(mean), positive_count: pos, negative_count: neg, sample_count: deltas.length };
  };
  return { exp_beta: parse(betaComp), exp_neigh: parse(neighComp) };
}

function strategyFromBehavior(beh) {
  const recs = [];
  for (const x of beh) {
    const addr = String(x.address || '').toLowerCase();
    const fail = Number(x.fail_count || 0);
    const R = Number(x.R || 0);
    const S = Number(x.S || 0);
    const D = Number(x.D || 0);
    if (fail >= 3 || x.fail_method_approve) {
      recs.push({ op: 'applyPenalty', address: addr, penalty_bp: 500 });
    }
    if (R >= 0.9 && S <= 0.1 && fail === 0) {
      const value = Math.max(0, Math.min(200, Math.round((1 - S) * 200)));
      recs.push({ op: 'addRecommendation', address: addr, value, weight: 10 });
    }
    if (R < 0.8 || fail >= 2) {
      const successRate = Math.max(0, Math.min(100, Math.round(R * 100)));
      const responseTime = 100;
      const onlineDelta = D > 0.9 ? 60 : 30;
      recs.push({ op: 'updateNodeMetrics', address: addr, successRate, responseTime, onlineDelta });
    }
  }
  return { recommendations: recs };
}

function main() {
  const ROOT = process.cwd();
  const OUT = path.join(ROOT, 'out');
  const betaPath = path.join(OUT, 'onchain_compare_top100_exp_beta.csv');
  const neighPath = path.join(OUT, 'onchain_compare_top100_exp_neigh.csv');
  const behPath = path.join(OUT, 'behavior_indicators.json');
  const betaComp = readCsv(betaPath);
  const neighComp = readCsv(neighPath);
  const beh = readJson(behPath) || [];
  const trustCurveBeta = buildTrustCurve(betaComp);
  const trustCurveNeigh = buildTrustCurve(neighComp);
  const behSummary = summarizeBehavior(beh);
  const paramSummary = compareParams(betaComp, neighComp);
  const strategy = strategyFromBehavior(beh);
  fs.writeFileSync(path.join(OUT, 'charts_trust_curve_exp_beta.json'), JSON.stringify(trustCurveBeta));
  fs.writeFileSync(path.join(OUT, 'charts_trust_curve_exp_neigh.json'), JSON.stringify(trustCurveNeigh));
  fs.writeFileSync(path.join(OUT, 'charts_risk_behavior.json'), JSON.stringify(behSummary));
  fs.writeFileSync(path.join(OUT, 'charts_param_compare.json'), JSON.stringify(paramSummary));
  fs.writeFileSync(path.join(OUT, 'strategy_recommendations.json'), JSON.stringify(strategy));
  process.stdout.write('OK\n');
}

main();
