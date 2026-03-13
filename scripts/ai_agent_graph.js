const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const { riskScore } = require('./models_infer');
require('dotenv').config();

const ROOT = process.cwd();

// --- Configuration ---
const CONFIG = {
    minDegreeForTrust: 5, // Cold Start: Need 5 interactions to be trusted fully
    highRiskThreshold: 0.7, // RF Model output > 0.7 is Bad
    penalty: {
        riskScore: 90, 
        penaltyBp: 8000, // 80% Slash
        duration: 3600 * 48 // 48 Hours
    }
};

class IncrementalGraph {
    constructor() {
        this.adj = new Map(); // address -> Set<address>
        this.nodeStats = new Map(); // address -> { degree, triangles, uniquePartners }
    }

    ensureNode(addr) {
        if (!this.adj.has(addr)) {
            this.adj.set(addr, new Set());
            this.nodeStats.set(addr, { degree: 0, triangles: 0, uniquePartners: 0 });
        }
    }

    addEdge(u, v) {
        if (u === v) return;
        this.ensureNode(u);
        this.ensureNode(v);

        const uNeighbors = this.adj.get(u);
        const vNeighbors = this.adj.get(v);

        if (uNeighbors.has(v)) return; // Already exists

        // 1. Find Common Neighbors (Witnesses of new triangles)
        const common = [];
        for (const neighbor of uNeighbors) {
            if (vNeighbors.has(neighbor)) {
                common.push(neighbor);
            }
        }

        // 2. Update Triangles for Common Neighbors
        for (const w of common) {
            const stats = this.nodeStats.get(w);
            stats.triangles += 1;
        }

        // 3. Update Triangles for u and v
        this.nodeStats.get(u).triangles += common.length;
        this.nodeStats.get(v).triangles += common.length;

        // 4. Update Adjacency & Degree
        uNeighbors.add(v);
        vNeighbors.add(u); 
        
        // Update Degree/Unique
        this.nodeStats.get(u).degree = uNeighbors.size; 
        this.nodeStats.get(u).uniquePartners = uNeighbors.size;
        
        this.nodeStats.get(v).degree = vNeighbors.size;
        this.nodeStats.get(v).uniquePartners = vNeighbors.size;
        
        return [u, v, ...common]; // Return affected nodes
    }

    getFeatures(addr) {
        const stats = this.nodeStats.get(addr);
        if (!stats) return null;

        const k = stats.degree;
        
        let cliqueScore = 0;
        if (k > 1) {
            // Undirected graph: max triangles = k*(k-1)/2
            // To match training data scaling (often directed-like), we might need adjustment.
            // Using standard clustering coefficient: 2 * T / (k * (k-1))
            cliqueScore = (2 * stats.triangles) / (k * (k - 1));
        }

        return {
            degree: k,
            uniquePartners: k,
            cliqueScore: cliqueScore,
            // Placeholders for other features the model expects
            failed: 0, 
            gasRatio: 1.0 
        };
    }
}

// --- Dashboard Helper ---
const DASHBOARD_PATH = path.join(ROOT, 'public', 'dashboard_data.json');
const dashboardData = {
    stats: {
        totalInteractions: 0,
        highRiskCount: 0,
        avgCliqueScore: 0,
        slashedCount: 0
    },
    alerts: []
};

function updateDashboard(alert = null) {
    if (alert) {
        dashboardData.alerts.push(alert);
        if (alert.riskScore > CONFIG.highRiskThreshold) {
            dashboardData.stats.highRiskCount++;
            if (alert.action === 'SLASHED') dashboardData.stats.slashedCount++;
        }
    }
    // Update avg clique
    const totalClique = dashboardData.alerts.reduce((sum, a) => sum + a.features.cliqueScore, 0);
    dashboardData.stats.avgCliqueScore = dashboardData.alerts.length > 0 ? totalClique / dashboardData.alerts.length : 0;
    
    fs.writeFileSync(DASHBOARD_PATH, JSON.stringify(dashboardData, null, 2));
}

// --- Simulation Logic ---
async function runSimulation() {
    console.log("🎮 STARTING SIMULATION MODE...");
    const graph = new IncrementalGraph();
    const csvPath = path.join(ROOT, 'graph_interactions.csv');
    
    if (!fs.existsSync(csvPath)) throw new Error("No CSV data found for simulation");
    
    const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').slice(1);
    console.log(`   Processing ${lines.length} historical interactions...`);

    let processed = 0;
    for (const line of lines) {
        const parts = line.split(',');
        if (parts.length < 2) continue;
        
        const [u, v] = parts;
        processed++;
        dashboardData.stats.totalInteractions = processed;

        // Add edge
        const affected = graph.addEdge(u, v);
        if (!affected) continue;

        // Detect
        for (const addr of affected) {
            const features = graph.getFeatures(addr);
            
            // Skip Cold Start for detection noise in simulation (optional, but let's keep logic consistent)
            if (features.degree < CONFIG.minDegreeForTrust) continue;

            const txData = { features: features };
            const score = riskScore(txData);
            
            // DEBUG: Print first few scores
            if (processed < 20) {
                 console.log(`DEBUG: Node=${addr} Deg=${features.degree} Clique=${features.cliqueScore} Score=${score}`);
            }

            if (score > CONFIG.highRiskThreshold) {
                const alert = {
                    timestamp: Date.now() - (lines.length - processed) * 1000, // Fake timestamp
                    node: addr,
                    recommender: (addr === u) ? v : u, // Approximate trigger
                    features: features,
                    riskScore: score,
                    action: 'SLASHED' // Simulated action
                };
                
                // Only log if not already logged recently? In sim we log all high risks.
                // To avoid spamming dashboard with same node repeatedly, maybe check last alert?
                // For demo, spam is fine, shows persistence.
                updateDashboard(alert);
                
                if (processed % 50 === 0) process.stdout.write('.');
                if (processed % 100 === 0) updateDashboard(); // Save progress
            }
        }
    }
    updateDashboard(); // Final save
    console.log("\n✅ Simulation Complete. Dashboard updated.");
    console.log(`   High Risk Alerts: ${dashboardData.stats.highRiskCount}`);
    process.exit(0);
}

