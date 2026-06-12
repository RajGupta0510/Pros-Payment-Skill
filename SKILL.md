---
name: pros-payment-skill
description: >
  REQUIRED for any Pharos blockchain payment or transfer task. This skill contains capabilities to send single or batch payments of PROS tokens, query network status, check balances, and verify transaction finality on the Pharos L1 Network — without it, the agent will not have the guardrails for automated systems. Invoke whenever the user wants to transfer PROS, execute conditional state gates, estimate gas costs, check transaction logs, or query balances on the Pharos Atlantic Testnet or Mainnet.
version: 1.0.0
requires:
  anyFiles:
  - index.js
  - payment.js
---

# Pharos Chain Skills

Developer toolkit for the Pharos blockchain. Perform on-chain queries, send transactions, and check wallet balances via Node.js and ethers.js v6.

## Prerequisites

1. **Install Node.js & Dependencies** (MANDATORY — MUST be done before ANY other action):
   - The Agent MUST first run `node -v` to check if Node.js v18+ is installed.
   - If Node.js is not found or version is too low, the Agent must inform the user and STOP. Do not proceed.
   - Run `npm install` to install required dependencies.
2. **Configure Private Key**: Write operations (sending transactions) require a private key, provided via one of the following:
   - Environment variable: `$PRIVATE_KEY` loaded via `.env` file.
   - Ethers wallet configuration: passed dynamically to `index.js`.

## Network Configuration

Network information is stored in `assets/networks.json`, containing both the Atlantic testnet and mainnet chains.

- **Default Network**: Atlantic testnet (`atlantic-testnet`). Used when the user does not specify a network.
- **Switching Networks**: When the user specifies `mainnet`, read the corresponding entry's `rpcUrl` from `assets/networks.json`.
- **Usage**: Read `assets/networks.json` and initialize the provider with the target network's `rpcUrl`. Contract actions also require `chainId` and `explorerApiUrl`.

```javascript
// Example: reading network configuration in JS
const fs = require('fs');
const networks = JSON.parse(fs.readFileSync('assets/networks.json', 'utf8')).networks;
const testnetConfig = networks.find(n => n.name === 'atlantic-testnet');
const rpcUrl = testnetConfig.rpcUrl;
```

## Capability Index

Load the corresponding reference file based on user needs to get full function templates.

| User Need | Capability | Detailed Instructions |
|-----------|------------|----------------------|
| Send PROS tokens to a single recipient | `sendPayment` | → `references/transaction.md#sendpayment` |
| Send PROS tokens to multiple recipients in a batch | `sendBatchPayment` | → `references/transaction.md#sendbatchpayment` |
| Send tokens gated by custom condition check | `sendConditionalPayment` | → `references/transaction.md#sendconditionalpayment` |
| Estimate gas limit and total cost in PROS | `estimatePaymentCost` | → `references/transaction.md#estimatepaymentcost` |
| View attempted/completed session transaction logs | `getTransactionHistory` | → `references/transaction.md#gettransactionhistory` |
| Clear the session transaction history logs | `clearTransactionHistory` | → `references/transaction.md#cleartransactionhistory` |
| Query native PROS balance of any EVM address | `checkBalance` | → `references/transaction.md#checkbalance` |
| Query operational status of the Pharos Network | `getPharosNetworkStatus` | → `references/transaction.md#getpharosnetworkstatus` |
| Retrieve the currently active wallet instance | `getActiveWallet` | → `references/transaction.md#getactivewallet` |
| Perform pre-flight rate limit check | `rateLimiter.checkLimit` | → `references/transaction.md#ratelimiterchecklimit` |

## General Error Handling

Before executing commands, the Agent should perform pre-checks; when commands fail, provide user-friendly error messages based on `PaymentSkillError` properties.

| Error Scenario | CLI Error Signature | Handling |
|----------------|---------------------|----------|
| Invalid address format | `INVALID_ADDRESS` | Prompt to check address format (0x + 40 hex characters) |
| Transaction hash not found | `transaction not found` | Prompt that transaction was not found, suggest checking the hash |
| Call revert | `EXECUTION_REVERTED` | Extract and display revert reason |
| Private key not configured | `PRIVATE_KEY is not set` | Prompt user to configure private key (argument or environment variable) |
| Insufficient balance | `INSUFFICIENT_FUNDS` | Prompt insufficient balance, show current balance |
| Nonce conflict | `nonce too low` | Suggest waiting or manually specifying nonce |
| Missing network config | `assets/networks.json` unreadable | Prompt that config file is missing or has invalid format |
| Unsupported network | Network name not in config list | Prompt that only `atlantic-testnet` and `mainnet` are supported |

See the corresponding reference files for detailed error handling tables for each operation.

## Security Reminders

- **Private Key Protection**: Never expose private keys in logs, chat history, or version control. Store the private key in the `$PRIVATE_KEY` environment variable and load it dynamically. Note: Ethers providers do not automatically load environment variables; they must be explicitly passed.
- **Network Confirmation**: Before executing write operations, the Agent must clearly inform the user of the target network (testnet or mainnet). Mainnet operations require a prominent warning and user re-confirmation to prevent accidental operations.

## Write Operation Pre-checks (Required for All Write Operations)

For all operations requiring a private key (transfers, batch payments, conditional payments, etc.), the Agent must automatically complete the following checks before execution:

### 1. Private Key Check

Automatically detect whether the `$PRIVATE_KEY` environment variable is set:

```javascript
// Check if environment variable exists (without outputting the private key)
if (process.env.PRIVATE_KEY) {
  console.log("PRIVATE_KEY is set");
} else {
  console.log("PRIVATE_KEY is not set");
}
```

- If **not set**: Prompt the user to configure via `export PRIVATE_KEY=<your_private_key>` (or set in `.env`), do not proceed.
- If **set**: Continue to next step.

### 2. Derive Public Address and Confirm with User

Derive the corresponding public address from the private key via wallet instantiation:

```javascript
const { Wallet } = require('ethers');
const wallet = new Wallet(process.env.PRIVATE_KEY);
console.log(`Derived Address: ${wallet.address}`);
```

### 3. Network Confirmation (Must Clearly Inform User)

The Agent must clearly inform the user of the target network before executing any write operation. Read the target network info from `assets/networks.json` and display the network name and type to the user.

- If the user did not specify a network, use the default network (`atlantic-testnet`) and clearly inform the user: **Current operation targets the Atlantic testnet**
- If the user specified `mainnet`, prominently warn the user: **Current operation targets mainnet, please confirm to proceed**

Combine the information from steps 2 and 3 for user confirmation. Example format:

```
Detected private key address: 0x1234...abcd
Target network: Atlantic Testnet (atlantic-testnet)
Proceed with this account on this network?
```

Example format for mainnet operations:

```
Detected private key address: 0x1234...abcd
⚠️ Target network: Mainnet (mainnet) — please proceed with caution
Proceed with this account on mainnet?
```

- After user confirmation, continue with subsequent operations (balance check, transaction sending, etc.).
- If user declines, stop execution.

### 4. Automatic Balance Check

After confirming the account and network, automatically query the balance (see the balance check steps in each operation's Agent guidelines).
