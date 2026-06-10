require('dotenv').config();

/**
 * Validates that a string is a valid URL.
 * @param {string} url The URL to validate
 * @param {string} name The name of the environment variable
 * @returns {string} The validated URL
 */
function validateUrl(url, name) {
  if (!url) {
    throw new Error(`Configuration Error: Environment variable ${name} is missing.`);
  }
  try {
    new URL(url);
  } catch (err) {
    throw new Error(`Configuration Error: Environment variable ${name} ("${url}") is not a valid URL.`);
  }
  return url;
}

/**
 * Validates that a string is a valid 32-byte hex private key.
 * @param {string} key The private key string to validate
 * @param {string} name The name of the environment variable
 * @returns {string} The validated private key prefixed with '0x'
 */
function validatePrivateKey(key, name) {
  if (!key) {
    throw new Error(`Configuration Error: Environment variable ${name} is missing.`);
  }
  let cleanKey = key.trim();
  if (cleanKey.startsWith('0x')) {
    cleanKey = cleanKey.slice(2);
  }
  const hexRegex = /^[0-9a-fA-F]{64}$/;
  if (!hexRegex.test(cleanKey)) {
    throw new Error(`Configuration Error: Environment variable ${name} must be a valid 32-byte hex private key (64 hex characters).`);
  }
  return `0x${cleanKey}`;
}

/**
 * Validates that a string represents a valid chain ID (positive integer).
 * @param {string} chainIdStr The chain ID string to validate
 * @param {string} name The name of the environment variable
 * @returns {number|undefined} The validated chain ID, or undefined if not provided
 */
function validateChainId(chainIdStr, name) {
  if (!chainIdStr) {
    return undefined;
  }
  const chainId = parseInt(chainIdStr.trim(), 10);
  if (isNaN(chainId) || chainId <= 0) {
    throw new Error(`Configuration Error: Environment variable ${name} ("${chainIdStr}") must be a positive integer.`);
  }
  return chainId;
}

/**
 * Validates that a string represents a valid limit (positive number).
 * @param {string} limitStr The limit string to validate
 * @param {number} defaultValue The default value if not provided
 * @param {string} name The name of the environment variable
 * @returns {number} The validated limit
 */
function validateLimit(limitStr, defaultValue, name) {
  if (!limitStr) {
    return defaultValue;
  }
  const limit = parseFloat(limitStr.trim());
  if (isNaN(limit) || limit <= 0) {
    throw new Error(`Configuration Error: Environment variable ${name} ("${limitStr}") must be a positive number.`);
  }
  return limit;
}

const config = {
  rpcUrl: validateUrl(process.env.PHAROS_RPC_URL, 'PHAROS_RPC_URL'),
  privateKey: validatePrivateKey(process.env.PRIVATE_KEY, 'PRIVATE_KEY'),
  chainId: validateChainId(process.env.CHAIN_ID, 'CHAIN_ID'),
  maxHourlySpend: validateLimit(process.env.MAX_HOURLY_SPEND, 100.0, 'MAX_HOURLY_SPEND'),
  maxDailySpend: validateLimit(process.env.MAX_DAILY_SPEND, 500.0, 'MAX_DAILY_SPEND'),
};

module.exports = config;

