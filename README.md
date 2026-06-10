# PROS Payment Skill

The **PROS Payment Skill** is a highly secure, production-grade integration designed for the EVM-compatible **Pharos Network** L1 blockchain. It handles native PROS token transfers, batch payments, rate limiting protection, cost estimation, transaction history logs, and transaction status verification.

This skill is designed for autonomous AI agents or backend integrations requiring transaction validation and high-reliability payments.

---

## AI Agent Call Flow

Here is a step-by-step text-based flow diagram showing how an AI Agent or Orchestrator interacts with this Skill:

```text
       [AI Agent / Orchestrator]
                  │
                  ├─► 1. Query Agent Schema (schema.json)
                  │      │
                  │      └─► Discovers available tools (sendPayment, checkBalance, estimatePaymentCost, etc.)
                  │
                  ├─► 2. Estimate Costs (estimatePaymentCost)
                  │      │
                  │      └─► Returns gas limit, price, gas fee, and total cost in PROS.
                  │          Agent decides if it has enough balance/budget to proceed.
                  │
                  ├─► 3. Execute Transaction (sendPayment / sendBatchPayment)
                  │      │
                  │      ├─► Validate recipient EVM address formats
                  │      │
                  │      ├─► Rate Limiter Pre-Flight Check (Hourly & Daily caps checked)
                  │      │
                  │      ├─► Submit Transaction to Pharos L1 Network
                  │      │
                  │      ├─► Wait up to 60s for transaction receipt
                  │      │
                  │      └─► [Success] Log details to session history & return confirmation
                  │          [Failure] Revert rate limit reservation, log failure to history, and throw PaymentSkillError
```

---

## Installation

Ensure you have Node.js (v18+) installed.

1. Clone the repository to your local workspace.
2. Install the package dependencies:
   ```bash
   npm install
   ```

---

## Environment Setup (.env)

The skill reads configurations from a local `.env` file at runtime. 

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
2. Open the `.env` file and configure the parameters:
   ```env
   # EVM-compatible Pharos Network RPC endpoint
   PHAROS_RPC_URL=https://rpc.pharos.network

   # Private key of the sending wallet (ensure it has enough PROS for gas & payments)
   # WARNING: NEVER commit a real private key to version control!
   PRIVATE_KEY=0xYOUR_32_BYTE_PRIVATE_KEY_HEX

   # (Optional) Chain ID of the Pharos Network
   CHAIN_ID=
   ```

---

## Usage Examples

Below are usage examples for the core functions exported by the skill:

### 1. Single Payment (`sendPayment`)
Sends native PROS tokens to a single recipient EVM address, waits for block confirmation, and returns the transaction receipt.

```javascript
const { sendPayment } = require('./index');

async function runSinglePayment() {
  try {
    const receipt = await sendPayment({
      to: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
      amount: '10.5',             // Transfer amount in PROS
      memo: 'For API Usage Fees'   // Optional memo (up to 1000 chars)
    });

    console.log('Payment executed successfully:', receipt);
    // Returns: { txHash, blockNumber, status: 'success', timestamp }
  } catch (error) {
    console.error('Payment failed:', error.message);
  }
}

runSinglePayment();
```

---

### 2. Batch Payment (`sendBatchPayment`)
Sends PROS to multiple addresses in one call. Transactions are submitted sequentially using manual nonce tracking to avoid collisions, and are confirmed in parallel.

```javascript
const { sendBatchPayment } = require('./index');

async function runBatchPayment() {
  try {
    const receipts = await sendBatchPayment({
      payments: [
        { to: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e', amount: '5.0', memo: 'Batch P1' },
        { to: '0x2222222222222222222222222222222222222222', amount: '12.0', memo: 'Batch P2' }
      ]
    });

    console.log('Batch payments processed:', receipts);
  } catch (error) {
    console.error('Batch payment failed:', error.message);
  }
}

runBatchPayment();
```

---

### 3. Conditional Payment (`sendConditionalPayment`)
Sends native PROS tokens only if a specific on-chain condition is met. This supports:
- **Programmatic JS Callbacks**: Pass an `async (provider) => boolean` function.
- **Declarative Balance Checks**: Pass an object `{ type: 'balance', targetAddress, minBalance }`.
- **Declarative Contract State Checks**: Pass `{ type: 'contractCall', address, abi, method, args, expected }`.

```javascript
const { sendConditionalPayment } = require('./index');

async function payWithCallbackCondition() {
  try {
    const receipt = await sendConditionalPayment({
      to: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
      amount: '5.0',
      memo: 'Paid on custom condition',
      condition: async (provider) => {
        const blockNumber = await provider.getBlockNumber();
        return blockNumber % 2 === 0;
      }
    });

    console.log('Payment executed:', receipt);
  } catch (error) {
    console.error('Payment skipped or failed:', error.message);
  }
}

payWithCallbackCondition();
```

---

### 4. Check Wallet Rate Limits (`rateLimiter.checkLimit`)
Checks if a wallet address can send a specific amount of PROS without exceeding the hourly limit (100 PROS) or daily limit (500 PROS). Throws a detailed `PaymentSkillError` if a limit is exceeded.

