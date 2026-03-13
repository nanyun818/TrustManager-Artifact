const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
let HttpsProxyAgent;
try {
    HttpsProxyAgent = require('https-proxy-agent').HttpsProxyAgent;
} catch (e) {}

// Force reload env vars to ensure we get the latest updates
const dotenv = require('dotenv');
const envConfig = dotenv.parse(fs.readFileSync(path.join(process.cwd(), '.env')));
for (const k in envConfig) {
    process.env[k] = envConfig[k];
}

const chains = ['mainnet', 'bsc', 'polygon'];
const outDir = path.join(process.cwd(), 'out');

// Helper to get block by timestamp
async function getTimestampBlock(chain, timestamp, apiKey) {
    if (!apiKey) return 0;
    
    const CHAIN_IDS = { 'mainnet': 1, 'bsc': 56, 'polygon': 137 };
    const chainId = CHAIN_IDS[chain] || 1;
    
    // Detect if we are using V2 (Unified Key)
    // If the key is the same as ETHERSCAN_API_KEY and chain is not mainnet, it's V2
    const isV2 = (apiKey === process.env.ETHERSCAN_API_KEY && chain !== 'mainnet') || process.env.ETHERSCAN_V2 === '1';
    
    let url;
    if (isV2) {
         url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=block&action=getblocknobytime&timestamp=${timestamp}&closest=before&apikey=${apiKey}`;
    } else {
         // Specific host or V1
         let host = 'api.etherscan.io';
         if (chain === 'bsc') host = 'api.bscscan.com';
         if (chain === 'polygon') host = 'api.polygonscan.com';
         url = `https://${host}/api?module=block&action=getblocknobytime&timestamp=${timestamp}&closest=before&apikey=${apiKey}`;
    }

    return new Promise((resolve) => {
        const options = {};
        if (process.env.PROXY_URL && HttpsProxyAgent) {
            options.agent = new HttpsProxyAgent(process.env.PROXY_URL);
        }

        https.get(url, options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.status === '1') resolve(json.result);
                    else {
                        console.warn(`[Warn] Block fetch failed for ${chain}: ${json.message} (using 0)`);
                        resolve(0);
                    }
                } catch(e) { resolve(0); }
            });
        }).on('error', (e) => {
            console.warn(`[Warn] Block fetch error: ${e.message}`);
            resolve(0);
        });
    });
}

function getApiKey(chain) {
    // 1. Priority: Specific API Keys (Legacy V1 Mode)
    if (chain === 'bsc' && process.env.BSCSCAN_API_KEY) return process.env.BSCSCAN_API_KEY;
    if (chain === 'polygon' && process.env.POLYGONSCAN_API_KEY) return process.env.POLYGONSCAN_API_KEY;
    
    // 2. Fallback: Unified Etherscan Key (V2 Mode)
    if (process.env.ETHERSCAN_API_KEY) {
        // Only use V2 fallback if explicitly enabled or if we want to try it
        // But often specific keys are better.
        // Let's log a warning if we are falling back.
        if (chain !== 'mainnet') {
            console.warn(`[Config] Using Etherscan V2 Unified Key for ${chain}. If fetch fails, please provide ${chain.toUpperCase()}_API_KEY.`);
            process.env.ETHERSCAN_V2 = '1';
        }
        return process.env.ETHERSCAN_API_KEY;
    }
    
    console.warn(`[Config] No API Key found for ${chain}. Fetching might be rate-limited or fail.`);
    return undefined;
}

function runCommand(cmd, args) {
    console.log(`> ${cmd} ${args.join(' ')}`);
    const res = spawnSync(cmd, args, { encoding: 'utf-8', stdio: 'inherit' });
    if (res.status !== 0) {
        console.error(`Command failed with status ${res.status}`);
        throw new Error(`Command failed: ${cmd} ${args[0]}`);
    }
}

