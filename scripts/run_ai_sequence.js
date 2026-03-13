const { spawn } = require('child_process');
const path = require('path');

const TOTAL_LOOPS = 20; // Run 20 more loops (e.g. 101-120)
const SCRIPT = path.join(__dirname, 'step_simulation_ai.js');

function runStep(i) {
    if (i > TOTAL_LOOPS) {
        console.log('AI Simulation Sequence Completed.');
        return;
    }

    console.log(`\n--- Starting Sequence ${i}/${TOTAL_LOOPS} ---`);
    const child = spawn('node', [SCRIPT], {
        stdio: 'inherit',
        env: process.env,
        shell: true
    });

    child.on('close', (code) => {
        if (code === 0) {
            runStep(i + 1);
        } else {
            console.error(`Step ${i} failed with code ${code}`);
        }
    });
}

runStep(1);
