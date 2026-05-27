export type IntegrationPublicStatus = 'connected' | 'simulated' | 'disconnected';

/**
 * Maps internal DB integration state to the public API contract.
 * DB keeps active/error/pending; clients see connected/simulated/disconnected.
 */
export function toPublicIntegrationStatus(
  hasRow: boolean,
  config: { simulated?: boolean } | null | undefined
): IntegrationPublicStatus {
  if (!hasRow) {
    return 'disconnected';
  }

  if (config?.simulated) {
    return 'simulated';
  }

  return 'connected';
}
