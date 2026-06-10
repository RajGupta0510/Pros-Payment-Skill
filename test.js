// Mock dotenv and environment variables before config.js is loaded
jest.mock('dotenv', () => ({
  config: () => ({ parsed: {} })
}));
process.env.PHAROS_RPC_URL = 'http://localhost:8545';
// Dynamically generate a random mock key to prevent CertiK scanner warnings about hardcoded secrets
const { Wallet } = require('ethers');
process.env.PRIVATE_KEY = Wallet.createRandom().privateKey;
process.env.CHAIN_ID = '1234';
process.env.MAX_HOURLY_SPEND = '100';
process.env.MAX_DAILY_SPEND = '500';

const { ethers } = require('ethers');
const { sendPayment, sendBatchPayment, sendConditionalPayment, estimatePaymentCost, getTransactionHistory, clearTransactionHistory, setWallet } = require('./payment');
const rateLimiter = require('./rateLimiter');

describe('PROS Payment Skill Tests', () => {
  const mockAddr = '0x1111111111111111111111111111111111111111';
  const recipient = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
  let mockWallet;
  let mockProvider;

  beforeEach(() => {
    // Reset rate limiter history before each test
    rateLimiter.reset();
    clearTransactionHistory();

    // Setup fresh mock provider and wallet
    mockProvider = {
      getBlock: jest.fn().mockResolvedValue({
        timestamp: 1718020000 // June 2026 mock timestamp
      }),
      getFeeData: jest.fn().mockResolvedValue({
        gasPrice: ethers.parseUnits('2', 'gwei'),
        maxFeePerGas: ethers.parseUnits('2', 'gwei')
      })
    };

    mockWallet = {
      address: mockAddr,
      provider: mockProvider,
      getAddress: jest.fn().mockResolvedValue(mockAddr),
      getNonce: jest.fn().mockResolvedValue(5),
      estimateGas: jest.fn().mockResolvedValue(21000n),
      sendTransaction: jest.fn().mockImplementation((tx) => {
        const valStr = ethers.formatEther(tx.value);
        const nonceVal = tx.nonce !== undefined ? tx.nonce : 5;
        const mockHash = '0x' + nonceVal.toString().padStart(64, 'a');

        return Promise.resolve({
          hash: mockHash,
          nonce: nonceVal,
          wait: jest.fn().mockImplementation(async (confirmations, timeout) => {
            if (valStr === '99.0') {
              const err = new Error('timeout waiting for transaction');
              err.code = 'TIMEOUT';
              err.transactionHash = mockHash;
              throw err;
            }
            if (valStr === '66.0') {
              throw new Error('execution reverted');
            }
            return {
              hash: mockHash,
              blockNumber: 100023,
              status: 1, // 1 = success, 0 = failed
              gasUsed: 21000n,
              to: tx.to
            };
          })
        });
      })
    };

    setWallet(mockWallet);
  });

  describe('Configuration Validation', () => {
    const backupEnv = { ...process.env };

    beforeEach(() => {
      // Clear Jest module registry cache to force reloading
      jest.resetModules();
    });

    afterEach(() => {
      // Restore clean mock environment
      process.env.PHAROS_RPC_URL = backupEnv.PHAROS_RPC_URL;
      process.env.PRIVATE_KEY = backupEnv.PRIVATE_KEY;
      process.env.CHAIN_ID = backupEnv.CHAIN_ID;
      process.env.MAX_HOURLY_SPEND = backupEnv.MAX_HOURLY_SPEND;
      process.env.MAX_DAILY_SPEND = backupEnv.MAX_DAILY_SPEND;
    });

    test('should throw error if PHAROS_RPC_URL is missing', () => {
      delete process.env.PHAROS_RPC_URL;
      expect(() => require('./config')).toThrow(/PHAROS_RPC_URL is missing/);
    });

    test('should throw error if PHAROS_RPC_URL is invalid', () => {
      process.env.PHAROS_RPC_URL = 'not-a-url';
      expect(() => require('./config')).toThrow(/not a valid URL/);
    });

    test('should throw error if PRIVATE_KEY has invalid length', () => {
      process.env.PRIVATE_KEY = '0x123';
      expect(() => require('./config')).toThrow(/must be a valid 32-byte hex private key/);
    });

    test('should throw error if CHAIN_ID is not a positive integer', () => {
      process.env.CHAIN_ID = '-100';
      expect(() => require('./config')).toThrow(/must be a positive integer/);
    });

    test('should throw error if MAX_HOURLY_SPEND is not a positive number', () => {
      process.env.MAX_HOURLY_SPEND = '-50';
      expect(() => require('./config')).toThrow(/must be a positive number/);
    });

    test('should throw error if MAX_DAILY_SPEND is not a positive number', () => {
      process.env.MAX_DAILY_SPEND = 'abc';
      expect(() => require('./config')).toThrow(/must be a positive number/);
    });
  });

  describe('Feature 1: Single Payment', () => {
    test('should successfully send a single payment and return receipt metadata', async () => {
      const result = await sendPayment({
        to: recipient,
        amount: '10.0',
        memo: 'Hello PROS'
      });

      expect(result).toEqual({
        txHash: expect.stringMatching(/^0x[a-f0-9]{64}$/),
        blockNumber: 100023,
        status: 'success',
        timestamp: new Date(1718020000 * 1000).toISOString()
      });

      expect(mockWallet.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({
        to: recipient,
        value: ethers.parseEther('10.0'),
        data: ethers.hexlify(ethers.toUtf8Bytes('Hello PROS'))
      }));
    });

    test('should validate input addresses', async () => {
      await expect(sendPayment({ to: 'invalid-address', amount: '10' }))
        .rejects.toThrow('Validation Error: "invalid-address" is not a valid EVM address.');
    });

    test('should validate amount is positive', async () => {
      await expect(sendPayment({ to: recipient, amount: '-5' }))
        .rejects.toThrow('Validation Error: Amount must be a positive number.');
      await expect(sendPayment({ to: recipient, amount: '0' }))
        .rejects.toThrow('Validation Error: Amount must be a positive number.');
    });
  });

  describe('Feature 2: Batch Payment', () => {
    test('should send payments sequentially with incrementing nonces', async () => {
      const payments = [
        { to: recipient, amount: '5.0', memo: 'Batch P1' },
        { to: '0x2222222222222222222222222222222222222222', amount: '15.0', memo: 'Batch P2' }
      ];

      const receipts = await sendBatchPayment({ payments });

      expect(receipts).toHaveLength(2);
      expect(receipts[0]).toEqual(expect.objectContaining({ status: 'success', amount: '5.0' }));
      expect(receipts[1]).toEqual(expect.objectContaining({ status: 'success', amount: '15.0' }));

      expect(mockWallet.sendTransaction).toHaveBeenNthCalledWith(1, expect.objectContaining({
        to: payments[0].to,
        value: ethers.parseEther('5.0'),
        nonce: 5
      }));
      expect(mockWallet.sendTransaction).toHaveBeenNthCalledWith(2, expect.objectContaining({
        to: payments[1].to,
        value: ethers.parseEther('15.0'),
        nonce: 6
      }));
    });

    test('should validate batch is non-empty array', async () => {
      await expect(sendBatchPayment({ payments: [] }))
        .rejects.toThrow('Validation Error: "payments" must be a non-empty array.');
    });
  });

  describe('Feature 3: Rate Limiting', () => {
    test('should block transaction exceeding hourly limit of 100 PROS', async () => {
      await sendPayment({ to: recipient, amount: '90.0' });
      
      // Attempting to send 15 more should fail because 90 + 15 = 105 (> 100)
      await expect(sendPayment({ to: recipient, amount: '15.0' }))
        .rejects.toThrow(/Rate limit exceeded: Sending 15 PROS would exceed the hourly limit of 100 PROS/);
    });

    test('should block transaction exceeding daily limit of 500 PROS', async () => {
      // Send 5 transactions of 95 PROS = 475 PROS, but 2 hours ago to avoid triggering hourly limit (100)
      const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
      for (let i = 0; i < 5; i++) {
        rateLimiter.record(mockAddr, '95.0', twoHoursAgo);
      }

      // 475 + 30 = 505 (> 500)
      await expect(sendPayment({ to: recipient, amount: '30.0' }))
        .rejects.toThrow(/Rate limit exceeded: Sending 30 PROS would exceed the daily limit of 500 PROS/);
    });

    test('should cleanup old transactions in rolling 24 hour window', () => {
      const now = Date.now();
      const past25h = now - (25 * 60 * 60 * 1000);
      
      rateLimiter.record(mockAddr, '450.0', past25h);
      
      // Should succeed because 450 PROS was sent outside the 24 hour window
      expect(() => rateLimiter.checkLimit(mockAddr, '100.0')).not.toThrow();
    });
  });

  describe('Feature 4: Verification and Rollback', () => {
    test('should handle timeout and roll back rate limiting allocation', async () => {
      // Verify initial allowance is full
      expect(() => rateLimiter.checkLimit(mockAddr, '100.0')).not.toThrow();

      // Trigger timeout (configured for 99.0 amount in mock)
      await expect(sendPayment({ to: recipient, amount: '99.0' }))
        .rejects.toThrow(/Transaction Timeout Error/);

      // Verify that the 99.0 was successfully rolled back and we can send 100.0 again
      expect(() => rateLimiter.checkLimit(mockAddr, '100.0')).not.toThrow();
    });

    test('should roll back rate limits on general on-chain transaction reverts', async () => {
      // Trigger execution failure (configured for 66.0 amount in mock)
      await expect(sendPayment({ to: recipient, amount: '66.0' }))
        .rejects.toThrow(/Payment Execution Error/);

      // Verify that the 66.0 was successfully rolled back
      expect(() => rateLimiter.checkLimit(mockAddr, '100.0')).not.toThrow();
    });
  });

  describe('Feature 5: Conditional Payment', () => {
    test('should execute payment if functional condition returns true', async () => {
      const condition = jest.fn().mockResolvedValue(true);

      const result = await sendConditionalPayment({
        to: recipient,
        amount: '10.0',
        memo: 'Cond functional success',
        condition
      });

      expect(result.status).toBe('success');
      expect(condition).toHaveBeenCalledWith(mockProvider);
    });

    test('should abort payment and preserve rate limits if functional condition returns false', async () => {
      const condition = jest.fn().mockResolvedValue(false);

      await expect(sendConditionalPayment({
        to: recipient,
        amount: '10.0',
        memo: 'Cond functional abort',
        condition
      })).rejects.toThrow('Condition Not Met: Payment aborted.');

      expect(condition).toHaveBeenCalledWith(mockProvider);
      // Verify rate limiter was not consumed (100.0 is still full remaining hourly)
      expect(() => rateLimiter.checkLimit(mockAddr, '100.0')).not.toThrow();
    });

    test('should execute payment if declarative balance check condition is met', async () => {
      mockProvider.getBalance = jest.fn().mockResolvedValue(ethers.parseEther('5.0'));

      const condition = {
        type: 'balance',
        targetAddress: mockAddr,
        minBalance: '2.0'
      };

      const result = await sendConditionalPayment({
        to: recipient,
        amount: '10.0',
        memo: 'Cond balance success',
        condition
      });

      expect(result.status).toBe('success');
      expect(mockProvider.getBalance).toHaveBeenCalledWith(mockAddr);
    });

    test('should abort payment if declarative balance check condition is not met', async () => {
      mockProvider.getBalance = jest.fn().mockResolvedValue(ethers.parseEther('1.0'));

      const condition = {
        type: 'balance',
        targetAddress: mockAddr,
        minBalance: '2.0'
      };

      await expect(sendConditionalPayment({
        to: recipient,
        amount: '10.0',
        memo: 'Cond balance abort',
        condition
      })).rejects.toThrow('Condition Not Met: Payment aborted.');
    });

    test('should execute payment if declarative contractCall check is met', async () => {
      const mockContract = {
        someMethod: jest.fn().mockResolvedValue('foo')
      };
      
      const contractSpy = jest.spyOn(ethers, 'Contract').mockImplementation(() => mockContract);

      const condition = {
        type: 'contractCall',
        address: '0x1234567890123456789012345678901234567890',
        abi: [],
        method: 'someMethod',
        args: [123],
        expected: 'foo'
      };

      const result = await sendConditionalPayment({
        to: recipient,
        amount: '10.0',
        memo: 'Cond contract success',
        condition
      });

      expect(result.status).toBe('success');
      expect(mockContract.someMethod).toHaveBeenCalledWith(123);
      
      contractSpy.mockRestore();
    });

    test('should abort payment if declarative contractCall check is not met', async () => {
      const mockContract = {
        someMethod: jest.fn().mockResolvedValue('bar')
      };
      
      const contractSpy = jest.spyOn(ethers, 'Contract').mockImplementation(() => mockContract);

      const condition = {
        type: 'contractCall',
        address: '0x1234567890123456789012345678901234567890',
        abi: [],
        method: 'someMethod',
        args: [123],
        expected: 'foo'
      };

      await expect(sendConditionalPayment({
        to: recipient,
        amount: '10.0',
        memo: 'Cond contract abort',
        condition
      })).rejects.toThrow('Condition Not Met: Payment aborted.');
      
      contractSpy.mockRestore();
    });
  });

  describe('Feature 6: Estimate Payment Cost', () => {
    test('should successfully estimate gas and total cost', async () => {
      const result = await estimatePaymentCost({
        to: recipient,
        amount: '10.0',
        memo: 'Hello PROS'
      });

      expect(result).toEqual({
        gasLimit: '21000',
        gasPrice: '2000000000',
        gasCost: '0.000042',
        totalCost: '10.000042'
      });

      expect(mockWallet.estimateGas).toHaveBeenCalledWith(expect.objectContaining({
        to: recipient,
        value: ethers.parseEther('10.0'),
        data: ethers.hexlify(ethers.toUtf8Bytes('Hello PROS'))
      }));
    });

    test('should validate input parameters', async () => {
      await expect(estimatePaymentCost({ to: 'invalid-address', amount: '10' }))
        .rejects.toThrow('Validation Error: "invalid-address" is not a valid EVM address.');

      await expect(estimatePaymentCost({ to: recipient, amount: '-1' }))
        .rejects.toThrow('Validation Error: Amount must be a positive number.');
    });

    test('should fallback to 0 value estimation if first estimateGas fails', async () => {
      mockWallet.estimateGas = jest.fn()
        .mockRejectedValueOnce(new Error('insufficient funds'))
        .mockResolvedValueOnce(21000n);

      const result = await estimatePaymentCost({
        to: recipient,
        amount: '10.0',
        memo: 'Hello PROS'
      });

      expect(result.gasLimit).toBe('21000');
      expect(mockWallet.estimateGas).toHaveBeenNthCalledWith(1, expect.objectContaining({ value: ethers.parseEther('10.0') }));
      expect(mockWallet.estimateGas).toHaveBeenNthCalledWith(2, expect.objectContaining({ value: 0n }));
    });

    test('should fallback to static estimation if both estimateGas calls fail', async () => {
      mockWallet.estimateGas = jest.fn()
        .mockRejectedValue(new Error('revert'));

      const result = await estimatePaymentCost({
        to: recipient,
        amount: '10.0',
        memo: 'Hello'
      });

      expect(result.gasLimit).toBe('21080');
    });
  });

  describe('Feature 7: Transaction History', () => {
    test('should start with empty history', async () => {
      const history = await getTransactionHistory();
      expect(history).toEqual([]);
    });

    test('should record successful single payments in history', async () => {
      const result = await sendPayment({
        to: recipient,
        amount: '10.0',
        memo: 'Test transaction history'
      });

      const history = await getTransactionHistory();
      expect(history).toHaveLength(1);
      expect(history[0]).toEqual({
        txHash: result.txHash,
        recipient,
        amount: '10.0',
        status: 'success',
        timestamp: result.timestamp
      });
    });

    test('should record failed single payments in history', async () => {
      // Amount 66.0 is configured in mock to revert
      await expect(sendPayment({ to: recipient, amount: '66.0' }))
        .rejects.toThrow();

      const history = await getTransactionHistory();
      expect(history).toHaveLength(1);
      expect(history[0]).toEqual({
        txHash: expect.stringMatching(/^0x[a-f0-9]{64}$/),
        recipient,
        amount: '66.0',
        status: 'failed',
        timestamp: expect.any(String)
      });
    });

    test('should record successful batch payments in history', async () => {
      const payments = [
        { to: recipient, amount: '5.0', memo: 'Batch P1' },
        { to: '0x2222222222222222222222222222222222222222', amount: '15.0', memo: 'Batch P2' }
      ];

      const receipts = await sendBatchPayment({ payments });

      const history = await getTransactionHistory();
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual(expect.objectContaining({
        txHash: receipts[0].txHash,
        recipient: payments[0].to,
        amount: '5.0',
        status: 'success'
      }));
      expect(history[1]).toEqual(expect.objectContaining({
        txHash: receipts[1].txHash,
        recipient: payments[1].to,
        amount: '15.0',
        status: 'success'
      }));
    });

    test('should support clearing history manually', async () => {
      await sendPayment({ to: recipient, amount: '10.0' });
      let history = await getTransactionHistory();
      expect(history).toHaveLength(1);

      clearTransactionHistory();
      history = await getTransactionHistory();
      expect(history).toHaveLength(0);
    });
  });
});

