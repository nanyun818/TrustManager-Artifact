const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

async function main() {
    const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:7545';
    const contractAddress = fs.readFileSync(path.join(__dirname, '../contract_address.txt'), 'utf8').trim();
    
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const signer = provider.getSigner(0);
    
    const abi = [
        'function fastRespond(address _node, uint _risk, uint _bp, uint _until) public',
        'function getNodeInfo(address _node) public view returns (uint trustValue, uint successRate, uint responseTime, uint onlineTime, uint interactionCount, bool isActive, bool isBlacklisted)'
    ];
    
    const contract = new ethers.Contract(contractAddress, abi, signer);
    
    const target = '0x8eB950f72BE808C896582d8bFC66e53344C3008E';
    const PENALTY_BP = 9000; // 90% penalty to be sure
    const RISK = 99;
    
    console.log(`\n👮 Applying Manual Penalty to ${target}...`);
    
    try {
        const infoBefore = await contract.getNodeInfo(target);
        console.log(`Before: Trust=${infoBefore.trustValue}, Blacklisted=${infoBefore.isBlacklisted}`);
        
        const tx = await contract.fastRespond(target, RISK, PENALTY_BP, 0, { gasLimit: 500000 });
        await tx.wait();
        console.log("Transaction confirmed.");
        
        const infoAfter = await contract.getNodeInfo(target);
        console.log(`After:  Trust=${infoAfter.trustValue}, Blacklisted=${infoAfter.isBlacklisted}`);
        
        if (infoAfter.isBlacklisted) {
            console.log("✅ SUCCESS: Node was Auto-Blacklisted!");
        } else {
            console.log("❌ FAILURE: Node NOT Blacklisted. Trust is " + infoAfter.trustValue);
        }
        
    } catch (e) {
        console.error("Error:", e);
    }
}

main().catch(console.error);