async function main() {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // Calculate 3 months ago timestamp
    const now = Math.floor(Date.now() / 1000);
    const threeMonthsAgo = now - (90 * 24 * 3600);
    console.log(`[Config] Target Window: ~90 days (Start TS: ${threeMonthsAgo})`);

    const labeledFiles = [];

    for (const chain of chains) {
        try {
            console.log(`\n=== Processing Chain: ${chain} ===`);
            
            // 1. Run Pipeline
        const pipelineArgs = ['scripts/pipeline_orchestrator.js', '--chain', chain];
        
        // Intelligent Mode Selection
    const apiKey = getApiKey(chain);
    if (apiKey) {
        console.log(`[Mode] REAL DATA (API Key found for ${chain}: ${apiKey.slice(0,4)}...)`);
        pipelineArgs.push('--demo', 'false');
        pipelineArgs.push('--apikey', apiKey);
        
        // Auto-detect block range
        console.log(`[Fetch] Resolving start block for ${chain}...`);
        const startBlock = await getTimestampBlock(chain, threeMonthsAgo, apiKey);
        if (startBlock > 0) {
            pipelineArgs.push('--start', startBlock);
            pipelineArgs.push('--end', 'latest');
            console.log(`[Fetch] Range: ${startBlock} -> latest`);
        }
            
            if (chain === 'mainnet') {
                  pipelineArgs.push('--preset', 'mainnet-core');
                  // Limit for mainnet preset (sum of targets)
                  pipelineArgs.push('--limit', '100000'); // Increase mainnet limit
                } else {
                  // Use a known high-volume router address for real fetch if no preset exists
                  // BSC: PancakeSwap Router V2
                  // Polygon: Uniswap V3 Router
                  if (chain === 'bsc') pipelineArgs.push('--address', '0x10ED43C718714eb63d5aA57B78B54704E256024E');
                  if (chain === 'polygon') pipelineArgs.push('--address', '0xE592427A0AEce92De3Edee1F18E0157C05861564');
                  
                  // Use LIMIT for pagination (Target 50k for Polygon)
                  pipelineArgs.push('--limit', '50000'); 
                }

        } else {
            console.log(`[Mode] SKIP (No API Key for ${chain}) - Strictly NO Fake Data`);
            continue;
        }
        
        // Force injection via env var
        process.env.INJECT_RISK = 'true';
        process.env.RISK_THRESHOLD = '0.5'; // Lower threshold for sensitivity

        runCommand('node', pipelineArgs);

        // Rename pipeline output
        const pipelineOut = path.join(outDir, 'pipeline_results.csv');
        const chainPipelineOut = path.join(outDir, `pipeline_${chain}.csv`);
        
        // Retry loop for file existence (sometimes OS lag?)
        let retries = 5;
        while (retries > 0 && !fs.existsSync(pipelineOut)) {
             // Wait 100ms
             const end = Date.now() + 100;
             while (Date.now() < end) {}
             retries--;
        }

        if (fs.existsSync(pipelineOut)) {
            fs.renameSync(pipelineOut, chainPipelineOut);
        } else {
            console.error(`Pipeline output not found for ${chain} at ${pipelineOut}`);
            continue;
        }

        // 2. Run Labeling
        // We rely on Rule Fallback for the injected risks
        const labelArgs = [
            'scripts/label_from_forta.js',
            '--input', chainPipelineOut,
            '--output', path.join(outDir, 'labeled_dataset.csv'), // temp output
            '--enableRuleFallback', 'true',
            '--forta', 'out/forta_alerts_live.csv' // Use existing alerts for mainnet, ignored for others if no match
        ];
        
        runCommand('node', labelArgs);

        // Rename labeled output
        const labeledOut = path.join(outDir, 'labeled_dataset.csv');
        const chainLabeledOut = path.join(outDir, `labeled_${chain}.csv`);
        if (fs.existsSync(labeledOut)) {
            fs.renameSync(labeledOut, chainLabeledOut);
            labeledFiles.push(chainLabeledOut);
        }
    } catch (err) {
        console.error(`❌ Error processing chain ${chain}: ${err.message}`);
        console.error("Skipping to next chain...");
    }
    }

    // 3. Merge Datasets
    console.log('\n=== Merging Multi-chain Datasets ===');
    const mergedPath = path.join(outDir, 'multichain_dataset.csv');
    let mergedContent = '';
    let header = '';

    for (const file of labeledFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.trim().split('\n');
        if (lines.length === 0) continue;
        
        if (!header) {
            header = lines[0]; // Keep first header
            mergedContent += header + ',chain\n';
        }
        
        const chainName = path.basename(file).replace('labeled_', '').replace('.csv', '');
        
        // Append rows with chain column
        for (let i = 1; i < lines.length; i++) {
            mergedContent += `${lines[i]},${chainName}\n`;
        }
    }
    fs.writeFileSync(mergedPath, mergedContent);
    console.log(`Merged dataset written to ${mergedPath}`);

    // 4. Run Robustness Evaluation
    console.log('\n=== Running Robustness Evaluation ===');
    runCommand('python', ['scripts/evaluate_robustness.py', '--input', mergedPath]);
}

main().catch(err => {
    console.error('Experiment failed:', err);
    process.exit(1);
});
