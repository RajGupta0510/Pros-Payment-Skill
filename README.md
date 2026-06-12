# PROS Payment Skill

The **PROS Payment Skill** is a production-grade, highly secure transaction engine designed for autonomous AI agents operating on the EVM-compatible **Pharos Network** L1 blockchain. It handles native PROS token transfers, batch payments, rate limiting protection, cost estimation, transaction history logs, and transaction status verification.

### Solving the Transaction Problem for AI Agents
Autonomous AI agents require a deterministic and resilient mechanism to interact with the blockchain. Standard web3 tools lack the guardrails needed for automated systems, placing wallets at risk of budget drains, transaction lockups from nonce collisions, or execution failures due to sudden network congestion. The **PROS Payment Skill** solves these challenges by providing agents with built-in spending limits, pre-flight gas cost estimations, conditional execution gates based on contract states, and self-reconciling rollback loops. This ensures that agents can transact independently and safely within precise operational parameters without manual developer oversight.

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
                  ├─► 3. Check Limits (rateLimiter.checkLimit)
                  │      │
                  │      └─► Pre-flight check to verify that sending does not exceed spend cap limits.
                  │
                  ├─► 4. Execute Transaction (sendPayment / sendBatchPayment)
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

## Why PROS Payment Skill?


In decentralized agent networks, the ability to transact is as fundamental as the ability to reason. Every agent needs to pay for API usage, purchase data feeds, trigger on-chain workflows, or execute financial trades. The **PROS Payment Skill** is the foundational primitive for Pharos agents because:
1. **Agent Self-Preservation**: Built-in rate limiting prevents loops from draining wallet balances.
2. **Predictive Budgeting**: Pre-flight cost estimation allows agents to decide whether to trigger transactions based on current gas prices before spending gas.
3. **Conditional Logic**: Agents can execute "conditional" transfers based on contract read outputs (e.g. check oracle prices or token balances) without writing custom smart contracts.
4. **Resilience**: Features like parallel batching with manual nonce tracking and automatic rate-limit rollbacks ensure agents do not lock up or halt under network congestion.

---

## Technology Stack

The PROS Payment Skill is built using the following core technologies:
*   **Runtime**: Node.js (v18+)
*   **Web3 Library**: ethers.js (v6)
*   **Unit Testing**: Jest (v29+)
*   **Language**: JavaScript (ES6+ / CommonJS)

---

## Pharos Skill Engine Standard

This Skill is fully compliant with the official Pharos Skill Engine standard:
*   This Skill follows the official Pharos Skill Engine standard.
*   `SKILL.md` maps all 10 capabilities in the Pharos Capability Index format.
*   `references/transaction.md` documents all functions in Pharos reference file format.
*   `assets/networks.json` contains network configuration for Atlantic Testnet and Mainnet.

---

## Project File Structure

The workspace layout is structured as follows:
```text
├── assets/
│   └── networks.json         # Pharos Network configuration file
├── references/
│   └── transaction.md        # Detailed documentation for all 10 payment functions
├── config.js                 # Environment variable validator and loader
├── rateLimiter.js            # In-memory rolling spend limit manager
├── payment.js                # Core transaction engines and network queries
├── index.js                  # Entrypoint module exporting capabilities
├── schema.json               # Anvita Flow JSON Schema describing skill capabilities
├── test.js                   # Mock unit test suite (44 tests passing)
├── demo.js                   # Live Atlantic Testnet diagnostic script
├── SKILL.md                  # Pharos Skill Engine standard mapping
└── TECHNICAL_REPORT.md       # Final project architectural report
```

---

## Feature Matrix

The payment skill provides a robust suite of 10 core features:

| # | Feature Name | Description | Key Benefit |
| :--- | :--- | :--- | :--- |
| 1 | **Single Payment Engine** | Sends native PROS to an address with input sanitization and gas-bound checks. | Fast, secure transfers. |
| 2 | **Sequential Batch Payments** | Submits multiple payments in one call, tracking nonces manually to prevent collision. | Parallel submission without stuck nonces. |
| 3 | **In-Memory Rate Limiting** | Rolls hourly (100 PROS) and daily (500 PROS) spending caps per address. | Protects agent wallet from drainage loops. |
| 4 | **Polling & Verification** | Monitors transaction confirmation up to 60 seconds with timestamp extraction. | Assures state finality for agent workflows. |
| 5 | **Conditional Payments** | Execution gated by custom JS callbacks, balance limits, or contract read states. | Enables autonomous logic gates before sending. |
| 6 | **Gas & Cost Estimation** | Preview gas limits and gas costs in PROS (includes fallback for unfunded wallets). | Pre-flight budget verification. |
| 7 | **Session Transaction History** | In-memory `Map` tracking of all session transactions and execution statuses. | Allows agents to audit their own transactions. |
| 8 | **Check Wallet Balance** | Queries the provider for the native balance of any EVM address. | Verifies wallet capital before dispatching task. |
| 9 | **Pharos Network Status** | Returns responsive checks, current block height, chain ID, and network name. | Pre-flight network readiness evaluation. |
| 10 | **Custom Structured Errors** | Emits `PaymentSkillError` with explicit `errorCode` and `retryable` flags. | Structured error recovery for agent pipelines. |

---

## Installation & Setup

### Requirements
* Node.js (v18+)
* NPM (v9+)

### 1. Install Dependencies
Clone the repository and install the dependencies locally:
```bash
npm install
```

### 2. Configure Environment variables (`.env`)
Copy the environment template and define your credentials:
```bash
cp .env.example .env
```

Open the `.env` file and set the variables:
```env
# EVM-compatible Pharos Network RPC endpoint
PHAROS_RPC_URL=https://rpc.pharos.network

# Private key of the sending wallet
# WARNING: Keep this secure. Never commit this to version control.
PRIVATE_KEY=0xYOUR_32_BYTE_PRIVATE_KEY_HEX

# (Optional) Chain ID of the Pharos Network
CHAIN_ID=
```

---

## Code Examples (Agent Integrations)

### 1. Single Payment (`sendPayment`)
```javascript
const { sendPayment } = require('./index');

async function executePayment() {
  try {
    const receipt = await sendPayment({
      to: '0xF4976883a299115f19057718a674C38B1a8004A1',
      amount: '5.0',
      memo: 'Agent service fee payment'
    });
    console.log('Payment executed:', receipt);
    // Returns: { txHash, blockNumber, status: 'success', timestamp }
  } catch (error) {
    console.error(`Error (${error.errorCode}):`, error.errorMessage);
  }
}
executePayment();
```

### 2. Batch Payments (`sendBatchPayment`)
```javascript
const { sendBatchPayment } = require('./index');

async function executeBatch() {
  try {
    const receipts = await sendBatchPayment({
      payments: [
        { to: '0xF4976883a299115f19057718a674C38B1a8004A1', amount: '1.5', memo: 'Batch P1' },
        { to: '0x2222222222222222222222222222222222222222', amount: '2.5', memo: 'Batch P2' }
      ]
    });
    console.log('Batch results:', receipts);
  } catch (error) {
    console.error(`Batch Failed (${error.errorCode}):`, error.errorMessage);
  }
}
executeBatch();
```

### 3. Conditional Payments (`sendConditionalPayment`)
```javascript
const { sendConditionalPayment } = require('./index');

async function executeConditional() {
  try {
    const receipt = await sendConditionalPayment({
      to: '0xF4976883a299115f19057718a674C38B1a8004A1',
      amount: '1.0',
      condition: {
        type: 'balance',
        targetAddress: '0xF4976883a299115f19057718a674C38B1a8004A1',
        minBalance: '10.0' // Only pay if the target address has at least 10 PROS
      }
    });
    console.log('Conditional Payment Sent:', receipt);
  } catch (error) {
    console.error('Condition failed or payment failed:', error.errorMessage);
  }
}
executeConditional();
```

### 4. Check Rate Limits (`rateLimiter.checkLimit`)
```javascript
const { rateLimiter } = require('./index');

try {
  rateLimiter.checkLimit('0xF4976883a299115f19057718a674C38B1a8004A1', '50.0');
  console.log('Allowed to send.');
} catch (error) {
  console.error(`Check failed: ${error.message}`);
}
```

