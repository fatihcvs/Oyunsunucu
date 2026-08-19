export type AdminRole = "owner" | "operator" | "support";

export type AdminCapabilities = {
  canRetryJobs: boolean;
  canProvisionServers: boolean;
  canCommandServers: boolean;
  canDeleteServers: boolean;
  canManageMemberships: boolean;
};

export type AdminServerRow = {
  serverId: string;
  customerEmail: string;
  name: string;
  gameId: string;
  softwareId: string;
  planId: string;
  regionId: string;
  source: "manual" | "order";
  status: string;
  pendingJobKind: string | null;
  connection: { host: string; port: number } | null;
  createdAt: string;
  updatedAt: string;
};

export type Dashboard = {
  viewer: { displayName: string; email: string; role: AdminRole };
  capabilities: AdminCapabilities;
  capacity: { activeServers: number; limit: number };
  catalog: {
    games: Array<{
      id: string; name: string; tag: string;
      software: Array<{
        id: string; name: string; recommended: boolean; minimumMemoryMb: number; verification: string;
      }>;
    }>;
    plans: Array<{ id: string; label: string; ramGb: number; storageGb: number; monthlyPrice: number }>;
    regions: Array<{ id: string; name: string; location: string; surcharge: number }>;
  };
  metrics: {
    users: { total: number; active: number; createdLast24Hours: number };
    orders: { total: number; pendingPayment: number; paidOrActive: number; failed: number };
    servers: { total: number; online: number; provisioning: number; failed: number };
    jobs: { queued: number; leased: number; dead: number };
  };
  orders: Array<{
    orderId: string; customerEmail: string; customerName: string; status: string;
    totalMinor: number; currency: string; createdAt: string;
  }>;
  servers: AdminServerRow[];
  jobs: Array<{
    jobId: string; serverId: string | null; serverName: string | null; customerEmail: string | null;
    kind: string; status: string; attempts: number; maxAttempts: number; lastError: string | null;
    runAfter: string; updatedAt: string;
  }>;
  customers: Array<{
    userId: string; email: string; displayName: string; status: string;
    emailVerified: boolean; isAdmin: boolean; serverCount: number; createdAt: string;
  }>;
  auditLogs: Array<{
    auditId: string; action: string; actorEmail: string | null;
    targetType: string | null; targetId: string | null; occurredAt: string;
  }>;
  memberships: Array<{
    userId: string; email: string; displayName: string; role: AdminRole;
    hasOwnPassword: boolean; createdAt: string;
  }>;
  generatedAt: string;
};

export type AdminState =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "forbidden" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; dashboard: Dashboard };

/** Which command each button sends, and which server states offer it. */
export const SERVER_ACTIONS = [
  { command: "baslat", label: "Başlat", statuses: ["suspended"], ownerOnly: false },
  { command: "durdur", label: "Durdur", statuses: ["online"], ownerOnly: false },
  { command: "yeniden-baslat", label: "Yeniden başlat", statuses: ["online"], ownerOnly: false },
  { command: "sil", label: "Sil", statuses: ["online", "failed", "suspended"], ownerOnly: true },
] as const;

export type ServerAction = (typeof SERVER_ACTIONS)[number]["command"];
