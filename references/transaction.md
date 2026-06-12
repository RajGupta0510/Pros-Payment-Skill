# PROS Payment Operation Instructions

This file contains detailed instructions for all PROS payment and query operations on the Pharos chain, covering sending payments, batch transactions, conditional transfers, cost estimations, and history checks.

> **Network Configuration**: The RPC endpoint parameter in all functions is read from the corresponding network's `rpcUrl` field in `assets/networks.json`. Defaults to the Atlantic testnet.
>
> **Private Key Configuration**: All write operations require a configured private key. Recommended to use environment variable `$PRIVATE_KEY` or load it dynamically via `config.js`.

---

## sendPayment

**Overview**
Sends native PROS tokens to a single recipient EVM address with built-in spending limits, pre-flight checks, on-chain verification, and self-reconciling rollback loops.

**Command Template**
```javascript
const { sendPayment } = require('./index');

const receipt = await sendPayment({
  to: "0xF4976883a299115f19057718a674C38B1a8004A1",
  amount: "5.0",
  memo: "Payment for services rendered"
});
```

**Parameters**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `to` | string | Yes | Recipient address, format: `0x` + 40 hex characters |
| `amount` | string | Yes | Transfer amount in PROS tokens (e.g., `"10.0"`) |
| `memo` | string | No | Optional transfer memo (up to 1000 characters) |

**Output Parsing**
The function waits for transaction confirmation and returns the transaction receipt details:
| Field | Type | Description |
|-------|------|-------------|
| `txHash` | string | Hex transaction hash of the execution |
| `blockNumber` | number | The block number in which the transaction was mined |
| `status` | string | Confirmation status (`success` or `failed`) |
| `timestamp` | string | ISO 8601 timestamp of block confirmation |

**Error Handling**
| Error Signature | Cause | Suggested Action |
|-----------------|-------|------------------|
| `INVALID_ADDRESS` | Recipient address format is invalid | Check address spelling and verify it is a 40-character hex string |
| `INVALID_INPUT` | Amount is negative, zero, or has invalid format | Verify the amount parameter is positive and a valid number |
| `RATE_LIMIT_EXCEEDED` | Sending amount violates rolling 1-hour or 24-hour limit | Wait for the rolling limit window to clear, or reduce transfer size |
| `INSUFFICIENT_FUNDS` | Sending account has insufficient PROS for value + gas fee | Fund the active sending wallet with native PROS tokens |
| `TIMEOUT` | Transaction submitted but block confirmation timed out | Check network status or transaction hash on explorer |
| `EXECUTION_REVERTED` | Transaction reverted during execution on-chain | Verify target address contract logic or parameters |

> **Agent Guidelines**: Complete the "Write Operation Pre-checks" (see SKILL.md) before execution, which includes the network confirmation step — must clearly inform the user of the target network (testnet or mainnet). Automatically query sender balance via `checkBalance(sender)` and confirm balance ≥ transfer amount + estimated gas fees. If balance is insufficient, inform the user directly without executing. After successful transaction, display the transaction hash and include a block explorer transaction link: `<explorerUrl>/tx/<txHash>`. If a `TIMEOUT` error occurs, inform the user that the transaction is pending.

---

## sendBatchPayment

**Overview**
Sends PROS tokens to multiple recipients sequentially. Nonces are managed manually to prevent collision.

**Command Template**
```javascript
const { sendBatchPayment } = require('./index');

const receipts = await sendBatchPayment({
  payments: [
    { to: "0xF4976883a299115f19057718a674C38B1a8004A1", amount: "1.5", memo: "Batch 1" },
    { to: "0x2222222222222222222222222222222222222222", amount: "2.5", memo: "Batch 2" }
  ]
});
```

**Parameters**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `payments` | array | Yes | Non-empty array of payment objects: `{ to, amount, memo }` |

**Output Parsing**
Returns an array of receipt objects, where each receipt contains:
| Field | Type | Description |
|-------|------|-------------|
| `to` | string | Recipient EVM address |
| `amount` | string | Transfer amount in PROS |
| `memo` | string | Transfer memo (null if not provided) |
| `txHash` | string | Hex transaction hash |
| `blockNumber` | number | Block number mined (optional on failure) |
| `gasUsed` | string | Gas consumed by transaction |
| `status` | string | Confirmation status (`success` or `failed`) |
| `timestamp` | string | ISO 8601 timestamp |
| `error` | string | Raw error message (if status is failed) |

