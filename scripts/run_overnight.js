const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Configuration
const DURATION_HOURS = 3.5; // Adjusted to finish around 22:00 (matching original schedule)
const DURATION_MS = DURATION_HOURS * 60 * 60 * 1000;
const START_TIME = Date.now();
const END_TIME = START_TIME + DURATION_MS;

const AI_BRIDGE_SCRIPT = path.join(__dirname, 'ai_oracle_bridge.js');
const SCRIPT = path.join(__dirname, 'step_simulation.js');
const HISTORY_FILE = path.join(__dirname, '../out/trust_trend_overnight.csv');
const STATE_FILE = path.join(__dirname, 'simulation_state.json');

// Read existing state to sync loop count
let loopCount = 0;
if (fs.existsSync(STATE_FILE)) {
    try {
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        if (state.loop) {
            loopCount = state.loop;
            console.log(`Resuming from Loop ${loopCount}...`);
        }
    } catch (e) {
        console.error("Error reading state file:", e.message);
    }
}

function runStep() {
    const now = Date.now();
    if (now >= END_TIME) {
        console.log('✅ Overnight Simulation Completed (12 Hours).');
        console.log(`Total Loops: ${loopCount}`);
        return;
    }

    const remaining = (END_TIME - now) / 1000 / 60; // minutes
    console.log(`\n>>> 🌙 Overnight Test | Loop ${loopCount + 1} | Remaining: ${remaining.toFixed(1)} mins`);

    const child = spawn('node', [SCRIPT], { stdio: 'inherit', shell: true });

    // Timeout protection: Kill step if it takes too long (e.g., 5 minutes)
    const timeout = setTimeout(() => {
        console.error('⚠️ Step timed out (>5 mins). Killing process and retrying...');
        child.kill(); 
    }, 5 * 60 * 1000);

    child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
            loopCount++;
            
            // --- NEW: Trigger AI Oracle every 5 loops ---
            if (loopCount % 5 === 0) {
                console.log("🤖 Triggering AI Oracle Bridge...");
                const aiChild = spawn('node', [AI_BRIDGE_SCRIPT], { stdio: 'inherit', shell: true });
                aiChild.on('close', () => {
                     setTimeout(runStep, 5000);
                });
            } else {
                setTimeout(runStep, 5000);
            }
        } else {
            console.error(`❌ Step failed with code ${code}. Retrying in 10s...`);
            setTimeout(runStep, 10000);
        }
    });
}

console.log(`Starting 12-Hour Stability Test...`);
console.log(`Ends at: ${new Date(END_TIME).toLocaleString()}`);
runStep();
