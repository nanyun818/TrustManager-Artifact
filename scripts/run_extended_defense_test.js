const { spawn } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, 'step_simulation_whitewash.js');
const START_LOOP = 110;
const END_LOOP = 120;

function runStep(i) {
    if (i > END_LOOP) {
        console.log('✅ Defense Test Sequence Completed.');
        return;
    }
    console.log(`\n>>> 🚀 Executing Simulation Step ${i}/${END_LOOP}`);
    
    // We pass the loop index implicitly via the state file which increments it.
    // Wait, step_simulation_whitewash.js reads state.loop and sets currentLoop = state.loop + 1.
    // So if state.loop is 109, it runs 110.
    
    const child = spawn('node', [SCRIPT], { stdio: 'inherit', shell: true });
    
    child.on('close', (code) => {
        if (code === 0) {
            setTimeout(() => runStep(i + 1), 500);
        } else {
            console.error(`❌ Step ${i} failed with code ${code}`);
            process.exit(code);
        }
    });
}

runStep(START_LOOP);
