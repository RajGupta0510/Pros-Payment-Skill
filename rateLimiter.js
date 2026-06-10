const config = require('./config');

/**
 * In-memory rate limiter to secure PROS token transfers.
 */
class RateLimiter {
  constructor() {
    // Maps lowercase sender address -> Array of { amount: number, timestamp: number }
    this.history = new Map();
    this.LIMIT_1H = config.maxHourlySpend;
    this.LIMIT_24H = config.maxDailySpend;
    this.ONE_HOUR_MS = 60 * 60 * 1000;
    this.TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  }

  /**
   * Cleans up transaction records older than 24 hours for a given address.
   * @param {string} address The sender wallet address
   * @param {number} now The current timestamp in milliseconds
   * @private
   */
  _cleanup(address, now) {
    const records = this.history.get(address.toLowerCase());
    if (!records) return;

    // Only keep records from the last 24 hours
    const filtered = records.filter(tx => (now - tx.timestamp) < this.TWENTY_FOUR_HOURS_MS);
    if (filtered.length === 0) {
      this.history.delete(address.toLowerCase());
    } else {
      this.history.set(address.toLowerCase(), filtered);
    }
  }

  /**
   * Calculates the total amount sent by the address in the given window.
   * @param {string} address The sender wallet address
   * @param {number} windowMs The time window in milliseconds
   * @param {number} now The current timestamp in milliseconds
   * @returns {number} The total amount sent in the window
   * @private
   */
  _getTotalSentInWindow(address, windowMs, now) {
    const records = this.history.get(address.toLowerCase());
    if (!records) return 0;

    return records
      .filter(tx => (now - tx.timestamp) < windowMs)
      .reduce((sum, tx) => sum + tx.amount, 0);
  }

  /**
   * Checks if sending the specified amount would exceed the hourly or daily limits.
   * Throws an Error if limits are exceeded.
   * @param {string} address The sender wallet address
   * @param {number|string} amount The transfer amount in PROS
   * @throws {Error} If rate limits are violated
   */
  checkLimit(address, amount) {
    if (!address) {
      throw new Error('RateLimiter: Address is required.');
    }
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error('RateLimiter: Amount must be a positive number.');
    }

    const normalizedAddress = address.toLowerCase();
    const now = Date.now();

    // Clean up old transactions first
    this._cleanup(normalizedAddress, now);

    // Get current usage
    const sentLast1h = this._getTotalSentInWindow(normalizedAddress, this.ONE_HOUR_MS, now);
    const sentLast24h = this._getTotalSentInWindow(normalizedAddress, this.TWENTY_FOUR_HOURS_MS, now);

    // Validate hourly limit
    if (sentLast1h + numAmount > this.LIMIT_1H) {
      const remaining1h = Math.max(0, this.LIMIT_1H - sentLast1h);
      throw new Error(
        `Rate limit exceeded: Sending ${numAmount} PROS would exceed the hourly limit of ${this.LIMIT_1H} PROS. ` +
        `Current usage: ${sentLast1h.toFixed(4)} PROS sent in the last hour. Remaining allowance: ${remaining1h.toFixed(4)} PROS.`
      );
    }

    // Validate daily limit
    if (sentLast24h + numAmount > this.LIMIT_24H) {
      const remaining24h = Math.max(0, this.LIMIT_24H - sentLast24h);
      throw new Error(
        `Rate limit exceeded: Sending ${numAmount} PROS would exceed the daily limit of ${this.LIMIT_24H} PROS. ` +
        `Current usage: ${sentLast24h.toFixed(4)} PROS sent in the last 24 hours. Remaining allowance: ${remaining24h.toFixed(4)} PROS.`
      );
    }
  }

  /**
   * Records a transaction for the specified sender address.
   * @param {string} address The sender wallet address
   * @param {number|string} amount The transfer amount in PROS
   * @param {number} [timestamp] Optional custom timestamp (primarily for tests)
   * @returns {number} The timestamp at which the transaction was recorded
   */
  record(address, amount, timestamp = Date.now()) {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error('RateLimiter: Amount must be a positive number.');
    }

    const normalizedAddress = address.toLowerCase();
    if (!this.history.has(normalizedAddress)) {
      this.history.set(normalizedAddress, []);
    }

    this.history.get(normalizedAddress).push({
      amount: numAmount,
      timestamp
    });

    return timestamp;
  }

  /**
   * Reverts/rolls back a previously recorded transaction.
   * Used if a transaction fails after being checked and pre-recorded.
   * @param {string} address The sender wallet address
   * @param {number|string} amount The transaction amount to remove
   * @param {number} timestamp The exact timestamp at which it was recorded
   */
  rollback(address, amount, timestamp) {
    const normalizedAddress = address.toLowerCase();
    const records = this.history.get(normalizedAddress);
    if (!records) return;

    const numAmount = parseFloat(amount);
    const index = records.findIndex(tx => tx.amount === numAmount && tx.timestamp === timestamp);
    if (index !== -1) {
      records.splice(index, 1);
    }

    if (records.length === 0) {
      this.history.delete(normalizedAddress);
    }
  }

  /**
   * Resets the entire rate limiter history. Useful for testing.
   */
  reset() {
    this.history.clear();
  }
}

// Export a singleton instance
module.exports = new RateLimiter();
