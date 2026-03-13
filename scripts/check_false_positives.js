const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'simulation_state.json');

async function main() {
    const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:7545';
    let contractAddress = process.env.CONTRACT_ADDRESS;
    
    if (!contractAddress) {
        try {
            contractAddress = fs.readFileSync(path.join(__dirname, '../contract_address.txt'), 'utf8').trim();
        } catch (e) {
            console.error("Missing contract_address.txt");
            return;
        }
    }

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const abi = [
        'function getNodeInfo(address _node) public view returns (uint trustValue, uint successRate, uint responseTime, uint onlineTime, uint interactionCount, bool isActive, bool isBlacklisted)'
    ];
    const contract = new ethers.Contract(contractAddress, abi, provider);

    if (!fs.existsSync(STATE_FILE)) {
        console.error("State file not found.");
        process.exit(1);
    }
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    
    console.log("=== FALSE POSITIVE CHECK ===");
    console.log(`Checking ${state.groups.honest.length} Honest Nodes...`);

    let falsePositives = 0;
    let perfectNodes = 0;

    for (const addr of state.groups.honest) {
        try {
            const info = await contract.getNodeInfo(addr);
            if (info.isBlacklisted) {
                console.error(`❌ FALSE POSITIVE: Honest Node ${addr} is BLACKLISTED! Trust: ${info.trustValue}`);
                falsePositives++;
            } else if (info.trustValue < 100) {
                 console.warn(`⚠️ WARNING: Honest Node ${addr} has low trust: ${info.trustValue}`);
            } else {
                if (info.trustValue === 200) perfectNodes++;
            }
        } catch (e) {
            console.error(`Error checking ${addr}: ${e.message}`);
        }
    }

    console.log("\n=== SUMMARY ===");
    console.log(`Total Honest Nodes: ${state.groups.honest.length}`);
    console.log(`Perfect Trust (200): ${perfectNodes}`);
    console.log(`False Positives (Blacklisted): ${falsePositives}`);
    
    if (falsePositives === 0) {
        console.log("✅ SUCCESS: No honest nodes were wrongly penalized.");
    } else {
        console.log("❌ FAILURE: Some honest nodes were penalized.");
    }
}

main().catch(console.error);
