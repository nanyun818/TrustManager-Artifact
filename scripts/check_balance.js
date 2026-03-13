const { ethers } = require('ethers');
require('dotenv').config();

const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:7545';
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

const MAIN_ACCOUNT = '0xe9bE783C41D50a2e5778305e61a061786c66a4D8';
const BACKUPS = [
    '0x9355835CD38ecC902580498e85923d5caBA26B57',
    '0x76cD91B8612da6155e324DFe905E54ABb48BEaab'
];

async function main() {
    try {
        const balance = await provider.getBalance(MAIN_ACCOUNT);
        console.log(`Current Balance: ${ethers.utils.formatEther(balance)} ETH`);
        
        for (const backup of BACKUPS) {
            const bBal = await provider.getBalance(backup);
            console.log(`Backup ${backup}: ${ethers.utils.formatEther(bBal)} ETH`);
        }
    } catch (e) {
        console.error(e);
    }
}

main();