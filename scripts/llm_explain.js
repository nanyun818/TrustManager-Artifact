// LLM explanation with redaction and graceful fallback
const https = require('https');

function redact(tx) {
  // Remove direct addresses if required; keep minimal context
  return {
    method: tx.method,
    status: tx.status,
    features: tx.features,
    ruleHits: tx.ruleHits,
    // Keep hash shortened for reference without full linkage
    txRef: tx.txHash ? tx.txHash.slice(0, 10) + '...' : 'unknown'
  };
}

function postJSON(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data }));
      });
      req.on('error', reject);
      req.write(JSON.stringify(body));
      req.end();
    } catch (e) { reject(e); }
  });
}

async function explain(tx) {
  const apiUrl = process.env.LLM_API_URL || '';
  const apiKey = process.env.LLM_API_KEY || '';
  const payload = redact(tx);

  if (apiUrl && apiKey) {
    try {
      const res = await postJSON(apiUrl, { prompt: `为以下链上交易生成风险解释: ${JSON.stringify(payload)}` }, { Authorization: `Bearer ${apiKey}` });
      if (res.status >= 200 && res.status < 300 && res.data) return res.data.slice(0, 2000);
    } catch (e) {
      // Fall through to template
    }
  }
  // Fallback template based on rule hits
  const hits = (tx.ruleHits || []).join(', ');
  const base = `交易(${payload.txRef}) 方法(${payload.method}) 规则命中: [${hits}]。`;
  if ((tx.features || {}).approveToUnusual) {
    return base + ' 该交易包含对非常用合约的授权，存在潜在钓鱼或误授权风险。';
  }
  if ((tx.features || {}).isSwap && (tx.features || {}).failed) {
    return base + ' 失败的交换操作，可能由于滑点/额度不足/截止时间过期。';
  }
  if ((tx.features || {}).freqNorm > 0.6) {
    return base + ' 高频交互行为，疑似机器人或批量脚本。请结合资金流进一步确认。';
  }
  return base + ' 风险较低或信息不足，建议持续监控。';
}

module.exports = { explain };