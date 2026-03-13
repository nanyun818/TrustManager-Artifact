const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

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
    
    // Check contract code first
    const code = await provider.getCode(contractAddress);
    if (code === '0x') {
        console.error("Contract not found at " + contractAddress);
        return;
    }

    // ABI to check node status
    const abi = [
        'function nodes(address) view returns (address, uint, uint, uint, uint, uint, uint, bool, bool)',
        'function getActiveNodeCount() view returns (uint)'
    ];

    const contract = new ethers.Contract(contractAddress, abi, provider);

    const nodesRaw = JSON.parse(fs.readFileSync(NODES_FILE, 'utf8'));
    
    let registered = 0;
    let notRegistered = 0;

    console.log(`Checking ${nodesRaw.length} nodes on contract ${contractAddress}...`);

    for (const n of nodesRaw) {
        const addr = n.address;
        try {
            // nodes mapping returns struct
            // address nodeAddress; uint trustValue; ... bool isActive; bool isBlacklisted;
            const res = await contract.nodes(addr);
            const isActive = res[7]; // 8th field (index 7) based on struct definition order? 
            // Struct: addr, trust, success, response, online, interactions, lastUpdated, isActive, isBlacklisted
            // Indices: 0,    1,     2,       3,        4,      5,            6,           7,        8
            
            if (isActive) {
                // console.log(`✅ ${addr.substring(0,6)} is active. Trust: ${res[1]}`);
                registered++;
            } else {
                console.log(`❌ ${addr.substring(0,6)} is NOT active.`);
                notRegistered++;
            }
        } catch (e) {
            console.error(`Error checking ${addr}:`, e.message);
        }
    }

    console.log(`\nSummary:`);
    console.log(`Registered: ${registered}`);
    console.log(`Not Registered: ${notRegistered}`);
    console.log(`Total: ${nodesRaw.length}`);
    
    try {
        const count = await contract.getActiveNodeCount();
        console.log(`Contract Active Count: ${count.toString()}`);
    } catch (e) {
        console.log("Could not get active node count.");
    }
}

main().catch(console.error);
