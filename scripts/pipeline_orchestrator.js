// Robot Pipeline Orchestrator
// Steps: fetch -> normalize -> rules -> LLM explain -> light models -> archive -> response -> optional retrain
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config();

const rules = require('./rules_engine');
const model = require('./models_infer');
const llm = require('./llm_explain');

function parseArgs() {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const parts = a.split('=');
      const key = parts[0].replace(/^--/, '');
      if (parts.length > 1) {
        args[key] = parts.slice(1).join('=');
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[key] = argv[i + 1];
        i++; // consume value
      } else {
        args[key] = 'true';
      }
    }
  }
  // Robust flag detection
  args._raw = argv;
  args.hasFlag = (flag) => argv.includes(`--${flag}`);
  return args;
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const [headerLine, ...rows] = content.trim().split(/\r?\n/);
  const headers = headerLine.split(',');
  return rows.map(r => {
    const cols = r.split(',');
    const obj = {};
    headers.forEach((h, i) => (obj[h] = cols[i]));
    return obj;
  });
}

function writeCSV(filePath, rows) {
  if (!rows.length) return;
  // Collect all unique keys from all rows to ensure sparse fields (like 'unlimited') are included
  const allKeys = new Set();
  rows.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
  const headers = Array.from(allKeys).sort();
  
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => {
        let val = row[h];
        if (val === undefined || val === null) val = '';
        return String(val).replace(/,/g, ';');
    }).join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n'));
}

function generateDemo(count = 40000, chain = 'mainnet') {
  // Synthetic demo dataset resembling etherscan output
  // Chain profiles:
  // - mainnet: low failure (5%), high gas
  // - bsc: high failure (20%), low gas, spammy
  // - polygon: med failure (10%), med gas
  
  let failRate = 0.05;
  let gasBase = 21000;
  let gasRange = 200000;
  
  if (chain === 'bsc') { failRate = 0.20; gasBase = 21000; gasRange = 100000; }
  else if (chain === 'polygon') { failRate = 0.10; gasBase = 21000; gasRange = 150000; }

  const methods = ['swapExactTokensForTokens', 'swapExactETHForTokens', 'transfer', 'approve', 'exactInput'];
  const out = [];
  for (let i = 0; i < count; i++) {
    const m = methods[Math.floor(Math.random() * methods.length)];
    const failed = Math.random() < failRate; 
    const gas = gasBase + Math.floor(Math.random() * gasRange);
    const gasUsed = Math.floor(gas * (failed ? 0.98 : 0.75));
    const from = `0x${Math.random().toString(16).slice(2).padEnd(40, '0').slice(0,40)}`;
    const to = `0x${Math.random().toString(16).slice(2).padEnd(40, 'f').slice(0,40)}`;
    let input = '0x' + Math.random().toString(16).slice(2);
    
    // Inject Risk Pattern for "Label Correction" (ensure positives exist)
    const injectRisk = Math.random() < 0.05; // 5% explicit risk injection

    if (m === 'approve' || injectRisk) {
      // craft ERC20 approve(spender,value)
      const methodId = '095ea7b3';
      const spender = `000000000000000000000000${Math.random().toString(16).slice(2).padEnd(40,'1').slice(0,40)}`;
      // High risk: Unlimited + New Spender (simulated)
      const unlimited = injectRisk || Math.random() < 0.1;
      const valueHex = unlimited ? 'f'.repeat(64) : Math.floor(Math.random() * 1e12).toString(16).padStart(64, '0');
      input = '0x' + methodId + spender + valueHex;
    }
    out.push({
      txHash: `0x${Math.random().toString(16).slice(2).padEnd(64,'a').slice(0,64)}`,
      blockNumber: `${17000000 + Math.floor(Math.random() * 100000)}`,
      timeStamp: `${Math.floor(Date.now()/1000) - Math.floor(Math.random()*86400)}`,
      from,
      to,
      gas: `${gas}`,
      gasUsed: `${gasUsed}`,
      method: injectRisk ? 'approve' : m, // force method if risk injected
      status: failed ? '0' : '1',
      input
    });
  }
  return out;
}

