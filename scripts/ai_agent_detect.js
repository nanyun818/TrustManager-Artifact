const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const ROOT = process.cwd();

// --- AI Configuration ---
const CONFIG = {
    // Thresholds for "Stealth" Detection
    stealth: {
        trustMin: 80,
        trustMax: 195, // Suspiciously slightly imperfect
        successMin: 0,
        successMax: 90, // < 90% is suspicious if trust is still high
        latencyMin: 300 // > 300ms is slow
    },
    // Thresholds for "Sybil" Detection
    sybil: {
        maxAgeSeconds: 7200, // 2 hours considered "New"
        minTrust: 150,       // New but high trust? Suspicious.
        minInteractions: 1   // Must have interacted
    },
    // Defense Action
    penalty: {
        riskScore: 80, // High risk
        penaltyBp: 5000, // 50% trust reduction
        duration: 3600 * 24 // 24 hours
    }
};

async function main() {
    console.log("🤖 AI Defense Agent: STARTING...");
    console.log("   Connecting to Sepolia...");

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

    console.log(`   Monitoring Contract: ${contractAddress}`);

    // --- Step 1: Data Gathering ---
    console.log("   📥 Fetching Node Data...");
    const flaggedNodes = [];

    // We rely on 'network_state.json' if available for speed, or fetch fresh?
    // Let's fetch fresh to be safe.
    // To iterate, we need the list.
    // The contract has `getAllNodes`! (Added in line 494)
    // Wait, let me check if `getAllNodes` is in the ABI I have locally.
    // The `Read` output shows `getAllNodes` at line 494.
    // Let's try calling it.
    
    let allNodes = [];
    try {
        allNodes = await contract.getAllNodes();
    } catch (e) {
        console.log("   ⚠️  getAllNodes() failed (ABI mismatch?), using fallback iteration...");
        // Fallback: Use network_state.json if recent, or try index
        // For now, let's assume we can read from the CSV generated in previous step
        const csvPath = path.join(ROOT, 'network_state.csv');
        if (fs.existsSync(csvPath)) {
            const lines = fs.readFileSync(csvPath, 'utf8').split('\n').slice(1);
            allNodes = lines.map(l => l.split(',')[0]).filter(a => a && a.startsWith('0x'));
        }
    }

    console.log(`   Analyzing ${allNodes.length} nodes...`);
    const currentBlock = await provider.getBlock('latest');
    const now = currentBlock.timestamp;

    for (const nodeAddr of allNodes) {
        try {
            const data = await contract.nodes(nodeAddr);
            // data: trustValue, successRate, responseTime, onlineTime, interactionCount, lastUpdated, isActive, isBlacklisted
            
            // Skip blacklisted
            if (data.isBlacklisted) continue;

            const trust = parseInt(data.trustValue);
            const success = parseInt(data.successRate);
            const latency = parseInt(data.responseTime);
            const lastUpdated = parseInt(data.lastUpdated);
            
            // Heuristic 1: Stealth Detection
            // "Mediocre Performance but High Trust"
            let isStealth = false;
            if (trust >= CONFIG.stealth.trustMin && trust <= CONFIG.stealth.trustMax) {
                if (success < CONFIG.stealth.successMax || latency > CONFIG.stealth.latencyMin) {
                    isStealth = true;
                }
            }

            // Heuristic 2: Sybil / Whitewash Detection
            // "New Node (based on lack of history?) or High Trust quickly"
            // We don't have "registration time" easily unless we check events, but we can infer from onlineTime/interactionCount?
            // If interactionCount is low but trust is high?
            // Whitewash: New identity behaves perfectly for 1 round -> Trust 200.
            let isSybil = false;
            if (data.interactionCount < 5 && trust > CONFIG.sybil.minTrust) {
                // High trust with very few interactions? Suspicious.
                isSybil = true;
            }

            if (isStealth || isSybil) {
                flaggedNodes.push({
                    address: nodeAddr,
                    reason: isStealth ? "Stealth Pattern (Mediocre Service)" : "Sybil Pattern (Rapid Trust Growth)",
                    type: isStealth ? "Stealth" : "Sybil"
                });
            }

        } catch (e) {
            console.error(`   Error analyzing ${nodeAddr}:`, e.message);
        }
    }

    console.log(`   🚩 Flagged ${flaggedNodes.length} suspicious nodes.`);

    // --- Step 2: Active Defense ---
    if (flaggedNodes.length > 0) {
        console.log("   🛡️  Initiating Defense Protocols...");
        
        for (const target of flaggedNodes) {
            console.log(`      🔫 Targeting ${target.address.slice(0,8)}... [${target.reason}]`);
            
            // Call fastRespond
            // fastRespond(address _node, uint _risk, uint _bp, uint _until)
            try {
                const tx = await contract.fastRespond(
                    target.address,
                    CONFIG.penalty.riskScore,
                    CONFIG.penalty.penaltyBp,
                    now + CONFIG.penalty.duration,
                    { gasLimit: 300000 }
                );
                console.log(`         Tx Sent: ${tx.hash}`);
                await tx.wait();
                console.log(`         ✅ Penalty Applied.`);
            } catch (e) {
                console.error(`         ❌ Defense Failed: ${e.message}`);
            }
        }
    } else {
        console.log("   ✅ Network looks healthy. No anomalies detected.");
    }

    console.log("🤖 AI Defense Agent: SLEEPING.");
}

main().catch(console.error);
