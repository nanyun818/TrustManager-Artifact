const { ethers } = require('ethers');
async function main() {
  const provider = new ethers.providers.JsonRpcProvider('http://127.0.0.1:7545');
  const accounts = await provider.listAccounts();
  console.log('Available Accounts:', accounts);
}
main();