function maybeFetch(args) {
  const outDir = path.join(process.cwd(), 'out');
  ensureDir(outDir);
  
  // Chain handling
  const chain = args.chain || 'mainnet';
  
  // Force demo if chain is not mainnet (simulation mode for extension)
  if (chain !== 'mainnet' && !args.apikey) {
      console.log(`Simulating ${chain} data (Demo Mode)...`);
      const demoRows = generateDemo(1000, chain);
      const csvPath = path.join(outDir, `etherscan_${chain}.csv`);
      writeCSV(csvPath, demoRows);
      return { source: `demo_${chain}`, csvPath };
  }

  // Fix: rely on explicit value check to avoid triggering on '--demo false'
  if (args.demo === 'true' || process.env.DEMO_MODE === '1') {
    const demoRows = generateDemo(40000, 'mainnet');
    const csvPath = path.join(outDir, 'etherscan_failures.csv');
    writeCSV(csvPath, demoRows);
    fs.writeFileSync(path.join(outDir, 'etherscan_failures.json'), JSON.stringify(demoRows, null, 2));
    return { source: 'demo', csvPath };
  }
  if ((args.hasFlag && args.hasFlag('noFetch')) || args.noFetch === 'true') {
    const csvPath = path.join(outDir, 'etherscan_failures.csv');
    return { source: 'existing', csvPath };
  }
  // Try to fetch via existing script
  const address = args.address || process.env.PIPELINE_ADDRESS;
  const network = args.network || process.env.ETHERSCAN_NETWORK || args.chain || 'mainnet';
  const start = args.start || process.env.PIPELINE_START || '';
  const end = args.end || process.env.PIPELINE_END || '';
  const apikey = args.apikey || process.env.ETHERSCAN_API_KEY || '';
  const limit = args.limit || process.env.PIPELINE_LIMIT || ''; // Add limit support
  const extra = [];
  if (address) extra.push('--address', address);
  if (network) extra.push('--network', network);
  if (start) extra.push('--start', start);
  if (end) extra.push('--end', end);
  if (apikey) extra.push('--apikey', apikey);
  if (limit) extra.push('--limit', limit);
  const res = spawnSync('node', ['scripts/fetch_etherscan.js', ...extra], { encoding: 'utf-8' });
  if (res.error) {
    console.error('Fetch script error:', res.error);
  } else {
    console.log(res.stdout);
    if (res.stderr) console.error(res.stderr);
  }
  const csvPath = path.join(outDir, 'etherscan_failures.csv');
  if (!fs.existsSync(csvPath)) {
    console.warn('⚠️  Fetch failed or returned no data. Returning empty set (Strict Mode: No Demo Fallback).');
    return { source: 'empty', csvPath: null };
  }
  return { source: 'etherscan', csvPath };
}

function normalize(rows) {
  if (!rows) return [];
  return rows.map(r => {
    const gas = Number(r.gas || 0);
    const gasUsed = Number(r.gasUsed || 0);
    const method = r.method || r.methodId || 'unknown';
    return {
      txHash: r.txHash,
      blockNumber: Number(r.blockNumber || 0),
      timeStamp: Number(r.timeStamp || 0),
      from: r.from,
      to: r.to,
      gas,
      gasUsed,
      gasRatio: gas > 0 ? gasUsed / gas : 0,
      method,
      status: String(r.status || '1'),
      input: r.input || ''
    };
  });
}

function archiveResults(rows, outDir) {
  ensureDir(outDir);
  const jsonPath = path.join(outDir, 'pipeline_results.json');
  const csvPath = path.join(outDir, 'pipeline_results.csv');
  fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2));
  writeCSV(csvPath, rows);
  return { jsonPath, csvPath };
}

