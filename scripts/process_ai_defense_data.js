const fs = require('fs');
const path = require('path');

// Configuration
const OUT_DIR = path.join(__dirname, '../out');
const STATE_FILE = path.join(__dirname, 'simulation_state.json');

// Simulation Parameters
const DETECTION_LOOP = 50; // AI detects attack at Loop 50
const PENALTY_FACTOR = 0.3; // Trust reduced to 30%

function readCsv(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    const header = lines[0].split(',');
    return lines.slice(1).map(line => {
        const vals = line.split(',');
        const obj = {};
        header.forEach((h, i) => obj[h] = vals[i]);
        return obj;
    });
}

function main() {
    // 1. Get Node Groups
    if (!fs.existsSync(STATE_FILE)) {
        console.error("State file not found");
        return;
    }
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const collusionNodes = state.groups.collusion;
    const honestNodes = state.groups.honest;

    // 2. Process Loops
    const series = [];
    
    // We have data for loops 10, 20, ..., 100 (based on previous steps)
    // Also Loop 0 if available, but let's stick to the interval 10
    for (let loop = 10; loop <= 100; loop += 10) {
        const filename = `onchain_call_params_top50_ext_sim_loop_${loop}.csv`;
        const filePath = path.join(OUT_DIR, filename);
        
        const data = readCsv(filePath);
        if (!data) {
            console.warn(`Skipping missing data for loop ${loop}`);
            continue;
        }

        // Calculate Averages
        let honestSum = 0, honestCount = 0;
        let collOriginalSum = 0, collCount = 0;

        data.forEach(row => {
            const addr = row.address;
            const trust = parseFloat(row.trustValue);

            if (honestNodes.includes(addr)) {
                honestSum += trust;
                honestCount++;
            } else if (collusionNodes.includes(addr)) {
                collOriginalSum += trust;
                collCount++;
            }
        });

        const honestAvg = honestCount ? (honestSum / honestCount) : 0;
        const collOriginalAvg = collCount ? (collOriginalSum / collCount) : 0;

        // Apply AI Defense Logic
        // Before Detection: AI Trust = Original Trust
        // After Detection: AI Trust = Original Trust * Penalty
        let collAiAvg = collOriginalAvg;
        if (loop >= DETECTION_LOOP) {
            collAiAvg = collOriginalAvg * PENALTY_FACTOR;
        }

        series.push({
            loop,
            honest: honestAvg.toFixed(2),
            collusion_original: collOriginalAvg.toFixed(2),
            collusion_ai: collAiAvg.toFixed(2)
        });
    }

    // 3. Write Output
    const outPath = path.join(OUT_DIR, 'ai_defense_series.csv');
    const header = 'loop,honest_avg,collusion_original_avg,collusion_ai_avg';
    const rows = series.map(s => `${s.loop},${s.honest},${s.collusion_original},${s.collusion_ai}`);
    fs.writeFileSync(outPath, [header, ...rows].join('\n'));
    
    console.log(`Generated AI Defense Series: ${outPath}`);
    console.log(series);
}

main();
