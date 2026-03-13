const { ethers } = require('ethers');
require('dotenv').config();

async function main() {
    const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:7545';
    // Ethers v5 syntax
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    
    try {
        const blockNumber = await provider.getBlockNumber();
        console.log(`Current Block Number: ${blockNumber}`);
    } catch (error) {
        console.error('Error fetching block number:', error);
    }
}

main();
