const fs = require('fs');
const path = require('path');

// --- Configuration ---
const CONFIG = {
    nodesCount: 100,
    rounds: 100,
    alpha: 0.4,
    beta: 0.3,
    gamma: 0.3,
    blacklistThreshold: 80,
    // AI Parameters
    aiCheckInterval: 5,
    aiPenalty: 40, // Significant penalty
    // Discrimination Thresholds
    stealthMaxVar: 100, // Stealth nodes are consistent (low variance)
    faultMinVar: 200,   // Faulty nodes are erratic (high variance)
};

class Node {
    constructor(id, type) {
        this.id = id;
        this.type = type; // "Truth" type (unknown to AI)
        this.trustValue = 100;
        this.successRate = 100;
        this.history = {
            trust: [],
            success: [],
            latency: []
        };
        this.isBlacklisted = false;
        this.penalties = 0;
        this.falsePositive = false; // Track if innocent was punished
    }

    update(success, latency, online) {
        if (this.isBlacklisted) {
            this.history.trust.push(0);
            this.history.success.push(0);
            return;
        }

        // 1. Calculate Trust (Standard Logic)
        let normSuccess = success;
        let normResponse = latency > 1000 ? 0 : Math.floor((1000 * 100) / (latency + 10));
        if (normResponse > 100) normResponse = 100;
        let normOnline = 100; // Assume online for simplicity

        let score = (CONFIG.alpha * normSuccess) + (CONFIG.beta * normResponse) + (CONFIG.gamma * normOnline);
        this.trustValue = Math.floor(score * 2);

        // 2. Auto-Blacklist (Static Rule)
        if (this.trustValue < CONFIG.blacklistThreshold) {
            this.isBlacklisted = true;
            this.trustValue = 0;
        }

        // 3. Log History
        this.history.trust.push(this.trustValue);
        this.history.success.push(success);
        this.history.latency.push(latency);
    }
}

// --- AI Logic (The Core Test) ---
// Returns TRUE if node should be penalized
function aiAnalyze(node, round) {
    if (node.isBlacklisted) return false;
    
    // Need at least 10 rounds of data
    const window = 10;
    if (node.history.success.length < window) return false;

    const recentSuccess = node.history.success.slice(-window);
    
    // 1. Calculate Mean
    const mean = recentSuccess.reduce((a, b) => a + b, 0) / window;
    
    // 2. Calculate Variance
    const variance = recentSuccess.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / window;

    // --- DECISION LOGIC ---
    
    // A. Stealth Detection:
    // Characteristic: Consistently "Okay" (e.g., 80-90%). Low Variance.
    // If they were truly faulty, they would have drops to 0.
    if (mean > 70 && mean < 92 && variance < CONFIG.stealthMaxVar) {
        return "STEALTH_DETECTED";
    }

    // B. Oscillating Detection:
    // Characteristic: High Variance (100 -> 20 -> 100).
    // The static trust score might average out, but AI sees the swing.
    if (variance > 500 && mean < 95) {
        // Wait... RandomFault also has high variance.
        // How to distinguish Oscillating vs RandomFault?
        // RandomFault usually has mostly 100s and some 0s.
        // Oscillating might have periods of sustained low.
        // For this test, let's see if Variance alone confuses them.
        
        // Let's refine: RandomFaults are usually "spiky" (Kurtosis?), Oscillations are "waves".
        // Simple heuristic: If Variance is HUGE, it's likely RandomFault or Oscillating.
        // We punish if the Mean is also significantly dragged down.
        if (mean < 80) return "OSCILLATION_DETECTED";
    }

    return null; // No Anomaly
}

function runExperiment() {
    console.log("🔬 Starting AI Discrimination Experiment...");
    
    const nodes = [];
    // Setup Scenarios
    for(let i=0; i<20; i++) nodes.push(new Node(`Stealth_${i}`, "Stealth"));
    for(let i=0; i<20; i++) nodes.push(new Node(`RandomFault_${i}`, "RandomFault"));
    for(let i=0; i<20; i++) nodes.push(new Node(`Oscillating_${i}`, "Oscillating"));
    for(let i=0; i<20; i++) nodes.push(new Node(`Honest_${i}`, "Honest"));

    const logs = []; // For CSV

    for (let r = 1; r <= CONFIG.rounds; r++) {
        // 1. Simulate Behavior
        nodes.forEach(node => {
            let s = 100, l = 50;
            
            if (node.type === "Honest") {
                s = 100; l = 50;
            } 
            else if (node.type === "Stealth") {
                // Tries to stay just above 80 trust.
                // 85% success rate, consistent.
                s = 85 + (Math.random() * 5); 
                l = 200;
            }
            else if (node.type === "RandomFault") {
                // 90% chance to be perfect, 10% chance to crash completely
                if (Math.random() < 0.15) { s = 0; l = 5000; }
                else { s = 100; l = 50; }
            }
            else if (node.type === "Oscillating") {
                // Period of 20 rounds. 15 Good, 5 Bad.
                if (r % 20 >= 15) { s = 20; l = 1000; }
                else { s = 100; l = 50; }
            }

            node.update(s, l, 3600);
        });

        // 2. AI Intervention
        if (r % CONFIG.aiCheckInterval === 0) {
            nodes.forEach(node => {
                const verdict = aiAnalyze(node, r);
                if (verdict) {
                    node.penalties++;
                    node.trustValue = Math.max(0, node.trustValue - CONFIG.aiPenalty);
                    
                    // Check False Positive
                    if (node.type === "RandomFault" || node.type === "Honest") {
                        node.falsePositive = true;
                        // console.log(`⚠️ FALSE POSITIVE: Penalized ${node.type} at Round ${r} (${verdict})`);
                    }
                    
                    // If drops low, ban
                    if (node.trustValue < CONFIG.blacklistThreshold) {
                        node.isBlacklisted = true;
                        node.trustValue = 0;
                    }
                }
            });
        }

        // Log Averages for Chart
        const roundStats = { round: r };
        ["Honest", "Stealth", "RandomFault", "Oscillating"].forEach(type => {
            const group = nodes.filter(n => n.type === type);
            const avgTrust = group.reduce((a,b) => a + b.trustValue, 0) / group.length;
            roundStats[type] = avgTrust;
        });
        logs.push(roundStats);
    }

    // --- Report Generation ---
    const stats = {};
    nodes.forEach(n => {
        if (!stats[n.type]) stats[n.type] = { total: 0, banned: 0, penalized: 0 };
        stats[n.type].total++;
        if (n.isBlacklisted) stats[n.type].banned++;
        if (n.penalties > 0) stats[n.type].penalized++;
    });

    console.log("\n📊 Experiment Results:");
    console.table(stats);

    // Write Data for Chart
    let csv = "Round,Honest,Stealth,RandomFault,Oscillating\n";
    logs.forEach(l => {
        csv += `${l.round},${l.Honest.toFixed(2)},${l.Stealth.toFixed(2)},${l.RandomFault.toFixed(2)},${l.Oscillating.toFixed(2)}\n`;
    });
    fs.writeFileSync(path.join(process.cwd(), 'discrimination_test.csv'), csv);
    
    // Write Stats JSON
    fs.writeFileSync(path.join(process.cwd(), 'discrimination_stats.json'), JSON.stringify(stats, null, 2));
    
    console.log("✅ Data saved to discrimination_test.csv");
}

runExperiment();
