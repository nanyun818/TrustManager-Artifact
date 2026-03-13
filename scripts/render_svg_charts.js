const fs = require('fs');
const path = require('path');

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function svgHeader(w, h) { return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`; }
function svgFooter() { return `</svg>`; }

function lineChart(values, opts={}) {
  const W = opts.width || 1000, H = opts.height || 360;
  const M = { l: 60, r: 20, t: 30, b: 40 };
  const x0 = M.l, y0 = M.t, w = W - M.l - M.r, h = H - M.t - M.b;
  const maxV = values.length ? Math.max(...values) : 1;
  const minV = values.length ? Math.min(...values) : 0;
  const span = maxV - minV || 1;
  const points = values.map((v, i) => {
    const x = x0 + (i * w) / Math.max(1, values.length - 1);
    const y = y0 + h - ((v - minV) * h) / span;
    return `${clamp(x, x0, x0 + w)},${clamp(y, y0, y0 + h)}`;
  });
  const pathD = points.length ? `M ${points[0]} ` + points.slice(1).map((p) => `L ${p}`).join(' ') : '';
  let out = svgHeader(W, H);
  out += `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="white" stroke="#999"/>`;
  if (pathD) out += `<path d="${pathD}" fill="none" stroke="#5470C6" stroke-width="2"/>`;
  out += `<text x="${x0}" y="${y0-10}" font-size="14" fill="#333">${opts.title||''}</text>`;
  const allZero = !values.length || values.every((v)=>Math.abs(v) < 1e-9);
  const note = opts.note || (allZero ? '该窗口内无变化（Delta≈0）' : '');
  if (note) {
    out += `<text x="${x0 + w/2}" y="${y0 + h/2}" font-size="12" fill="#888" text-anchor="middle">${note}</text>`;
  }
  out += svgFooter();
  return out;
}

function lineChartCompare(valuesA, valuesB, opts={}) {
  const W = opts.width || 1000, H = opts.height || 360;
  const M = { l: 60, r: 20, t: 30, b: 40 };
  const x0 = M.l, y0 = M.t, w = W - M.l - M.r, h = H - M.t - M.b;
  const n = Math.max(valuesA.length, valuesB.length);
  const all = valuesA.concat(valuesB);
  const maxV = all.length ? Math.max(...all) : 1;
  const minV = all.length ? Math.min(...all) : 0;
  const span = maxV - minV || 1;
  const pathFor = (vals) => {
    const pts = vals.map((v, i) => {
      const x = x0 + (i * w) / Math.max(1, n - 1);
      const y = y0 + h - ((v - minV) * h) / span;
      return `${clamp(x, x0, x0 + w)},${clamp(y, y0, y0 + h)}`;
    });
    return pts.length ? `M ${pts[0]} ` + pts.slice(1).map((p) => `L ${p}`).join(' ') : '';
  };
  const dA = pathFor(valuesA), dB = pathFor(valuesB);
  let out = svgHeader(W, H);
  out += `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="white" stroke="#999"/>`;
  if (dA) out += `<path d="${dA}" fill="none" stroke="#5470C6" stroke-width="2"/>`;
  if (dB) out += `<path d="${dB}" fill="none" stroke="#EE6666" stroke-width="2"/>`;
  out += `<text x="${x0}" y="${y0-10}" font-size="14" fill="#333">${opts.title||''}</text>`;
  const allZero = (!valuesA.length && !valuesB.length) || (valuesA.every((v)=>Math.abs(v) < 1e-9) && valuesB.every((v)=>Math.abs(v) < 1e-9));
  const note = opts.note || (allZero ? '该窗口内无变化（Delta≈0）' : '');
  if (note) {
    out += `<text x="${x0 + w/2}" y="${y0 + h/2}" font-size="12" fill="#888" text-anchor="middle">${note}</text>`;
  }
  out += svgFooter();
  return out;
}

function barChart(labels, values, opts={}) {
  const W = opts.width || 1000, H = opts.height || 360;
  const M = { l: 60, r: 20, t: 30, b: 60 };
  const x0 = M.l, y0 = M.t, w = W - M.l - M.r, h = H - M.t - M.b;
  const maxV = values.length ? Math.max(...values) : 1;
  const bw = w / Math.max(1, values.length);
  let out = svgHeader(W, H);
  out += `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="white" stroke="#999"/>`;
  values.forEach((v, i) => {
    const barH = h * (v / Math.max(1, maxV));
    const x = x0 + i * bw + bw*0.1;
    const y = y0 + h - barH;
    const wBar = bw * 0.8;
    out += `<rect x="${x}" y="${y}" width="${wBar}" height="${barH}" fill="#91CC75"/>`;
    if ((labels[i]||'').length && bw > 25) out += `<text x="${x + wBar/2}" y="${y0 + h + 18}" font-size="12" fill="#555" text-anchor="middle">${labels[i]}</text>`;
  });
  out += `<text x="${x0}" y="${y0-10}" font-size="14" fill="#333">${opts.title||''}</text>`;
  out += svgFooter();
  return out;
}

function groupedBars(labels, dataA, dataB, opts={}) {
  const W = opts.width || 1000, H = opts.height || 360;
  const M = { l: 60, r: 20, t: 30, b: 60 };
  const x0 = M.l, y0 = M.t, w = W - M.l - M.r, h = H - M.t - M.b;
  const maxV = Math.max(...dataA, ...dataB, 1);
  const bw = w / Math.max(1, labels.length);
  let out = svgHeader(W, H);
  out += `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="white" stroke="#999"/>`;
  labels.forEach((lab, i) => {
    const xBase = x0 + i * bw;
    const wBar = bw * 0.35;
    const draw = (val, color, offset) => {
      const barH = h * (val / maxV);
      const x = xBase + offset;
      const y = y0 + h - barH;
      out += `<rect x="${x}" y="${y}" width="${wBar}" height="${barH}" fill="${color}"/>`;
    };
    draw(dataA[i]||0, '#91CC75', bw*0.15);
    draw(dataB[i]||0, '#EE6666', bw*0.50);
    if ((lab||'').length && bw > 25) out += `<text x="${xBase + bw/2}" y="${y0 + h + 18}" font-size="12" fill="#555" text-anchor="middle">${lab}</text>`;
  });
  out += `<text x="${x0}" y="${y0-10}" font-size="14" fill="#333">${opts.title||''}</text>`;
  out += svgFooter();
  return out;
}

function save(p, svg) { fs.writeFileSync(p, svg); }

function main() {
  const ROOT = process.cwd();
  const OUT = path.join(ROOT, 'out');
  const tcBeta = readJson(path.join(OUT, 'charts_trust_curve_exp_beta.json')) || { addresses: [], delta_trust: [] };
  const tcNeigh = readJson(path.join(OUT, 'charts_trust_curve_exp_neigh.json')) || { addresses: [], delta_trust: [] };
  const beh = readJson(path.join(OUT, 'charts_risk_behavior.json')) || { fail_method_distribution: [] };
  const pc = readJson(path.join(OUT, 'charts_param_compare.json')) || { exp_beta: {}, exp_neigh: {} };

  const noteBeta = (!tcBeta.delta_trust?.length || tcBeta.delta_trust.every((v)=>Math.abs(v) < 1e-9)) ? '该窗口内无变化（Delta≈0）' : '';
  const noteNeigh = (!tcNeigh.delta_trust?.length || tcNeigh.delta_trust.every((v)=>Math.abs(v) < 1e-9)) ? '该窗口内无变化（Delta≈0）' : '';
  const svgBeta = lineChart(tcBeta.delta_trust, { title: 'Trust Delta (exp_beta)', note: noteBeta });
  const svgNeigh = lineChart(tcNeigh.delta_trust, { title: 'Trust Delta (exp_neigh)', note: noteNeigh });
  const svgComp = lineChartCompare(tcBeta.delta_trust, tcNeigh.delta_trust, { title: 'Trust Delta Comparison', note: (!noteBeta && !noteNeigh) ? '' : '该窗口内无变化（Delta≈0）' });
  const svgMeans = barChart(['R','S','D','fail_count'], [beh.mean_R||0, beh.mean_S||0, beh.mean_D||0, beh.mean_fail_count||0], { title: 'Behavior Means' });
  const dist = (beh.fail_method_distribution||[]).slice(0, 10);
  const totalFail = dist.reduce((s,d)=>s + (d.count||0), 0) || 1;
  const labelsFail = dist.map((d)=>`${d.method}${typeof d.count==='number' ? ` (${Math.round(100*(d.count/totalFail))}%)` : ''}`);
  const svgFail = barChart(labelsFail, dist.map((d)=>d.count||0), { title: 'Fail Method Distribution (Top 10, %)' });
  const svgCounts = groupedBars(['exp_beta','exp_neigh'], [pc.exp_beta?.positive_count||0, pc.exp_neigh?.positive_count||0], [pc.exp_beta?.negative_count||0, pc.exp_neigh?.negative_count||0], { title: 'Param Compare (Positive/Negative)' });
  const svgMean = barChart(['exp_beta','exp_neigh'], [pc.exp_beta?.mean_delta_trust||0, pc.exp_neigh?.mean_delta_trust||0], { title: 'Mean Delta Trust' });

  save(path.join(OUT, 'trust_curve_exp_beta.svg'), svgBeta);
  save(path.join(OUT, 'trust_curve_exp_neigh.svg'), svgNeigh);
  save(path.join(OUT, 'trust_curve_comparison.svg'), svgComp);
  save(path.join(OUT, 'behavior_means.svg'), svgMeans);
  save(path.join(OUT, 'fail_method_distribution.svg'), svgFail);
  save(path.join(OUT, 'param_compare_counts.svg'), svgCounts);
  save(path.join(OUT, 'param_compare_mean.svg'), svgMean);

  process.stdout.write('OK\n');
}

main();
