const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SCRIPT = path.join(__dirname, 'step_simulation_whitewash.js');
const HISTORY_FILE = path.join(__dirname, '../out/trust_trend.csv');
const START_LOOP = 101;
const END_LOOP = 120;

// Initialize History File
if (!fs.existsSync(path.dirname(HISTORY_FILE))) {
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
}
fs.writeFileSync(HISTORY_FILE, 'loop,address,group,trustValue,isBlacklisted\n');

function runStep(i) {
    if (i > END_LOOP) {
        console.log('✅ Large Scale Simulation Sequence Completed.');
        return;
    }
    console.log(`\n>>> 🚀 Executing Large Scale Simulation Step ${i}/${END_LOOP}`);
    
    // The step script reads state.loop and increments it.
    // Ensure state.loop is i-1 before running.
    // Since we run sequentially, it should naturally follow.
    
    const child = spawn('node', [SCRIPT], { stdio: 'inherit', shell: true });
    
    child.on('close', (code) => {
        if (code === 0) {
            // Add a small delay to avoid FS contention
            setTimeout(() => runStep(i + 1), 200);
        } else {
            console.error(`❌ Step ${i} failed with code ${code}`);
            process.exit(code);
        }
    });
}

runStep(START_LOOP);
