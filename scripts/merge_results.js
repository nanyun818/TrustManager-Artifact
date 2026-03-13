const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const outDir = path.join(__dirname, '..', 'out');
const chains = ['mainnet', 'polygon', 'bsc'];
const mergedPath = path.join(outDir, 'multichain_dataset.csv');

console.log('=== Merging Datasets ===');

let mergedContent = '';
let header = '';
let totalRows = 0;

for (const chain of chains) {
    // Try pipeline_{chain}.csv first, as that's the raw output from orchestrator
    // If orchestrator produces labeled data, we use that.
    const file = path.join(outDir, `pipeline_${chain}.csv`);
    
    if (!fs.existsSync(file)) {
        console.log(`Skipping ${chain} (file not found: ${file})`);
        continue;
    }

    console.log(`Processing ${chain}...`);
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.trim().split('\n');
    
    if (lines.length <= 1) {
        console.log(`Skipping ${chain} (empty or header only)`);
        continue;
    }

    if (!header) {
        header = lines[0];
        mergedContent += header + ',chain\n';
    }

    // Validate header match (optional, but good practice)
    // For now assume consistent schema from pipeline_orchestrator

    const dataLines = lines.slice(1);
    const headerCols = header.split(',');
    
    // Find indices for injection
    const idxMethod = headerCols.indexOf('method');
    const idxInput = headerCols.indexOf('input');
    const idxUnlimited = headerCols.indexOf('unlimited');
    const idxFresh = headerCols.indexOf('freshSpender');
    const idxScore = headerCols.indexOf('score');
    const idxRiskScore = headerCols.indexOf('riskScore');
    const idxFinalLabel = headerCols.indexOf('finalLabel');
    const idxInjected = headerCols.indexOf('_injected');
    const idxGasRatio = headerCols.indexOf('gasRatio'); // Find GasRatio column

    for (const line of dataLines) {
        if (!line.trim()) continue;
        
        // Simple CSV parse respecting quotes
        let cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        
        // Safety check for parse error
        if (cols.length !== headerCols.length) {
            // console.warn(`Skipping malformed line in ${chain}`);
            // Fallback: just append original if parse fails (rare)
            mergedContent += `${line},${chain}\n`;
            totalRows++;
            continue;
        }

        // === Improved Synthetic Injection Strategy v2 (Deep Non-Linearity) ===
        const rand = Math.random();

        // 1. Obvious Attack (Reentrancy/Rug Pull) - 2.5%
        // High Gas + Unlimited + Fresh
        if (rand < 0.025) {
             if (idxMethod >= 0) cols[idxMethod] = '0x095ea7b3'; 
             if (idxInput >= 0) cols[idxInput] = '0x095ea7b3' + '0'.repeat(24) + '1'.repeat(40) + 'f'.repeat(64);
             if (idxUnlimited >= 0) cols[idxUnlimited] = 'true';
             if (idxFresh >= 0) cols[idxFresh] = 'true';
             if (idxScore >= 0) cols[idxScore] = (0.90 + Math.random() * 0.1).toFixed(2);
             if (idxRiskScore >= 0) cols[idxRiskScore] = (0.90 + Math.random() * 0.1).toFixed(2);
             if (idxFinalLabel >= 0) cols[idxFinalLabel] = 'high_risk';
             if (idxInjected >= 0) cols[idxInjected] = 'true';
             if (idxGasRatio >= 0) cols[idxGasRatio] = (0.85 + Math.random() * 0.15).toFixed(4);
        }
        // 2. Stealthy Attack (Phishing Approval) - 2.5%
        // Low Gas (Standard) + Unlimited + Fresh
        // Crucial: GasRatio is LOW here, so model MUST rely on Unlimited/Fresh
        else if (rand < 0.05) {
             if (idxMethod >= 0) cols[idxMethod] = '0x095ea7b3'; 
             if (idxUnlimited >= 0) cols[idxUnlimited] = 'true';
             if (idxFresh >= 0) cols[idxFresh] = 'true';
             if (idxScore >= 0) cols[idxScore] = (0.85 + Math.random() * 0.1).toFixed(2);
             if (idxRiskScore >= 0) cols[idxRiskScore] = (0.85 + Math.random() * 0.1).toFixed(2);
             if (idxFinalLabel >= 0) cols[idxFinalLabel] = 'high_risk';
             if (idxInjected >= 0) cols[idxInjected] = 'true';
             if (idxGasRatio >= 0) cols[idxGasRatio] = (0.1 + Math.random() * 0.2).toFixed(4); // Normal Gas
        }
        // 3. Benign High-Gas Transaction (Complex DeFi) - 2.0%
        // High Gas + Limited/Trusted
        // Crucial: GasRatio is HIGH, but it's BENIGN.
        else if (rand < 0.07) {
             if (idxUnlimited >= 0) cols[idxUnlimited] = 'false';
             if (idxFresh >= 0) cols[idxFresh] = 'false'; // Trusted Spender
             if (idxScore >= 0) cols[idxScore] = (0.1 + Math.random() * 0.2).toFixed(2);
             if (idxRiskScore >= 0) cols[idxRiskScore] = (0.1 + Math.random() * 0.2).toFixed(2);
             if (idxFinalLabel >= 0) cols[idxFinalLabel] = 'low_risk';
             if (idxInjected >= 0) cols[idxInjected] = 'false';
             if (idxGasRatio >= 0) cols[idxGasRatio] = (0.80 + Math.random() * 0.19).toFixed(4); // High Gas
        }

        // Reconstruct line with proper escaping
        const escapedCols = cols.map(c => {
            if (c && (c.includes(',') || c.includes('"') || c.includes('\n'))) {
                return `"${c.replace(/"/g, '""')}"`;
            }
            return c;
        });

        mergedContent += `${escapedCols.join(',')},${chain}\n`;
        totalRows++;
    }
    console.log(`  -> Added ${dataLines.length} rows from ${chain} (with ~5% synthetic risk injection)`);
}

fs.writeFileSync(mergedPath, mergedContent);
console.log(`\nMerged dataset written to ${mergedPath}`);
console.log(`Total Rows: ${totalRows}`);

console.log('\n=== Running Robustness Evaluation ===');
try {
    execSync(`python scripts/evaluate_robustness.py --input "${mergedPath}"`, { stdio: 'inherit' });
} catch (e) {
    console.error('Robustness evaluation failed:', e.message);
}
