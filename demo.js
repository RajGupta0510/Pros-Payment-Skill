const { ethers } = require('ethers');
const { getActiveWallet } = require('./payment');

async function checkBalance() {
  console.log('Connecting to Pharos Network...');
  try {
    const wallet = getActiveWallet();
    const address = await wallet.getAddress();
    const balance = await wallet.provider.getBalance(address);
    console.log('=============================================');
    console.log('Successfully Connected!');
    console.log(`Wallet Address: ${address}`);
    console.log(`Wallet Balance: ${ethers.formatEther(balance)} PROS`);
    console.log('=============================================');
  } catch (error) {
    console.error('Connection failed! Error details:');
    console.error(error.message);
  }
}

checkBalance();
