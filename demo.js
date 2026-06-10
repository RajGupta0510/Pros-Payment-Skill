const { ethers } = require('ethers');
const { 
  sendPayment, 
  sendBatchPayment, 
  sendConditionalPayment, 
  estimatePaymentCost, 
  getTransactionHistory, 
  checkBalance, 
  getPharosNetworkStatus,
  getActiveWallet
} = require('./index');
const rateLimiter = require('./rateLimiter');

async function runAllTests() {
  const results = {};
  
  console.log('====================================================');
  console.log('Starting Live Verification Suite on Pharos Network...');
  console.log('====================================================\n');

  let senderAddress = 'Unknown';
  try {
    const wallet = getActiveWallet();
    senderAddress = await wallet.getAddress();
    const balance = await wallet.provider.getBalance(senderAddress);
    console.log('--- DIAGNOSTIC SENDER INFO ---');
    console.log(`Sender Address: ${senderAddress}`);
    console.log(`Sender Balance: ${ethers.formatEther(balance)} PROS`);
    console.log('=============================\n');
  } catch (diagErr) {
    console.error(`Diagnostic load failed: ${diagErr.message}\n`);
  }

  // TEST 1 - Single Payment
  console.log('--- TEST 1: Single Payment ---');
  rateLimiter.reset();
  try {
    const receipt = await sendPayment({
      to: '0xF4976883a299115f19057718a674C38B1a8004A1',
      amount: '0.0001',
      memo: 'single payment test'
    });
    console.log(`Transaction Hash: ${receipt.txHash}`);
    console.log(`Block Number:     ${receipt.blockNumber}`);
    console.log(`Status:           ${receipt.status}`);
    results['TEST 1'] = 'PASS';
  } catch (error) {
    console.error(`FAILED: ${error.message}`);
    if (error.errorCode) {
      console.error(`  Error Code: ${error.errorCode} | Retryable: ${error.retryable}`);
    }
    results['TEST 1'] = 'FAIL';
  }
  console.log('\n');

  // TEST 2 - Batch Payment
  console.log('--- TEST 2: Batch Payment ---');
  rateLimiter.reset();
  try {
    const receipts = await sendBatchPayment({
      payments: [
        { to: '0xF4976883a299115f19057718a674C38B1a8004A1', amount: '0.00005', memo: 'batch 1' },
        { to: '0xF4976883a299115f19057718a674C38B1a8004A1', amount: '0.00005', memo: 'batch 2' }
      ]
    });
    console.log(`Receipt 1 Status: ${receipts[0].status} | TxHash: ${receipts[0].txHash}`);
    console.log(`Receipt 2 Status: ${receipts[1].status} | TxHash: ${receipts[1].txHash}`);
    results['TEST 2'] = 'PASS';
  } catch (error) {
    console.error(`FAILED: ${error.message}`);
    if (error.errorCode) {
      console.error(`  Error Code: ${error.errorCode} | Retryable: ${error.retryable}`);
    }
    results['TEST 2'] = 'FAIL';
  }
  console.log('\n');

  // TEST 3 - Rate Limiter
  console.log('--- TEST 3: Rate Limiter ---');
  rateLimiter.reset();
  const originalLimit = rateLimiter.LIMIT_1H;
  rateLimiter.LIMIT_1H = 0.0001;
  try {
    await sendPayment({
      to: '0xF4976883a299115f19057718a674C38B1a8004A1',
      amount: '0.001',
      memo: 'should fail'
    });
    console.log('FAILED: Allowed over-spending!');
    results['TEST 3'] = 'FAIL';
  } catch (error) {
    console.log('Blocked successfully as expected!');
    console.log(`Error Code:    ${error.errorCode}`);
    console.log(`Error Message: ${error.errorMessage}`);
    console.log(`Retryable:     ${error.retryable}`);
    if (error.errorCode === 'RATE_LIMIT_EXCEEDED') {
      results['TEST 3'] = 'PASS';
    } else {
      results['TEST 3'] = 'FAIL';
    }
  } finally {
    rateLimiter.LIMIT_1H = originalLimit;
  }
  console.log('\n');

  // TEST 4 - Payment Verification
  console.log('--- TEST 4: Payment Verification ---');
  rateLimiter.reset();
  try {
    const receipt = await sendPayment({
      to: '0xF4976883a299115f19057718a674C38B1a8004A1',
      amount: '0.0001',
      memo: 'verification test'
    });
    const wallet = getActiveWallet();
    const txReceipt = await wallet.provider.getTransactionReceipt(receipt.txHash);
    const gasUsed = txReceipt ? txReceipt.gasUsed.toString() : 'unknown';
    
    console.log(`Confirmed in Block: ${receipt.blockNumber}`);
    console.log(`Gas Used:           ${gasUsed}`);
    console.log(`Official Timestamp: ${receipt.timestamp}`);
    results['TEST 4'] = 'PASS';
  } catch (error) {
    console.error(`FAILED: ${error.message}`);
    if (error.errorCode) {
      console.error(`  Error Code: ${error.errorCode} | Retryable: ${error.retryable}`);
    }
    results['TEST 4'] = 'FAIL';
  }
  console.log('\n');

  // TEST 5 - Conditional Payment
  console.log('--- TEST 5: Conditional Payment ---');
  rateLimiter.reset();
  try {
    const wallet = getActiveWallet();
    const address = await wallet.getAddress();
    const balance = await wallet.provider.getBalance(address);
    const hasBalance = balance > 0n;
    console.log(`Condition checked (balance > 0): ${hasBalance}`);
    
    const condition = {
      type: 'balance',
      targetAddress: address,
      minBalance: '0.0000001'
    };
    
    const receipt = await sendConditionalPayment({
      to: '0xF4976883a299115f19057718a674C38B1a8004A1',
      amount: '0.0001',
      condition
    });
    console.log(`Transaction Hash: ${receipt.txHash}`);
    results['TEST 5'] = 'PASS';
  } catch (error) {
    console.error(`FAILED: ${error.message}`);
    if (error.errorCode) {
      console.error(`  Error Code: ${error.errorCode} | Retryable: ${error.retryable}`);
    }
    results['TEST 5'] = 'FAIL';
  }
  console.log('\n');

  // TEST 6 - Gas Estimation
  console.log('--- TEST 6: Gas Estimation ---');
  try {
    const estimation = await estimatePaymentCost({
      to: '0xF4976883a299115f19057718a674C38B1a8004A1',
      amount: '0.0001',
      memo: 'estimation test'
    });
    console.log(`Estimated Gas Units: ${estimation.gasLimit}`);
    console.log(`Gas Price (Wei):     ${estimation.gasPrice}`);
    console.log(`Total Cost (PROS):   ${estimation.totalCost}`);
    results['TEST 6'] = 'PASS';
  } catch (error) {
    console.error(`FAILED: ${error.message}`);
    results['TEST 6'] = 'FAIL';
  }
  console.log('\n');

  // TEST 7 - Balance Check
  console.log('--- TEST 7: Balance Check ---');
  try {
    const balance = await checkBalance('0xF4976883a299115f19057718a674C38B1a8004A1');
    console.log(`Wallet Balance: ${balance} PROS`);
    results['TEST 7'] = 'PASS';
  } catch (error) {
    console.error(`FAILED: ${error.message}`);
    results['TEST 7'] = 'FAIL';
  }
  console.log('\n');

  // TEST 8 - Transaction History
  console.log('--- TEST 8: Transaction History ---');
  try {
    const history = await getTransactionHistory();
    console.log(`Found ${history.length} transactions in this session:`);
    history.forEach((tx, idx) => {
      console.log(`  [${idx + 1}] Recipient: ${tx.recipient} | Amount: ${tx.amount} | Hash: ${tx.txHash} | Status: ${tx.status} | Time: ${tx.timestamp}`);
    });
    results['TEST 8'] = history.length > 0 ? 'PASS' : 'FAIL';
  } catch (error) {
    console.error(`FAILED: ${error.message}`);
    results['TEST 8'] = 'FAIL';
  }
  console.log('\n');

  // TEST 9 - Structured Error Codes
  console.log('--- TEST 9: Structured Error Codes ---');
  let err1Pass = false;
  let err2Pass = false;
  
  console.log('  Sub-test 9.1: Invalid address format check...');
  try {
    await sendPayment({
      to: '0xinvalid',
      amount: '0.0001',
      memo: 'invalid address check'
    });
  } catch (error) {
    console.log(`    Error Code:    ${error.errorCode}`);
    console.log(`    Error Message: ${error.errorMessage}`);
    console.log(`    Retryable:     ${error.retryable}`);
    if (error.errorCode === 'INVALID_ADDRESS') {
      err1Pass = true;
    }
  }

  console.log('  Sub-test 9.2: Negative amount check...');
  try {
    await sendPayment({
      to: '0xF4976883a299115f19057718a674C38B1a8004A1',
      amount: '-1',
      memo: 'negative amount check'
    });
  } catch (error) {
    console.log(`    Error Code:    ${error.errorCode}`);
    console.log(`    Error Message: ${error.errorMessage}`);
    console.log(`    Retryable:     ${error.retryable}`);
    if (error.errorCode === 'INVALID_INPUT') {
      err2Pass = true;
    }
  }
  
  results['TEST 9'] = (err1Pass && err2Pass) ? 'PASS' : 'FAIL';
  console.log('\n');

  // TEST 10 - Network Status
  console.log('--- TEST 10: Network Status ---');
  try {
    const status = await getPharosNetworkStatus();
    console.log(`Block Number:    ${status.blockNumber}`);
    console.log(`Network Name:    ${status.networkName}`);
    console.log(`Chain ID:        ${status.chainId}`);
    console.log(`Gas Price:       ${status.gasPricePros} PROS`);
    console.log(`Network Healthy: ${status.healthy}`);
    results['TEST 10'] = 'PASS';
  } catch (error) {
    console.error(`FAILED: ${error.message}`);
    results['TEST 10'] = 'FAIL';
  }
  console.log('\n');

  // Print final summary
  console.log('====================================================');
  console.log('             VERIFICATION SUMMARY TABLE             ');
  console.log('====================================================');
  let passedCount = 0;
  for (let i = 1; i <= 10; i++) {
    const name = `TEST ${i}`;
    let label = '';
    switch(i) {
      case 1: label = 'TEST 1 - Single Payment.........'; break;
      case 2: label = 'TEST 2 - Batch Payment..........'; break;
      case 3: label = 'TEST 3 - Rate Limiter...........'; break;
      case 4: label = 'TEST 4 - Verification...........'; break;
      case 5: label = 'TEST 5 - Conditional Payment....'; break;
      case 6: label = 'TEST 6 - Gas Estimation.........'; break;
      case 7: label = 'TEST 7 - Balance Check..........'; break;
      case 8: label = 'TEST 8 - Transaction History....'; break;
      case 9: label = 'TEST 9 - Error Codes............'; break;
      case 10: label = 'TEST 10 - Network Status........'; break;
    }
    const status = results[name] || 'FAIL';
    if (status === 'PASS') passedCount++;
    console.log(`${label} ${status}`);
  }
  console.log('====================================================');
  console.log(`TOTAL: ${passedCount}/10 PASSED`);
  console.log('====================================================');
}

runAllTests();
