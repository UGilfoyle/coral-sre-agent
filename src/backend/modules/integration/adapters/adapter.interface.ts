export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  message: string;
  latencyMs?: number;
}

export interface ToolAdapter {
  provider: string;
  fetchData(tenantId: string, table: string, criteria?: any): Promise<any[]>;
  healthCheck(tenantId: string): Promise<HealthStatus>;
}
