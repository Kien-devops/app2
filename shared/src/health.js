/**
 * Shared Health Response Contract
 * Formats a consistent /health payload across all app2 services.
 * Strictly adheres to dynamic region resolution:
 * Uses AWS_REGION or REGION env vars; falls back to 'unknown' if missing.
 */
function createHealthResponse(serviceName, customStatus = 'ok', metadata = {}) {
  const region = process.env.AWS_REGION || process.env.REGION || 'unknown';
  return {
    status: customStatus,
    service: serviceName,
    region: region,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    ...metadata
  };
}

module.exports = {
  createHealthResponse
};
