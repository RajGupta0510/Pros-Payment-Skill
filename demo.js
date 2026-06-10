const { ethers } = require('ethers');
const { getActiveWallet, sendPayment } = require('./payment');

async function runDemo() {
  console.log('Connecting to Pharos Network...');
  try {
    const wallet = getActiveWallet();
    const address = await wallet.getAddress();
    const startingBalance = await wallet.provider.getBalance(address);
    
    console.log('=============================================');
    console.log('Successfully Connected!');
    console.log(`Wallet Address:   ${address}`);
    console.log(`Starting Balance: ${ethers.formatEther(startingBalance)} PROS`);
    console.log('=============================================');

    const recipient = '0xF4976883a299115f19057718a674C38B1a8004A1';
    const amountToSend = '0.0001';
    const memo = 'test transaction';

    console.log(`Initiating test transaction of ${amountToSend} PROS...`);
    console.log(`To:   ${recipient}`);
    console.log(`Memo: "${memo}"`);
    console.log('Sending transaction...');
    
    const receipt = await sendPayment({
      to: recipient,
      amount: amountToSend,
      memo: memo
    });

    console.log('=============================================');
    console.log('Transaction Confirmed Successfully!');
    console.log(`Transaction Hash: ${receipt.txHash}`);
    console.log(`Mined in Block:   ${receipt.blockNumber}`);
    console.log(`Status:           ${receipt.status}`);
    console.log(`Timestamp:        ${receipt.timestamp}`);
    console.log('=============================================');

    const endingBalance = await wallet.provider.getBalance(address);
    console.log(`Ending Balance:   ${ethers.formatEther(endingBalance)} PROS`);
    console.log('=============================================');
  } catch (error) {
    console.error('Demo failed! Error details:');
    console.error(error.message);
  }
}

runDemo();
