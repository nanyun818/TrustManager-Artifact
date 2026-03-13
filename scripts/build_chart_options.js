const fs = require('fs');
const path = require('path');

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj));
}

function echartsTrustCurve(addresses, values, title) {
  return {
    title: { text: title },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: addresses },
    yAxis: { type: 'value', name: 'delta_trust' },
    series: [{ name: 'delta_trust', type: 'line', data: values, smooth: true }]
  };
}

function echartsTrustCurveCompare(addrA, valA, addrB, valB) {
  const addrs = addrA.length >= addrB.length ? addrA : addrB;
  return {
    title: { text: 'Trust Delta Comparison' },
    tooltip: { trigger: 'axis' },
    legend: { data: ['exp_beta','exp_neigh'] },
    xAxis: { type: 'category', data: addrs },
    yAxis: { type: 'value', name: 'delta_trust' },
    series: [
      { name: 'exp_beta', type: 'line', data: valA, smooth: true },
      { name: 'exp_neigh', type: 'line', data: valB, smooth: true }
    ]
  };
}

function echartsBehaviorMeans(m) {
  const cats = ['R','S','D','fail_count'];
  const vals = [m.mean_R, m.mean_S, m.mean_D, m.mean_fail_count];
  return {
    title: { text: 'Behavior Means' },
    tooltip: {},
    xAxis: { type: 'category', data: cats },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: vals }]
  };
}

function echartsFailMethodDist(dist) {
  const cats = dist.map((d) => d.method);
  const vals = dist.map((d) => d.count);
  return {
    title: { text: 'Fail Method Distribution' },
    tooltip: {},
    xAxis: { type: 'category', data: cats },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: vals }]
  };
}

function echartsParamCompareCounts(pc) {
  const cats = ['exp_beta','exp_neigh'];
  const pos = [pc.exp_beta.positive_count, pc.exp_neigh.positive_count];
  const neg = [pc.exp_beta.negative_count, pc.exp_neigh.negative_count];
  return {
    title: { text: 'Param Compare (Positive/Negative)' },
    tooltip: { trigger: 'axis' },
    legend: { data: ['positive','negative'] },
    xAxis: { type: 'category', data: cats },
    yAxis: { type: 'value' },
    series: [
      { name: 'positive', type: 'bar', data: pos },
      { name: 'negative', type: 'bar', data: neg }
    ]
  };
}

function echartsParamCompareMean(pc) {
  const cats = ['exp_beta','exp_neigh'];
  const vals = [pc.exp_beta.mean_delta_trust, pc.exp_neigh.mean_delta_trust];
  return {
    title: { text: 'Mean Delta Trust' },
    tooltip: {},
    xAxis: { type: 'category', data: cats },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: vals }]
  };
}

function chartjsLine(addresses, values, label) {
  return {
    type: 'line',
    data: { labels: addresses, datasets: [{ label, data: values, borderColor: '#5470C6', tension: 0.3 }] },
    options: { scales: { y: { title: { display: true, text: 'delta_trust' } } }, plugins: { legend: { display: true } } }
  };
}

function chartjsBar(labels, dataA, dataB, labelA, labelB, title) {
  return {
    type: 'bar',
    data: { labels, datasets: [
      { label: labelA, data: dataA, backgroundColor: '#91CC75' },
      { label: labelB, data: dataB, backgroundColor: '#EE6666' }
    ] },
    options: { plugins: { title: { display: true, text: title } }, responsive: true }
  };
}

