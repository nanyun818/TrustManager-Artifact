const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const outDir = path.join(process.cwd(), 'out');
const mergedPath = path.join(outDir, 'multichain_dataset.csv');

console.log('Scanning for labeled datasets in ' + outDir);

const files = ['labeled_mainnet.csv'];
console.log('Merging targeted files:', files);

let mergedContent = '';
let header = '';

for (const file of files) {
    const filePath = path.join(outDir, file);
    if (!fs.existsSync(filePath)) {
        console.warn(`Warning: ${file} not found, skipping.`);
        continue;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    if (lines.length === 0) continue;

    if (!header) {
        header = lines[0];
        mergedContent += header + ',chain\n';
    }

    const chainName = file.replace('labeled_', '').replace('.csv', '');
    console.log(`Merging ${chainName}: ${lines.length - 1} rows`);

    // Ensure we don't merge header lines if they appear in content (should be handled by skipping line 0)
    // But verify columns match header count? 
    // For now, just append.

    for (let i = 1; i < lines.length; i++) {
        mergedContent += `${lines[i]},${chainName}\n`;
    }
}

fs.writeFileSync(mergedPath, mergedContent);
console.log(`\nSuccessfully created ${mergedPath} with ${(mergedContent.match(/\n/g) || []).length} rows.`);

console.log('\nRunning Robustness Evaluation...');
const res = spawnSync('python', ['scripts/evaluate_robustness.py', '--input', mergedPath], { stdio: 'inherit' });
if (res.error) console.error(res.error);
