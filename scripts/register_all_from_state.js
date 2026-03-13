const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const STATE_FILE = path.join(__dirname, 'simulation_state.json');

async function main() {
    const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:7545';
    // Use fallback address if env var missing
    let contractAddress = process.env.CONTRACT_ADDRESS;
    if (!contractAddress) {
        try {
            contractAddress = fs.readFileSync(path.join(__dirname, '../contract_address.txt'), 'utf8').trim();
        } catch (e) {
            console.error("❌ No contract address found.");
            process.exit(1);
        }
    }

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        console.error("❌ No PRIVATE_KEY in .env");
        process.exit(1);
    }

    console.log(`Using RPC: ${rpcUrl}`);
    console.log(`Contract: ${contractAddress}`);

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    
    const abi = [
        'function registerNode(address _node) public',
        'function updateNodeMetrics(address _node, uint _successRate, uint _responseTime, uint _onlineTime) public',
        'function getNodeInfo(address _node) public view returns (uint trustValue, uint successRate, uint responseTime, uint onlineTime, uint interactionCount, bool isActive, bool isBlacklisted)'
    ];

    const contract = new ethers.Contract(contractAddress, abi, wallet);

    // Read State
    if (!fs.existsSync(STATE_FILE)) {
        console.error("❌ State file not found.");
        process.exit(1);
    }
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    
    // Collect all nodes
    const allNodes = [];
    if (state.groups.honest) allNodes.push(...state.groups.honest);
    if (state.groups.on_off) allNodes.push(...state.groups.on_off);
    if (state.groups.collusion) allNodes.push(...state.groups.collusion);
    // Whitewash nodes usually added later, but if any are there, register them
    if (state.groups.whitewash) allNodes.push(...state.groups.whitewash);

    console.log(`📋 Found ${allNodes.length} nodes to register.`);

    for (const node of allNodes) {
        try {
            // Check if active
            const info = await contract.getNodeInfo(node);
            if (info.isActive) {
                console.log(`✅ Node ${node} already active.`);
                continue;
            }

            console.log(`📝 Registering ${node}...`);
            const tx = await contract.registerNode(node);
            await tx.wait();
            console.log(`   -> Done.`);

        } catch (error) {
            console.error(`❌ Failed to register ${node}:`, error.message);
        }
    }

    console.log("🎉 All nodes registered!");
}

main().catch(console.error);
