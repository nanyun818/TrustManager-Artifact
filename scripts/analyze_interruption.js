const fs = require('fs');
const path = require('path');

const csvPath = path.join(__dirname, '../out/trust_trend_overnight.csv');

function analyze() {
    if (!fs.existsSync(csvPath)) {
        console.log("CSV file not found.");
        return;
    }

    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.trim().split('\n');
    
    // Header: timestamp,loop,address,group,trustValue
    // Data starts from line 1
    
    if (lines.length < 2) {
        console.log("Not enough data.");
        return;
    }

    let timestamps = [];
    
    // Extract unique timestamps to avoid processing every single line (since multiple rows per loop share same timestamp)
    let seenTimestamps = new Set();
    
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length > 0) {
            const tsStr = parts[0];
            if (!seenTimestamps.has(tsStr)) {
                seenTimestamps.add(tsStr);
                timestamps.push(new Date(tsStr));
            }
        }
    }

    timestamps.sort((a, b) => a - b);

    console.log(`Total data points (timestamps): ${timestamps.length}`);
    console.log(`First record: ${timestamps[0].toLocaleString()}`);
    console.log(`Last record: ${timestamps[timestamps.length - 1].toLocaleString()}`);

    console.log("\n--- Checking for Interruptions (> 10 mins) ---");
    let interruptions = [];
    for (let i = 0; i < timestamps.length - 1; i++) {
        const diffMs = timestamps[i+1] - timestamps[i];
        const diffMins = diffMs / (1000 * 60);
        
        if (diffMins > 10) {
            console.log(`⚠️ Gap found: ${timestamps[i].toLocaleString()} -> ${timestamps[i+1].toLocaleString()} (${diffMins.toFixed(1)} mins)`);
            interruptions.push({
                start: timestamps[i],
                end: timestamps[i+1],
                duration: diffMins
            });
        }
    }
    
    if (interruptions.length === 0) {
        console.log("✅ No significant interruptions found (> 10 mins).");
    }

    return interruptions;
}

analyze();
