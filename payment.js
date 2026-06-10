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
 * Custom Error class for payment skill errors providing structured metadata.
 */
class PaymentSkillError extends Error {
  constructor(errorCode, errorMessage, retryable = false) {
    super(errorMessage);
    this.errorCode = errorCode;
    this.errorMessage = errorMessage;
    this.retryable = retryable;
    this.name = 'PaymentSkillError';
  }
}

/**
 * Maps standard blockchain/library errors to structured PaymentSkillErrors.
 * @param {Error} err Raw error
 * @returns {PaymentSkillError} The mapped structured error
 */
function mapToPaymentSkillError(err) {
  if (err instanceof PaymentSkillError) return err;

  const msg = err.message || '';
  let errorCode = 'NETWORK_ERROR';
  let retryable = true;

  if (msg.includes('insufficient funds') || err.code === 'INSUFFICIENT_FUNDS') {
    errorCode = 'INSUFFICIENT_FUNDS';
    retryable = false;
  } else if (msg.includes('timeout') || msg.includes('timed out') || err.code === 'TIMEOUT') {
    errorCode = 'TIMEOUT';
    retryable = true;
  } else if (msg.includes('invalid address') || msg.includes('is not a valid EVM address')) {
    errorCode = 'INVALID_ADDRESS';
    retryable = false;
  } else if (msg.includes('Rate limit exceeded')) {
    errorCode = 'RATE_LIMIT_EXCEEDED';
    retryable = false;
  } else if (msg.includes('Validation Error') || msg.includes('must be a positive number') || msg.includes('is required') || msg.includes('exceeds the limit')) {
    errorCode = 'INVALID_INPUT';
    retryable = false;
  } else if (msg.includes('revert') || msg.includes('reverted') || msg.includes('Condition Not Met') || msg.includes('Condition Evaluation Failed') || msg.includes('Payment Execution Error') || msg.includes('Batch submission failed')) {
    errorCode = 'EXECUTION_REVERTED';
    retryable = false;
  }

  return new PaymentSkillError(errorCode, sanitizeErrorMessage(msg), retryable);
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
    throw new PaymentSkillError('NETWORK_ERROR', 'Payment Skill Error: Wallet is not initialized.', true);
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
    throw new PaymentSkillError('INVALID_INPUT', 'Validation Error: Recipient address ("to") is required.', false);
  }
  if (!ethers.isAddress(to)) {
    throw new PaymentSkillError('INVALID_ADDRESS', `Validation Error: "${truncateInput(to)}" is not a valid EVM address.`, false);
  }

  if (amount === undefined || amount === null) {
    throw new PaymentSkillError('INVALID_INPUT', 'Validation Error: Transfer "amount" is required.', false);
  }
  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    throw new PaymentSkillError('INVALID_INPUT', `Validation Error: Amount must be a positive number. Got: "${truncateInput(amount)}"`, false);
  }

  if (memo !== undefined && memo !== null) {
    if (typeof memo !== 'string') {
      throw new PaymentSkillError('INVALID_INPUT', 'Validation Error: "memo" must be a string.', false);
    }
    if (memo.length > 1000) {
      throw new PaymentSkillError('INVALID_INPUT', 'Validation Error: "memo" length exceeds the limit of 1000 characters.', false);
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
  try {
    // 1. Validate inputs
    validatePaymentInput(to, amount, memo);

    const currentWallet = getActiveWallet();
    const senderAddress = await currentWallet.getAddress();

    // 2. Rate limiting check (MUST run BEFORE any transaction)
    try {
      rateLimiter.checkLimit(senderAddress, amount);
    } catch (limErr) {
      throw new PaymentSkillError('RATE_LIMIT_EXCEEDED', limErr.message, false);
    }

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

      // Map to exact custom error prefix expected by tests
      let mappedErr = err;
      if (!(err instanceof PaymentSkillError)) {
        if (err.code === 'TIMEOUT' || err.message.includes('timeout')) {
          mappedErr = new PaymentSkillError('TIMEOUT', `Transaction Timeout Error: Payment submission succeeded but confirmation timed out after 60 seconds. TxHash: ${truncateInput(err.transactionHash || 'unknown')}`, true);
        } else {
          mappedErr = new PaymentSkillError('EXECUTION_REVERTED', `Payment Execution Error: ${sanitizeErrorMessage(err.message)}`, false);
        }
      }
      throw mapToPaymentSkillError(mappedErr);
    }
  } catch (err) {
    throw mapToPaymentSkillError(err);
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
  let totalAmount = 0;
  let senderAddress;
  let recordTs;
  try {
    // 1. Validate input batch structure
    if (!payments || !Array.isArray(payments) || payments.length === 0) {
      throw new PaymentSkillError('INVALID_INPUT', 'Validation Error: "payments" must be a non-empty array.', false);
    }

    // 2. Validate individual payments and sum total amount
    for (let i = 0; i < payments.length; i++) {
      const payment = payments[i];
      try {
        validatePaymentInput(payment.to, payment.amount, payment.memo);
      } catch (err) {
        throw new PaymentSkillError('INVALID_INPUT', `Validation Error at index ${i}: ${err.message}`, false);
      }
      totalAmount += parseFloat(payment.amount);
    }

    const currentWallet = getActiveWallet();
    senderAddress = await currentWallet.getAddress();

    // 3. Rate limiting check (MUST run BEFORE any transaction)
    try {
      rateLimiter.checkLimit(senderAddress, totalAmount);
    } catch (limErr) {
      throw new PaymentSkillError('RATE_LIMIT_EXCEEDED', limErr.message, false);
    }

    // 4. Record transaction in rate limiter (optimistically)
    recordTs = rateLimiter.record(senderAddress, totalAmount);

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
          throw new PaymentSkillError('EXECUTION_REVERTED', `Batch submission failed at index ${i}: ${sanitizeErrorMessage(submitErr.message)}`, false);
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
      throw mapToPaymentSkillError(err);
    }
  } catch (err) {
    if (senderAddress && recordTs) {
      rateLimiter.rollback(senderAddress, totalAmount, recordTs);
    }
    let mappedErr = err;
    if (!(err instanceof PaymentSkillError)) {
      mappedErr = new PaymentSkillError('NETWORK_ERROR', `Batch Payment Execution Error: ${sanitizeErrorMessage(err.message)}`, true);
    }
    throw mapToPaymentSkillError(mappedErr);
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
        throw new PaymentSkillError('INVALID_ADDRESS', 'Invalid balance check condition: "targetAddress" is missing or invalid.', false);
      }
      if (minBalance === undefined || isNaN(parseFloat(minBalance))) {
        throw new PaymentSkillError('INVALID_INPUT', 'Invalid balance check condition: "minBalance" must be a valid number representation.', false);
      }
      const balance = await provider.getBalance(targetAddress);
      const minBalanceWei = ethers.parseEther(minBalance.toString());
      return balance >= minBalanceWei;
    }
    
    if (type === 'contractCall') {
      const { address, abi, method, args = [], expected } = condition;
      if (!address || !ethers.isAddress(address)) {
        throw new PaymentSkillError('INVALID_ADDRESS', 'Invalid contractCall condition: "address" is missing or invalid.', false);
      }
      if (!abi || !Array.isArray(abi)) {
        throw new PaymentSkillError('INVALID_INPUT', 'Invalid contractCall condition: "abi" must be a valid array.', false);
      }
      if (!method || typeof method !== 'string') {
        throw new PaymentSkillError('INVALID_INPUT', 'Invalid contractCall condition: "method" must be a valid method name string.', false);
      }
      
      const contract = new ethers.Contract(address, abi, provider);
      const res = await contract[method](...args);
      
      // Compare values, converting BigInts to string for safe comparison
      if (typeof res === 'bigint') {
        return res.toString() === expected.toString();
      }
      return res === expected;
    }
    
    throw new PaymentSkillError('INVALID_INPUT', `Unsupported condition type: "${type}"`, false);
  }

  throw new PaymentSkillError('INVALID_INPUT', 'Condition must be a function or an object.', false);
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
  try {
    if (!condition) {
      throw new PaymentSkillError('INVALID_INPUT', 'Validation Error: "condition" is required.', false);
    }

    const currentWallet = getActiveWallet();

    // 1. Evaluate on-chain condition
    let conditionMet = false;
    try {
      conditionMet = await evalCondition(currentWallet.provider, condition);
    } catch (condErr) {
      throw new PaymentSkillError('EXECUTION_REVERTED', `Condition Evaluation Failed: ${sanitizeErrorMessage(condErr.message)}`, false);
    }

    if (!conditionMet) {
      throw new PaymentSkillError('EXECUTION_REVERTED', 'Condition Not Met: Payment aborted.', false);
    }

    // 2. Delegate to sendPayment (handles limits, validation, execution, and verification)
    return sendPayment({ to, amount, memo });
  } catch (err) {
    throw mapToPaymentSkillError(err);
  }
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
  try {
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
  } catch (err) {
    throw mapToPaymentSkillError(err);
  }
}

/**
 * Returns the native PROS balance of any EVM address.
 * @param {string} address The EVM address to query
 * @returns {Promise<string>} Balance formatted in PROS (decimal string)
 */
async function checkBalance(address) {
  try {
    if (!address) {
      throw new PaymentSkillError('INVALID_INPUT', 'Validation Error: Wallet address is required.', false);
    }
    if (!ethers.isAddress(address)) {
      throw new PaymentSkillError('INVALID_ADDRESS', `Validation Error: "${truncateInput(address)}" is not a valid EVM address.`, false);
    }

    const currentWallet = getActiveWallet();
    const balanceWei = await currentWallet.provider.getBalance(address);
    return ethers.formatEther(balanceWei);
  } catch (err) {
    throw mapToPaymentSkillError(err);
  }
}

module.exports = {
  sendPayment,
  sendBatchPayment,
  sendConditionalPayment,
  estimatePaymentCost,
  getTransactionHistory,
  clearTransactionHistory,
  checkBalance,
  PaymentSkillError,
  setWallet,
  getActiveWallet
};
