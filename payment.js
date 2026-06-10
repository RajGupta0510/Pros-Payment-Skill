const { ethers } = require('ethers');
const config = require('./config');
const rateLimiter = require('./rateLimiter');

// Session transaction history
const transactionHistory = new Map();

function recordHistory(txHash, details) {
  transactionHistory.set(txHash, {
    txHash,
    timestamp: details.timestamp || new Date().toISOString(),
    recipient: details.recipient,
    amount: details.amount.toString(),
    status: details.status || 'pending'
  });
}

function clearTransactionHistory() {
  transactionHistory.clear();
}

async function getTransactionHistory() {
  return Array.from(transactionHistory.values());
}


/**
 * Truncates a string to prevent log injection or overflow from untrusted inputs.
 * @param {*} val Value to check
 * @param {number} limit Maximum character limit
 * @returns {string} The truncated value string
 */
function truncateInput(val, limit = 100) {
  const str = val === undefined || val === null ? '' : String(val);
  return str.length > limit ? str.slice(0, limit) + '...' : str;
}

/**
 * Sanitizes error messages to prevent leakage of sensitive RPC URLs or credentials.
 * @param {string} msg Raw error message
 * @returns {string} Sanitized error message
 */
function sanitizeErrorMessage(msg) {
  if (!msg) return 'Unknown error';
  // Redact URLs containing potentially sensitive credentials or API keys
  return msg.replace(/https?:\/\/[^\s'"]+/gi, '[REDACTED_RPC_URL]');
}

// Initialize provider and wallet from validated config
const provider = new ethers.JsonRpcProvider(config.rpcUrl);
const wallet = new ethers.Wallet(config.privateKey, provider);

let activeWallet = wallet;

/**
 * Gets the currently active wallet instance.
 * @returns {ethers.Wallet} The active wallet instance
 */
function getActiveWallet() {
  if (!activeWallet) {
    throw new Error('Payment Skill Error: Wallet is not initialized.');
  }
  return activeWallet;
}

/**
 * Sets the active wallet instance. Primarily used for testing/mocking.
 * @param {ethers.Wallet} newWallet The new wallet instance to use
 */
function setWallet(newWallet) {
  activeWallet = newWallet;
}

/**
 * Validates transaction inputs.
 * @param {string} to Recipient EVM address
 * @param {number|string} amount Amount in PROS tokens
 * @param {string} [memo] Optional memo string
 */
function validatePaymentInput(to, amount, memo) {
  if (!to) {
    throw new Error('Validation Error: Recipient address ("to") is required.');
  }
  if (!ethers.isAddress(to)) {
    throw new Error(`Validation Error: "${truncateInput(to)}" is not a valid EVM address.`);
  }

  if (amount === undefined || amount === null) {
    throw new Error('Validation Error: Transfer "amount" is required.');
  }
  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    throw new Error(`Validation Error: Amount must be a positive number. Got: "${truncateInput(amount)}"`);
  }

  if (memo !== undefined && memo !== null) {
    if (typeof memo !== 'string') {
      throw new Error('Validation Error: "memo" must be a string.');
    }
    if (memo.length > 1000) {
      throw new Error('Validation Error: "memo" length exceeds the limit of 1000 characters.');
    }
  }
}

/**
 * Sends PROS tokens to a single recipient address.
 * @param {Object} params Payment details
 * @param {string} params.to Recipient EVM address
 * @param {number|string} params.amount Amount in PROS tokens
 * @param {string} [params.memo] Optional memo to attach
 * @returns {Promise<{txHash: string, blockNumber: number, status: string, timestamp: string}>} Transaction receipt details
 */
async function sendPayment({ to, amount, memo }) {
  // 1. Validate inputs
  validatePaymentInput(to, amount, memo);

  const currentWallet = getActiveWallet();
  const senderAddress = await currentWallet.getAddress();

  // 2. Rate limiting check (MUST run BEFORE any transaction)
  rateLimiter.checkLimit(senderAddress, amount);

  // 3. Record transaction in rate limiter (optimistically)
  const recordTs = rateLimiter.record(senderAddress, amount);

  let tx;
  try {
    // 4. Construct transaction payload
    const val = ethers.parseEther(amount.toString());
    const data = memo ? ethers.hexlify(ethers.toUtf8Bytes(memo)) : '0x';

    // 5. Submit transaction
    tx = await currentWallet.sendTransaction({
      to,
      value: val,
      data
    });

    recordHistory(tx.hash, {
      recipient: to,
      amount,
      status: 'pending'
    });

    // 6. Poll for confirmation (with 60-second timeout)
    const receipt = await tx.wait(1, 60000);

    // 7. Fetch block timestamp
    const block = await currentWallet.provider.getBlock(receipt.blockNumber);
    const timestamp = block ? new Date(block.timestamp * 1000).toISOString() : new Date().toISOString();

    const status = receipt.status === 1 ? 'success' : 'failed';
    recordHistory(receipt.hash, {
      timestamp,
      recipient: to,
      amount,
      status
    });

    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      status,
      timestamp
    };
  } catch (err) {
    // 8. Rollback rate limiter on failure
    rateLimiter.rollback(senderAddress, amount, recordTs);

    const failedHash = err.transactionHash || (tx && tx.hash);
    if (failedHash) {
      recordHistory(failedHash, {
        recipient: to,
        amount,
        status: 'failed'
      });
    }

    // 9. Handle errors gracefully with clear messages
    if (err.code === 'TIMEOUT' || err.message.includes('timeout')) {
      throw new Error(`Transaction Timeout Error: Payment submission succeeded but confirmation timed out after 60 seconds. TxHash: ${truncateInput(err.transactionHash || 'unknown')}`);
    }
    throw new Error(`Payment Execution Error: ${sanitizeErrorMessage(err.message)}`);
  }
}

