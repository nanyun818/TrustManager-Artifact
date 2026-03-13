const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function main() {
    const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:7545';
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    
    // Get Contract Address
    let contractAddress = process.env.CONTRACT_ADDRESS;
    if (!contractAddress) {
        const addrPath = path.join(__dirname, '../contract_address.txt');
        if (fs.existsSync(addrPath)) {
            contractAddress = fs.readFileSync(addrPath, 'utf8').trim();
        }
    }
    console.log(`Contract: ${contractAddress}`);

    const abi = [
        'function getNodeInfo(address _node) public view returns (uint, uint, uint, uint, uint, bool, bool)'
    ];
    const contract = new ethers.Contract(contractAddress, abi, provider);

    // Read State
    const statePath = path.join(__dirname, 'simulation_state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    
    // Check first node from each group
    const groups = ['honest', 'on_off', 'collusion', 'whitewash'];
    
    for (const group of groups) {
        if (state.groups[group] && state.groups[group].length > 0) {
            const node = state.groups[group][0];
            try {
                const info = await contract.getNodeInfo(node);
                console.log(`\n[${group}] Node ${node}:`);
                console.log(`  Trust: ${info[0].toString()}`);
                console.log(`  Active: ${info[5]}`);
                console.log(`  Blacklisted: ${info[6]}`);
            } catch (e) {
                console.log(`\n[${group}] Node ${node}: Error fetching info - ${e.message}`);
            }
        }
    }
}

main();
