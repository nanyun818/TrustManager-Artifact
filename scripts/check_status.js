const { ethers } = require('ethers');
const fs = require('fs');

async function main() {
    const rpcUrl = 'http://127.0.0.1:7545';
    const contractAddress = '0x41d67493fF618029D8A98A918DC4b4ca56101FFC';
    
    console.log(`Checking connection to ${rpcUrl}...`);
    try {
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
        const network = await provider.getNetwork();
        console.log(`Connected to network: ${network.chainId}`);
        
        const code = await provider.getCode(contractAddress);
        if (code === '0x') {
            console.log('Contract NOT found at address (code is 0x)');
            process.exit(1);
        } else {
            console.log('Contract found at address');
            console.log('Code length:', code.length);
        }
    } catch (error) {
        console.error('Error connecting:', error.message);
        process.exit(1);
    }
}

main();
