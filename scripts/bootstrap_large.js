const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const STATE_FILE = path.join(__dirname, 'simulation_state.json');
const NODES_FILE = path.join(__dirname, 'large_scale_nodes.json');

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
    const signer = provider.getSigner(0); // Owner

    const abi = [
        'function registerNode(address _node) public',
        'function updateNodeMetrics(address _node, uint _successRate, uint _responseTime, uint _onlineTime) public',
        'function getNodeInfo(address _node) public view returns (uint trustValue, uint successRate, uint responseTime, uint onlineTime, uint interactionCount, bool isActive, bool isBlacklisted)'
    ];

    const contract = new ethers.Contract(contractAddress, abi, signer);

    // 1. Load Nodes
    const nodesRaw = JSON.parse(fs.readFileSync(NODES_FILE, 'utf8'));
    const groups = {
        honest: [],
        collusion: [],
        whitewash: [],
        on_off: []
    };

    for (const n of nodesRaw) {
        if (n.type === 'honest') groups.honest.push(n.address);
        else if (n.type === 'collusion') groups.collusion.push(n.address);
        else if (n.type === 'whitewash') groups.whitewash.push(n.address);
    }

    // 2. Register & Bootstrap
    console.log(`🚀 Bootstrapping Large Scale Network (${nodesRaw.length} nodes)...`);

    const overrides = { gasLimit: 3000000 };

    // Batch processing to avoid nonce issues or timeout? No, simple loop for now.
    // Honest nodes get good metrics
    for (const addr of groups.honest) {
        process.stdout.write(`Registering Honest ${addr.substring(0,6)}... `);
        try {
            await (await contract.registerNode(addr, overrides)).wait();
            // High trust: 100% success, 100ms response, 3600s online
            await (await contract.updateNodeMetrics(addr, 100, 100, 3600, overrides)).wait();
            await (await contract.updateNodeMetrics(addr, 100, 100, 3600, overrides)).wait();
            console.log("✅");
        } catch (e) { console.log("⚠️ " + e.message.split('(')[0]); }
    }

    // Collusion nodes get medium metrics
    for (const addr of groups.collusion) {
        process.stdout.write(`Registering Collusion ${addr.substring(0,6)}... `);
        try {
            await (await contract.registerNode(addr, overrides)).wait();
            // Medium trust: 90% success, 500ms response, 3000s online
            await (await contract.updateNodeMetrics(addr, 90, 500, 3000, overrides)).wait();
            console.log("✅");
        } catch (e) { console.log("⚠️ " + e.message.split('(')[0]); }
    }

    // Whitewash nodes (Initial state: New)
    // SKIP registering them here. They should appear during the attack simulation (Loop 110).
    /*
    for (const addr of groups.whitewash) {
        process.stdout.write(`Registering Whitewash ${addr.substring(0,6)}... `);
        try {
            await (await contract.registerNode(addr, overrides)).wait();
            console.log("✅ (Fresh)");
        } catch (e) { console.log("⚠️ " + e.message.split('(')[0]); }
    }
    */
    console.log("Skipping Whitewash nodes registration (will register during attack simulation).");

    // 3. Save State
    const newState = {
        loop: 100, // Reset loop count
        groups: groups,
        whitewash_active_map: {}
    };
    
    fs.writeFileSync(STATE_FILE, JSON.stringify(newState, null, 2));
    console.log(`💾 State file updated with ${nodesRaw.length} nodes.`);
}

main().catch(console.error);