/**
 * Sends PROS tokens to multiple addresses in a single call.
 * Sends individual transactions with sequential nonces.
 * @param {Object} params Batch payment details
 * @param {Array<{to: string, amount: number|string, memo: string}>} params.payments Array of payments
 * @returns {Promise<Array<Object>>} Array of transaction receipt results
 */
async function sendBatchPayment({ payments }) {
  // 1. Validate input batch structure
  if (!payments || !Array.isArray(payments) || payments.length === 0) {
    throw new Error('Validation Error: "payments" must be a non-empty array.');
  }

  // 2. Validate individual payments and sum total amount
  let totalAmount = 0;
  for (let i = 0; i < payments.length; i++) {
    const payment = payments[i];
    try {
      validatePaymentInput(payment.to, payment.amount, payment.memo);
    } catch (err) {
      throw new Error(`Validation Error at index ${i}: ${err.message}`);
    }
    totalAmount += parseFloat(payment.amount);
  }

  const currentWallet = getActiveWallet();
  const senderAddress = await currentWallet.getAddress();

  // 3. Rate limiting check (MUST run BEFORE any transaction)
  rateLimiter.checkLimit(senderAddress, totalAmount);

  // 4. Record transaction in rate limiter (optimistically)
  const recordTs = rateLimiter.record(senderAddress, totalAmount);

  const submittedTxes = [];
  try {
    // 5. Submit transactions sequentially using manual nonce increment to avoid collisions
    let currentNonce = await currentWallet.getNonce();

    for (let i = 0; i < payments.length; i++) {
      const payment = payments[i];
      const val = ethers.parseEther(payment.amount.toString());
      const data = payment.memo ? ethers.hexlify(ethers.toUtf8Bytes(payment.memo)) : '0x';

      try {
        const tx = await currentWallet.sendTransaction({
          to: payment.to,
          value: val,
          data,
          nonce: currentNonce++
        });
        submittedTxes.push({ tx, payment });

        recordHistory(tx.hash, {
          recipient: payment.to,
          amount: payment.amount,
          status: 'pending'
        });
      } catch (submitErr) {
        // Rollback unsubmitted amount from rate limiter
        const failedAmount = payments.slice(i).reduce((sum, p) => sum + parseFloat(p.amount), 0);
        rateLimiter.rollback(senderAddress, totalAmount, recordTs);
        const successAmount = totalAmount - failedAmount;
        if (successAmount > 0) {
          rateLimiter.record(senderAddress, successAmount, recordTs);
        }
        throw new Error(`Batch submission failed at index ${i}: ${sanitizeErrorMessage(submitErr.message)}`);
      }
    }

    // 6. Poll for confirmation in parallel
    const receiptPromises = submittedTxes.map(async ({ tx, payment }) => {
      try {
        const receipt = await tx.wait(1, 60000);
        const block = await currentWallet.provider.getBlock(receipt.blockNumber);
        const timestamp = block ? new Date(block.timestamp * 1000).toISOString() : new Date().toISOString();
        const status = receipt.status === 1 ? 'success' : 'failed';

        recordHistory(receipt.hash, {
          timestamp,
          recipient: payment.to,
          amount: payment.amount,
          status
        });

        return {
          to: payment.to,
          amount: payment.amount,
          memo: payment.memo || null,
          txHash: receipt.hash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString(),
          status,
          timestamp
        };
      } catch (waitErr) {
        recordHistory(tx.hash, {
          recipient: payment.to,
          amount: payment.amount,
          status: 'failed'
        });

        return {
          to: payment.to,
          amount: payment.amount,
          memo: payment.memo || null,
          txHash: tx.hash,
          status: 'failed',
          error: waitErr.message
        };
      }
    });

    const receipts = await Promise.all(receiptPromises);

    // 7. Reconcile rate limiter for any failed transactions in the batch
    let totalFailedAmount = 0;
    for (const r of receipts) {
      if (r.status === 'failed') {
        totalFailedAmount += parseFloat(r.amount);
      }
    }

    if (totalFailedAmount > 0) {
      rateLimiter.rollback(senderAddress, totalAmount, recordTs);
      const finalSuccessAmount = totalAmount - totalFailedAmount;
      if (finalSuccessAmount > 0) {
        rateLimiter.record(senderAddress, finalSuccessAmount, recordTs);
      }
    }

    return receipts;
  } catch (err) {
    // Rollback total amount if unexpected error occurs
    rateLimiter.rollback(senderAddress, totalAmount, recordTs);
    throw new Error(`Batch Payment Execution Error: ${sanitizeErrorMessage(err.message)}`);
  }
}