**Error Handling**
| Error Signature | Cause | Suggested Action |
|-----------------|-------|------------------|
| `INVALID_INPUT` | Payments array is empty, missing, or items are invalid | Verify input list structure. |
| `RATE_LIMIT_EXCEEDED` | Total batch sum exceeds spending caps | Reduce total size or wait for rolling window to clear. |
| `EXECUTION_REVERTED` | A transaction failed to submit or reverted on-chain | Examine index where execution halted. Unsent items are rolled back. |

> **Agent Guidelines**: Complete the "Write Operation Pre-checks" (see SKILL.md) before execution. Validate that the input list has at least one recipient and that all amounts are positive. Automatically query sender balance and verify it is sufficient for the total batch sum. Invoke `sendBatchPayment` to dispatch sequential transactions. Report details for all processed items. Note that if a transaction fails on-chain, sequential processing halts. After successful transactions, include a block explorer link for each hash.

---

## sendConditionalPayment

**Overview**
Gates payment execution based on custom logic: balance limits or smart contract read states evaluated on-chain prior to dispatch.

**Command Template**
```javascript
const { sendConditionalPayment } = require('./index');

const receipt = await sendConditionalPayment({
  to: "0xF4976883a299115f19057718a674C38B1a8004A1",
  amount: "1.0",
  condition: {
    type: "balance",
    targetAddress: "0xF4976883a299115f19057718a674C38B1a8004A1",
    minBalance: "10.0"
  }
});
```

**Parameters**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `to` | string | Yes | Recipient EVM address |
| `amount` | string | Yes | Transfer amount in PROS |
| `memo` | string | No | Optional transfer memo |
| `condition` | object \| function | Yes | Condition block (`type: 'balance'` or `type: 'contractCall'`) or custom callback |

**Output Parsing**
Identical to `sendPayment` output.

**Error Handling**
| Error Signature | Cause | Suggested Action |
|-----------------|-------|------------------|
| `INVALID_INPUT` | Condition block properties are missing or type is unsupported | Correct condition schema (balance/contractCall properties) |
| `EXECUTION_REVERTED` | Condition returned false or check failed on-chain | Verify target balance or contract method parameters |

> **Agent Guidelines**: Complete the "Write Operation Pre-checks" (see SKILL.md) before execution. Ensure target condition has correct properties. Call `sendConditionalPayment`. The skill will automatically evaluate the condition on-chain. If the condition fails, the execution reverts without wasting gas. After successful transaction, include a block explorer transaction link: `<explorerUrl>/tx/<txHash>`.

---

## estimatePaymentCost

**Overview**
Estimates the gas units, price, and total PROS cost for a transaction without broadcasting it.

**Command Template**
```javascript
const { estimatePaymentCost } = require('./index');

const cost = await estimatePaymentCost({
  to: "0xF4976883a299115f19057718a674C38B1a8004A1",
  amount: "2.5",
  memo: "Gas pre-flight check"
});
```

**Parameters**
Same as `sendPayment` input parameters.

**Output Parsing**
| Field | Type | Description |
|-------|------|-------------|
| `gasLimit` | string | Estimated gas units (limit) |
| `gasPrice` | string | Current gas price in Wei |
| `gasCost` | string | Estimated gas cost formatted in PROS |
| `totalCost` | string | Estimated total cost (amount + gasCost) in PROS |

**Error Handling**
| Error Signature | Cause | Suggested Action |
|-----------------|-------|------------------|
| `INVALID_INPUT` | Invalid address format or negative amount | Correct parameters and retry |

> **Agent Guidelines**: Use this capability as a pre-flight budget check. Execute `estimatePaymentCost` and verify the `totalCost` is less than the active wallet balance.

---

## getTransactionHistory

**Overview**
Retrieves the logged array of transaction attempts and receipts processed during the current session.

