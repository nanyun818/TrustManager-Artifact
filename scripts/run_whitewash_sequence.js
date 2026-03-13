const { spawn } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, 'step_simulation_whitewash.js');
const START_LOOP = 109; // Assuming we continue from previous state
const TOTAL_LOOPS = 120; // Run until 120

// NOTE: We assume the simulation_state.json is currently around 100-105.
// If it's at 120 (from previous AI run), we might need to reset or continue from there.
// Ideally, we reset state to Loop 108 (Pre-Whitewash) to test the transition.
// But simpler is to just run from wherever we are.

function runStep(i) {
    if (i > TOTAL_LOOPS) {
        console.log('Whitewash Simulation Sequence Completed.');
        return;
    }
    console.log(`\n>>> Executing Sequence Step ${i}/${TOTAL_LOOPS}`);
    
    const child = spawn('node', [SCRIPT], { stdio: 'inherit', env: process.env, shell: true });
    
    child.on('close', (code) => {
        if (code === 0) {
            // Add slight delay to prevent nonce issues
            setTimeout(() => runStep(i + 1), 1000);
        } else {
            console.error(`Step ${i} failed with code ${code}`);
            process.exit(code);
        }
    });
}

// Start
runStep(START_LOOP);