async function main() {
  const args = parseArgs();
  const outDir = path.join(process.cwd(), 'out');
  ensureDir(outDir);

  // Step 1: Fetch raw chain data (or demo). Support preset batch mode.
  let raw = [];
  if (args.preset) {
    const presetsPath = path.join(process.cwd(), 'scripts', 'preset_targets.json');
    const name = args.preset;
    const presets = JSON.parse(fs.readFileSync(presetsPath, 'utf-8'))[name] || [];
    console.log(`Loaded preset '${name}' with ${presets.length} targets.`);
    for (const t of presets) {
      const { csvPath } = maybeFetch({
        address: t.address,
        network: args.network || process.env.ETHERSCAN_NETWORK || 'mainnet',
        start: args.start || t.start,
        end: args.end || t.end,
        apikey: args.apikey || process.env.ETHERSCAN_API_KEY || '',
          demo: args.demo,
          chain: args.chain, // pass chain
          limit: args.limit // pass limit
        });
        if (csvPath) {
            const rows = readCSV(csvPath).map(r => ({ ...r, target: t.label }));
            raw.push(...rows);
        }
      }
    } else {
      const { csvPath } = maybeFetch(args);
      if (!csvPath || !fs.existsSync(csvPath)) {
        console.error('❌ Pipeline input missing (Fetch failed and Demo disabled)');
        return;
      }
      const rows = readCSV(csvPath);
      raw.push(...rows);
  }

  // Inject Synthetic Risk (Label Correction Strategy)
  // Ensure at least 5% of data is high-risk for training stability
  if (process.env.INJECT_RISK !== 'false') {
      console.log('💉 Injecting synthetic risk patterns for label correction...');
      raw = raw.map(r => {
          if (Math.random() < 0.05) {
             // Mutate into a high-risk approval
              return {
                  ...r,
                  method: 'approve',
                  input: '0x095ea7b3' + '0'.repeat(24) + '1'.repeat(40) + 'f'.repeat(64), // unlimited approval to suspicious address
                  _injected: true
              };
           }
           return r;
       });
   }
 
   // Step 2: Normalize
   const normalized = normalize(raw).map((r, i) => ({ ...r, _injected: raw[i]._injected }));
 
   // Step 3: Rule-based pre-judgement & features
   let withRules = rules.applyRules(normalized);
   
   // FORCE RULE OVERRIDE for injected risk to ensure label correctness
   withRules = withRules.map(r => {
       if (r._injected) {
           return { ...r, unlimited: true, freshSpender: true, score: 0.95 };
       }
       return r;
   });

  // Step 4: LLM explanation (redacted & optional)
  const withExplanations = [];
  for (const tx of withRules) {
    const explanation = await llm.explain(tx);
    withExplanations.push({ ...tx, explanation });
  }

  // Step 5: Lightweight model inference
  const withScores = withExplanations.map(tx => {
    const score = model.riskScore(tx);
    const finalLabel = score >= (Number(process.env.RISK_THRESHOLD || 0.6)) ? 'high_risk' : 'normal';
    return { ...tx, riskScore: Number(score.toFixed(4)), finalLabel };
  });

  // Step 6: Archive & response
  const { jsonPath, csvPath: outCsv } = archiveResults(withScores, outDir);
  console.log('Pipeline results written:', jsonPath, outCsv);

  // Response: webhook or gated on-chain emit
  const webhook = process.env.RESPONSE_WEBHOOK_URL || '';
  if (webhook) {
    try {
      const payload = { timestamp: Date.now(), count: withScores.length, highRisk: withScores.filter(x=>x.finalLabel==='high_risk').length };
      // Lazy POST using https to avoid extra deps
      const https = require('https');
      const url = new URL(webhook);
      const req = https.request({ hostname: url.hostname, path: url.pathname+url.search, method: 'POST' }, res => {
        console.log('Webhook POST status:', res.statusCode);
      });
      req.on('error', err => console.error('Webhook error:', err.message));
      req.write(JSON.stringify(payload));
      req.end();
    } catch(e) { console.error('Webhook failed:', e.message); }
  }

  const allowEmit = process.env.ENABLE_CHAIN_WRITE === 'true';
  const requireApproval = process.env.REQUIRE_APPROVAL !== 'false';
  if (allowEmit) {
    console.log('Chain write requested but gated by policy. Manual/dual-sign approval required.');
    if (requireApproval) {
      console.log('Skipping on-chain emit until human approval is recorded.');
    }
  }

  // Step 7: Optional retrain trigger
  if (process.env.ENABLE_TRAINING === 'true') {
    const py = spawnSync('python', ['scripts/train_models.py', '--input', outCsv, '--output', path.join(process.cwd(), 'models', 'logreg.json')], { encoding: 'utf-8' });
    if (py.error) console.error('Training error:', py.error); else console.log(py.stdout);
  }
}

main().catch(e => {
  console.error('Pipeline failed:', e.message);
  process.exit(1);
});