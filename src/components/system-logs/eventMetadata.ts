export const getEventDescription = (type: string) => {
  switch (type) {
    case 'RATE_LIMIT_EXCEEDED':
      return "The request was rejected because the configured rate limit was exceeded.";
    case 'INVALID_API_KEY':
      return "The supplied API key could not be authenticated for this protected route.";
    case 'PATH_TRAVERSAL':
      return "A suspicious path traversal pattern was detected and the request was blocked before reaching the upstream API.";
    case 'UPSTREAM_TIMEOUT':
      return "The protected upstream API did not respond within the configured gateway timeout.";
    case 'EXPERIMENT_STARTED':
      return "A controlled resilience experiment has started against an authorized target.";
    case 'EXPERIMENT_COMPLETED':
      return "The controlled experiment completed and its collected telemetry is ready for verification.";
    case 'REDIS_UNAVAILABLE':
      return "FortiX could not reach Redis while processing this operation.";
    case 'REDIS_CONNECTED':
      return "Successfully established connection to the Redis datastore.";
    default:
      return `Operational event recorded: ${type}`;
  }
};

export const getEventCategory = (type: string) => {
  if (type.includes('RATE_LIMIT')) return 'Rate Limiting';
  if (type.includes('API_KEY')) return 'Authentication';
  if (type.includes('PATH_TRAVERSAL') || type.includes('SQL_INJECTION')) return 'Threat Detection';
  if (type.includes('EXPERIMENT')) return 'Experiment';
  if (type.includes('REDIS') || type.includes('DATABASE')) return 'Infrastructure';
  return 'System';
};