function main() {
  const ROOT = process.cwd();
  const OUT = path.join(ROOT, 'out');
  const beta = readJson(path.join(OUT, 'charts_trust_curve_exp_beta.json')) || { addresses: [], delta_trust: [] };
  const neigh = readJson(path.join(OUT, 'charts_trust_curve_exp_neigh.json')) || { addresses: [], delta_trust: [] };
  const beh = readJson(path.join(OUT, 'charts_risk_behavior.json')) || { fail_method_distribution: [] };
  const pc = readJson(path.join(OUT, 'charts_param_compare.json')) || { exp_beta: {}, exp_neigh: {} };
  const behRaw = readJson(path.join(OUT, 'behavior_indicators.json')) || [];
  const compBeta = (readJson(path.join(OUT, 'charts_trust_curve_exp_beta.json')) || { addresses: [], delta_trust: [] });

  const e_beta = echartsTrustCurve(beta.addresses, beta.delta_trust, 'Trust Delta (exp_beta)');
  const e_neigh = echartsTrustCurve(neigh.addresses, neigh.delta_trust, 'Trust Delta (exp_neigh)');
  const e_comp = echartsTrustCurveCompare(beta.addresses, beta.delta_trust, neigh.addresses, neigh.delta_trust);
  const e_means = echartsBehaviorMeans(beh);
  const e_fail = echartsFailMethodDist(beh.fail_method_distribution || []);
  const e_counts = echartsParamCompareCounts(pc);
  const e_mean = echartsParamCompareMean(pc);

  writeJson(path.join(OUT, 'echarts_trust_curve_exp_beta_options.json'), e_beta);
  writeJson(path.join(OUT, 'echarts_trust_curve_exp_neigh_options.json'), e_neigh);
  writeJson(path.join(OUT, 'echarts_trust_curve_comparison_options.json'), e_comp);
  writeJson(path.join(OUT, 'echarts_behavior_means_options.json'), e_means);
  writeJson(path.join(OUT, 'echarts_fail_method_distribution_options.json'), e_fail);
  writeJson(path.join(OUT, 'echarts_param_compare_counts_options.json'), e_counts);
  writeJson(path.join(OUT, 'echarts_param_compare_mean_options.json'), e_mean);

  const cj_beta = chartjsLine(beta.addresses, beta.delta_trust, 'exp_beta');
  const cj_neigh = chartjsLine(neigh.addresses, neigh.delta_trust, 'exp_neigh');
  const cj_counts = chartjsBar(['exp_beta','exp_neigh'], [pc.exp_beta.positive_count||0, pc.exp_neigh.positive_count||0], [pc.exp_beta.negative_count||0, pc.exp_neigh.negative_count||0], 'positive','negative','Param Compare (Positive/Negative)');
  const cj_mean = chartjsBar(['exp_beta','exp_neigh'], [pc.exp_beta.mean_delta_trust||0], [pc.exp_neigh.mean_delta_trust||0], 'mean_delta_exp_beta','mean_delta_exp_neigh','Mean Delta Trust');

  writeJson(path.join(OUT, 'chartjs_trust_curve_exp_beta_options.json'), cj_beta);
  writeJson(path.join(OUT, 'chartjs_trust_curve_exp_neigh_options.json'), cj_neigh);
  writeJson(path.join(OUT, 'chartjs_param_compare_counts_options.json'), cj_counts);
  writeJson(path.join(OUT, 'chartjs_param_compare_mean_options.json'), cj_mean);

  const addrToDelta = {};
  (compBeta.addresses||[]).forEach((a, i) => { addrToDelta[String(a).toLowerCase()] = compBeta.delta_trust[i] || 0; });
  const groups = {
    blacklist: new Set(),
    approval_anomaly: new Set(),
    fanout_large: new Set(),
    transfer_spike: new Set(),
    bridge_contact: new Set(),
    price_manip: new Set()
  };
  for (const x of (behRaw||[])) {
    const a = String(x.address||x.addr||'').toLowerCase();
    if (!a) continue;
    if (Number(x.blacklist_contact_count||0) + Number(x.blacklist_transfer_count||0) > 0) groups.blacklist.add(a);
    if (Number(x.approval_anomaly_count||0) > 0) groups.approval_anomaly.add(a);
    if (Number(x.fanout_suspect_count||0) + Number(x.large_transfer_count||0) > 0) groups.fanout_large.add(a);
    if (Number(x.transfer_density_spike_count||0) > 0) groups.transfer_spike.add(a);
    if (Number(x.bridge_contact_count||0) > 0) groups.bridge_contact.add(a);
    if (Number(x.price_manip_suspect_count||0) > 0) groups.price_manip.add(a);
  }
  const labels = Object.keys(groups);
  const means = labels.map((g) => {
    const arr = Array.from(groups[g]).map((a) => Number(addrToDelta[a]||0)).filter((v)=>Number.isFinite(v));
    const m = arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : 0;
    return Number(m.toFixed(4));
  });
  const e_delta_beh = {
    title: { text: 'Delta Trust by Behavior' },
    tooltip: {},
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: means }]
  };
  writeJson(path.join(OUT, 'echarts_delta_by_behavior_options.json'), e_delta_beh);

  process.stdout.write('OK\n');
}

main();