// --- Main Live Agent ---
async function main() {
    // Check for simulation flag
    if (process.argv.includes('--simulate')) {
        await runSimulation();
        return;
    }

    console.log("🕸️ AI Graph Defense Agent: STARTING (Live Mode)...");
    
    // Connect
    const rpcUrl = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
    const privateKey = process.env.SEPOLIA_PRIVATE_KEY || process.env.PRIVATE_KEY;
    if (!rpcUrl || !privateKey) throw new Error("Missing env vars");

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const adminWallet = new ethers.Wallet(privateKey, provider);

    // Load Contract
    const sepoliaInfoPath = path.join(ROOT, 'out', 'deploy_sepolia.json');
    if (!fs.existsSync(sepoliaInfoPath)) throw new Error("Deploy info not found");
    const info = JSON.parse(fs.readFileSync(sepoliaInfoPath, 'utf8'));
    const contractAddress = info.address;

    let buildInfoPath = path.join(ROOT, 'artifacts', 'contracts', 'TrustManager.sol', 'TrustManager.json');
    if (!fs.existsSync(buildInfoPath)) buildInfoPath = path.join(ROOT, 'artifacts', 'TrustManager.json');
    const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
    
    const contract = new ethers.Contract(contractAddress, buildInfo.abi, adminWallet);
    console.log(`   Listening to: ${contractAddress}`);

    // Init Graph
    const graph = new IncrementalGraph();
    
    // Pre-load from CSV if exists (Warmup)
    const csvPath = path.join(ROOT, 'graph_interactions.csv');
    if (fs.existsSync(csvPath)) {
        console.log("   🔥 Warming up graph from CSV...");
        const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').slice(1);
        let count = 0;
        for (const line of lines) {
            const parts = line.split(',');
            if (parts.length >= 2) {
                graph.addEdge(parts[0], parts[1]);
                count++;
            }
        }
        console.log(`   ✅ Loaded ${count} edges.`);
        dashboardData.stats.totalInteractions = count;
        updateDashboard(); // Init dashboard file
    }

    // Event Listener
    console.log("   👂 Watching for 'RecommendationAdded' events...");
    
    contract.on("RecommendationAdded", async (node, recommender, val, weight, event) => {
        console.log(`   ⚡ Interaction: ${recommender} -> ${node}`);
        dashboardData.stats.totalInteractions++;
        
        // 1. Incremental Update
        const affectedNodes = graph.addEdge(recommender, node);
        
        if (!affectedNodes) return; 
        
        // 2. Analyze Risk for Affected Nodes
        for (const addr of affectedNodes) {
            if (!addr.startsWith('0x')) continue;

            const features = graph.getFeatures(addr);
            
            if (features.degree < CONFIG.minDegreeForTrust) continue;

            // RF Inference
            const txData = { features: features };
            const score = riskScore(txData);
            
            // Log to dashboard buffer (maybe low risk too?)
            // For now only high risk to dashboard to keep it clean, or all?
            // Let's log high risk.
            
            if (score > CONFIG.highRiskThreshold) {
                console.log(`      🚨 HIGH RISK DETECTED [${addr.slice(0,8)}]: Score ${score.toFixed(2)} (Clique: ${features.cliqueScore.toFixed(2)})`);
                
                const alert = {
                    timestamp: Date.now(),
                    node: addr,
                    recommender: recommender,
                    features: features,
                    riskScore: score,
                    action: 'PENDING'
                };

                // 3. Trigger Defense
                try {
                    console.log(`         🛡️ Slashing Node...`);
                    const tx = await contract.fastRespond(
                        addr,
                        CONFIG.penalty.riskScore,
                        CONFIG.penalty.penaltyBp,
                        Math.floor(Date.now()/1000) + CONFIG.penalty.duration,
                        { gasLimit: 300000 }
                    );
                    console.log(`         ✅ Tx: ${tx.hash}`);
                    alert.action = 'SLASHED';
                } catch (e) {
                    console.error(`         ❌ Failed to slash: ${e.message}`);
                    alert.action = 'FAILED';
                }
                
                updateDashboard(alert);
            }
        }
    });

    // Keep alive
    process.stdin.resume();
}

main().catch(console.error);