/**
 * Evaluates an on-chain condition using the provider.
 * @param {ethers.Provider} provider The blockchain provider
 * @param {Function|Object} condition The condition to evaluate
 * @returns {Promise<boolean>} Resolves to true if the condition is met
 */
async function evalCondition(provider, condition) {
  if (typeof condition === 'function') {
    const res = await condition(provider);
    return !!res;
  }

  if (typeof condition === 'object' && condition !== null) {
    const { type } = condition;
    
    if (type === 'balance') {
      const { targetAddress, minBalance } = condition;
      if (!targetAddress || !ethers.isAddress(targetAddress)) {
        throw new Error('Invalid balance check condition: "targetAddress" is missing or invalid.');
      }
      if (minBalance === undefined || isNaN(parseFloat(minBalance))) {
        throw new Error('Invalid balance check condition: "minBalance" must be a valid number representation.');
      }
      const balance = await provider.getBalance(targetAddress);
      const minBalanceWei = ethers.parseEther(minBalance.toString());
      return balance >= minBalanceWei;
    }
    
    if (type === 'contractCall') {
      const { address, abi, method, args = [], expected } = condition;
      if (!address || !ethers.isAddress(address)) {
        throw new Error('Invalid contractCall condition: "address" is missing or invalid.');
      }
      if (!abi || !Array.isArray(abi)) {
        throw new Error('Invalid contractCall condition: "abi" must be a valid array.');
      }
      if (!method || typeof method !== 'string') {
        throw new Error('Invalid contractCall condition: "method" must be a valid method name string.');
      }
      
      const contract = new ethers.Contract(address, abi, provider);
      const res = await contract[method](...args);
      
      // Compare values, converting BigInts to string for safe comparison
      if (typeof res === 'bigint') {
        return res.toString() === expected.toString();
      }
      return res === expected;
    }
    
    throw new Error(`Unsupported condition type: "${type}"`);
  }

  throw new Error('Condition must be a function or an object.');
}