### 5. Manual Limit Reservation (`rateLimiter.record` & `rateLimiter.rollback`)
```javascript
const { rateLimiter } = require('./index');

const address = '0xF4976883a299115f19057718a674C38B1a8004A1';
const amount = '15.0';

try {
  rateLimiter.checkLimit(address, amount);
  const recordTs = rateLimiter.record(address, amount);
  
  // Perform custom transaction...
  const success = false;
  
  if (!success) {
    rateLimiter.rollback(address, amount, recordTs);
    console.log('Reservation rolled back.');
  }
} catch (error) {
  console.error(error.message);
}
```

### 6. Pre-flight Cost Estimation (`estimatePaymentCost`)
```javascript
const { estimatePaymentCost } = require('./index');

async function getEstimation() {
  const cost = await estimatePaymentCost({
    to: '0xF4976883a299115f19057718a674C38B1a8004A1',
    amount: '10.0',
    memo: 'Gas check'
  });
  console.log('Cost Estimation:', cost);
  // Returns: { gasLimit, gasPrice, gasCost, totalCost }
}
getEstimation();
```

### 7. Session Transaction Logs (`getTransactionHistory`)
```javascript
const { getTransactionHistory } = require('./index');

async function showLogs() {
  const history = await getTransactionHistory();
  console.log('Transactions Sent This Session:', history);
}
showLogs();
```

### 8. Balance Queries (`checkBalance`)
```javascript
const { checkBalance } = require('./index');

async function showBalance() {
  const balance = await checkBalance('0xF4976883a299115f19057718a674C38B1a8004A1');
  console.log(`Balance: ${balance} PROS`);
}
showBalance();
```

### 9. Check Pharos Network Status (`getPharosNetworkStatus`)
```javascript
const { getPharosNetworkStatus } = require('./index');

async function showNetwork() {
  const status = await getPharosNetworkStatus();
  console.log('Pharos Status:', status);
  // Returns: { blockNumber, chainId, networkName, gasPricePros, healthy }
}
showNetwork();
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

*   **Zero Hardcoded Secrets**: 
    *   No private keys, seed phrases, or RPC tokens are hardcoded.
    *   Configuration settings are loaded dynamically at runtime from environment variables using a safe loader (`config.js`).
*   **Comprehensive Test Coverage**:
    *   The Jest unit test suite contains **44 tests** verifying all 10 core capabilities, edge cases, input validation, and rollback scenarios, with all **44 tests passing** successfully.
    *   The unit test suite (`test.js`) dynamically generates disposable mock keys (`ethers.Wallet.createRandom().privateKey`) during setup, preventing static analysis tools from throwing false-positive leaked key alerts.
*   **Unauthorized Network Access Control**:
    *   Enforces secure endpoint bindings and strict domain structures. Arbitrary RPC url injections or malicious redirect options are prohibited.
*   **No Shell/Command Executions**:
    *   All blockchain operations are completed using standard JS classes and the Ethers library.
    *   System command executions (`exec`, `eval`, `spawn`, `execSync`) are not used, eliminating command injection risks.
*   **No Data/Credential Leakage**:
    *   Detailed RPC endpoints or server tokens are redacted. The helper function `sanitizeErrorMessage()` parses all error stack traces and redacts URL endpoints containing potential credentials into a safe placeholder: `[REDACTED_RPC_URL]`.
*   **Fail-Fast Parameter Sanitation**:
    *   Inputs (EVM addresses, positive limits, and string boundaries) are validated before signatures are generated or transactions are sent, preventing unnecessary gas loss.
*   **Optimistic State Allocation & Rollbacks**:
    *   Spending limits are reserved prior to sending. If a transaction fails to submit, times out, or reverts on-chain, the rate-limiter automatically reverts the reserved allocation, preventing wallet lockouts due to network congestion.

---

## Live Proof of Testing

During verified dry runs on the **Pharos Atlantic Testnet**, the payment skill successfully connected and broadcasted live transactions.

*   **Verified Test Transaction Hash**: `0x35b764752b368e3ca187dce30bae559eddb59c01ce0f3c14706e310e4aa0ad65`
*   **Network**: Pharos Atlantic Testnet (Chain ID: `688689`)
*   **Gas Used**: `21,000` units
*   **Native Value Transferred**: `0.0001` PROS

---

## Verification

To execute the local Jest unit test suite containing **44 tests**:
```bash
npm test
```