**Command Template**
```javascript
const { getTransactionHistory } = require('./index');

const history = await getTransactionHistory();
```

**Parameters**
None.

**Output Parsing**
Returns an array of session history items:
| Field | Type | Description |
|-------|------|-------------|
| `txHash` | string | Hex transaction hash |
| `timestamp` | string | ISO 8601 transaction block timestamp |
| `recipient` | string | Recipient address |
| `amount` | string | Amount sent in PROS |
| `status` | string | Lifecycle status (`pending`, `success`, `failed`) |

**Error Handling**
No errors are expected from this local operation.

> **Agent Guidelines**: Call this function to audit transaction statuses within the active agent session. Present transaction records clearly in a markdown table format.

---

## clearTransactionHistory

**Overview**
Wipes out all stored session logs from the in-memory transaction history Map.

**Command Template**
```javascript
const { clearTransactionHistory } = require('./index');

clearTransactionHistory();
```

**Parameters**
None.

**Output Parsing**
None.

**Error Handling**
No errors are expected.

> **Agent Guidelines**: Invoke this method at the beginning of new tasks or when resetting state.

---

## checkBalance

**Overview**
Queries the provider to read the native token balance of any EVM address.

**Command Template**
```javascript
const { checkBalance } = require('./index');

const balance = await checkBalance("0xF4976883a299115f19057718a674C38B1a8004A1");
```

**Parameters**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `address` | string | Yes | EVM address to query (hex format, 0x-prefixed) |

**Output Parsing**
Returns the balance as a decimal string in PROS (e.g., `"12.45"`).

**Error Handling**
| Error Signature | Cause | Suggested Action |
|-----------------|-------|------------------|
| `INVALID_ADDRESS` | Input address is not a valid EVM address | Correct address format and query again |

> **Agent Guidelines**: Query the balance of recipient wallets to verify fund routing. Use this function during Write Pre-checks to ensure the sender has sufficient capital.

---

## getPharosNetworkStatus

**Overview**
Retrieves block height, chain ID, gas price, and health status of the Pharos L1 Network.

**Command Template**
```javascript
const { getPharosNetworkStatus } = require('./index');

const status = await getPharosNetworkStatus();
```

**Parameters**
None.

**Output Parsing**
| Field | Type | Description |
|-------|------|-------------|
| `blockNumber` | number | The current network block height |
| `chainId` | string | Network chain ID |
| `networkName` | string | Network name (e.g. `Atlantic Testnet`) |
| `gasPricePros` | string | Current gas price formatted in PROS |
| `healthy` | boolean | True if online and responsive, false otherwise |

**Error Handling**
Returns degraded offline default values if RPC endpoints are unavailable.

> **Agent Guidelines**: Execute this status check before transactions to ensure the network is responsive and online.

---

## getActiveWallet

**Overview**
Returns the active Ethers Wallet instance initialized by the configuration parameters.

**Command Template**
```javascript
const { getActiveWallet } = require('./index');

const wallet = getActiveWallet();
```

**Parameters**
None.

**Output Parsing**
Ethers.js Wallet instance.

**Error Handling**
| Error Signature | Cause | Suggested Action |
|-----------------|-------|------------------|
| `NETWORK_ERROR` | Wallet is not initialized due to bad private key configuration | Verify the PRIVATE_KEY variable in `.env` |

> **Agent Guidelines**: Retrieve the wallet instance only when advanced signatures, custom messaging, or manual overrides are needed.

---

## rateLimiter.checkLimit

**Overview**
Pre-flight check to verify that a transfer amount does not violate rolling 1-hour or 24-hour spending caps.

**Command Template**
```javascript
const { rateLimiter } = require('./index');

rateLimiter.checkLimit(address, amount);
```

**Parameters**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `address` | string | Yes | Sender wallet address |
| `amount` | string \| number | Yes | Transfer amount in PROS |

**Output Parsing**
None (returns undefined). Throws an error on violation.

**Error Handling**
Throws standard Error detailing current usage and remaining allowance.

> **Agent Guidelines**: Invoke `checkLimit` during Write Pre-checks before calling any transfer functions. If it throws, intercept the message, map it to `RATE_LIMIT_EXCEEDED` and prompt the user.