/**
 * Sends PROS tokens only if a specific on-chain condition is met.
 * @param {Object} params Payment details
 * @param {string} params.to Recipient EVM address
 * @param {number|string} params.amount Amount in PROS tokens
 * @param {string} [params.memo] Optional memo to attach
 * @param {Function|Object} params.condition On-chain condition
 * @returns {Promise<Object>} Transaction receipt details
 */
async function sendConditionalPayment({ to, amount, memo, condition }) {
  if (!condition) {
    throw new Error('Validation Error: "condition" is required.');
  }

  const currentWallet = getActiveWallet();

  // 1. Evaluate on-chain condition
  let conditionMet = false;
  try {
    conditionMet = await evalCondition(currentWallet.provider, condition);
  } catch (condErr) {
    throw new Error(`Condition Evaluation Failed: ${sanitizeErrorMessage(condErr.message)}`);
  }

  if (!conditionMet) {
    throw new Error('Condition Not Met: Payment aborted.');
  }

  // 2. Delegate to sendPayment (handles limits, validation, execution, and verification)
  return sendPayment({ to, amount, memo });
}

/**
 * Estimates the gas and total cost in PROS for a potential payment.
 * @param {Object} params Payment details
 * @param {string} params.to Recipient EVM address
 * @param {number|string} params.amount Amount in PROS tokens
 * @param {string} [params.memo] Optional memo to attach
 * @returns {Promise<{gasLimit: string, gasPrice: string, gasCost: string, totalCost: string}>} Cost breakdown
 */
async function estimatePaymentCost({ to, amount, memo }) {
  // 1. Validate inputs
  validatePaymentInput(to, amount, memo);

  const currentWallet = getActiveWallet();
  const val = ethers.parseEther(amount.toString());
  const data = memo ? ethers.hexlify(ethers.toUtf8Bytes(memo)) : '0x';

  // 2. Fetch gas price
  let gasPrice = ethers.parseUnits('1', 'gwei');
  try {
    const feeData = await currentWallet.provider.getFeeData();
    gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? gasPrice;
  } catch (feeErr) {
    // Ignore error and use fallback
  }

  // 3. Estimate gas limit
  let gasLimit;
  try {
    gasLimit = await currentWallet.estimateGas({
      to,
      value: val,
      data
    });
  } catch (err) {
    try {
      gasLimit = await currentWallet.estimateGas({
        to,
        value: 0n,
        data
      });
    } catch (err2) {
      const dataLen = memo ? ethers.toUtf8Bytes(memo).length : 0;
      gasLimit = 21000n + BigInt(dataLen * 16);
    }
  }

  // 4. Calculate costs
  const gasCostWei = gasLimit * gasPrice;
  const gasCost = ethers.formatEther(gasCostWei);
  const totalCost = ethers.formatEther(val + gasCostWei);

  return {
    gasLimit: gasLimit.toString(),
    gasPrice: gasPrice.toString(),
    gasCost,
    totalCost
  };
}

module.exports = {
  sendPayment,
  sendBatchPayment,
  sendConditionalPayment,
  estimatePaymentCost,
  getTransactionHistory,
  clearTransactionHistory,
  setWallet,
  getActiveWallet
};