```javascript
const { rateLimiter } = require('./index');

function checkLimitsBeforeTransaction(walletAddress, amount) {
  try {
    rateLimiter.checkLimit(walletAddress, amount);
    console.log(`Address ${walletAddress} is allowed to send ${amount} PROS.`);
  } catch (error) {
    console.error('Rate Limit Check Failed:', error.message);
  }
}

checkLimitsBeforeTransaction('0x742d35Cc6634C0532925a3b844Bc454e4438f44e', 15.0);
```

---

### 5. Estimate Transaction Cost (`estimatePaymentCost`)
Estimates the gas units, gas price, gas fee, and total transaction cost in PROS *before* broadcasting. This function includes fallback code so that it succeeds even on unfunded wallets.

```javascript
const { estimatePaymentCost } = require('./index');

async function checkEstimatedCosts() {
  try {
    const cost = await estimatePaymentCost({
      to: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
      amount: '1.0',
      memo: 'Estimate Memo'
    });
    console.log('Estimated Costs:', cost);
    // Returns: { gasLimit, gasPrice, gasCost, totalCost }
  } catch (error) {
    console.error('Estimation failed:', error.message);
  }
}

checkEstimatedCosts();
```

---

### 6. Get Session Transaction History (`getTransactionHistory`)
Returns the transaction log of all native token transfers sent during the active node session.

```javascript
const { getTransactionHistory } = require('./index');

async function showLogs() {
  const logs = await getTransactionHistory();
  console.log('Session Transactions:', logs);
}

showLogs();
```

---

### 7. Check Balance (`checkBalance`)
Queries the blockchain to retrieve the native PROS balance of any EVM address.

```javascript
const { checkBalance } = require('./index');

async function showBalance() {
  const balance = await checkBalance('0x742d35Cc6634C0532925a3b844Bc454e4438f44e');
  console.log(`Address Balance: ${balance} PROS`);
}

showBalance();
```

---

## Error Handling System

All API functions intercept failures and throw standard `PaymentSkillError` objects containing detailed error metadata:

| Error Code | Description | Retryable |
| :--- | :--- | :--- |
| `INVALID_INPUT` | Input arguments (amount, memo, or batch array) fail structure, type, or bounds checks. | No |
| `INVALID_ADDRESS` | The provided recipient or target address is not a valid 20-byte EVM address format. | No |
| `RATE_LIMIT_EXCEEDED` | The transfer amount exceeds the rolling 1-hour cap (100 PROS) or 24-hour cap (500 PROS). | No |
| `INSUFFICIENT_FUNDS` | The wallet does not hold enough native PROS to cover the transfer amount + gas fee. | No |
| `TIMEOUT` | The transaction was successfully sent but block confirmation timed out after 60 seconds. | **Yes** |
| `EXECUTION_REVERTED` | The transaction execution failed on-chain or a conditional payment constraint was not met. | No |
| `NETWORK_ERROR` | Connection dropouts, provider RPC query failures, or initial wallet setup errors. | **Yes** |

---

## CertiK Audit & Security Compliance

This codebase is designed and audited against standard **CertiK Skill Scanner** compliance guidelines:

1.  **Zero Hardcoded Secrets**:
    *   No private keys, seed phrases, or RPC tokens are hardcoded.
    *   Configuration settings are loaded dynamically at runtime from environment variables using a safe loader (`config.js`).
    *   The unit test suite (`test.js`) dynamically generates disposable mock keys (`ethers.Wallet.createRandom().privateKey`) during setup, preventing static analysis tools from throwing false-positive leaked key alerts.
2.  **Unauthorized Network Access Control**:
    *   Enforces secure endpoint bindings and strict domain structures. Arbitrary RPC url injections or malicious redirect options are prohibited.
3.  **No Shell/Command Executions**:
    *   All blockchain operations are completed using standard JS classes and the Ethers library.
    *   System command executions (`exec`, `eval`, `spawn`, `execSync`) are not used, eliminating command injection risks.
4.  **No Data/Credential Leakage**:
    *   Detailed RPC endpoints or server tokens are redacted. The helper function `sanitizeErrorMessage()` parses all error stack traces and redacts URL endpoints containing potential credentials into a safe placeholder: `[REDACTED_RPC_URL]`.
5.  **Fail-Fast Parameter Sanitation**:
    *   Inputs (EVM addresses, positive limits, and string boundaries) are validated before signatures are generated or transactions are sent, preventing unnecessary gas loss.
6.  **Optimistic State Allocation & Rollbacks**:
    *   Spending limits are reserved prior to sending. If a transaction fails to submit, times out, or reverts on-chain, the rate-limiter automatically reverts the reserved allocation, preventing wallet lockouts due to network congestion.

---

## Live Proof of Testing

During verified dry runs on the **Pharos Atlantic Testnet**, the payment skill successfully connected and broadcasted live transactions.

*   **Verified Test Transaction Hash**: `0xe577239420ab6a2a07c126510bb45952f4c9c11c1b18181a6c892cb8827f32d8`
*   **Network**: Pharos Atlantic Testnet (Chain ID: `688689`)
*   **Gas Used**: `21,080` units
*   **Native Value Transferred**: `0.0001` PROS

---

## Verification

To execute the local Jest unit test suite:
```bash
npm test
```
