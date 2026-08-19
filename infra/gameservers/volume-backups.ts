import type { AuthEnvironment } from "../../lib/auth-runtime.ts";

export type BackupRecord = {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string | null;
  sizeMb: number;
};

export interface BackupStore {
  list(serverId: string): Promise<BackupRecord[]>;
  create(input: { serverId: string; name: string }): Promise<BackupRecord | null>;
  remove(input: { serverId: string; backupId: string }): Promise<boolean>;
}

export class BackupError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = true) {
    super(message);
    this.name = "BackupError";
    this.code = code;
    this.retryable = retryable;
  }
}

const RAILWAY_API_URL = "https://backboard.railway.com/graphql/v2";
const REQUEST_TIMEOUT_MS = 30_000;
/** How long a snapshot may take before we stop holding the world still. */
const WORKFLOW_TIMEOUT_MS = 120_000;
const WORKFLOW_POLL_MS = 2_000;

/**
 * Volume snapshots, taken by the provider rather than by us.
 *
 * Railway can snapshot the volume itself, which is far better than anything we
 * could assemble from outside: no archive to stream through our own service, no
 * second copy of a customer's world passing through a process we run. What we
 * still owe the world is consistency — the caller flushes and pauses saves
 * before asking for one.
 */
export function createRailwayBackupStore(options: {
  apiToken: string;
  projectId: string;
  environmentId: string;
  fetch?: typeof fetch;
}): BackupStore {
  const send = options.fetch ?? fetch;

  async function graphql<T>(operation: string, query: string, variables: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await send(RAILWAY_API_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
      const body = await response.json() as { data?: T; errors?: { message: string }[] };
      if (!response.ok || body.errors?.length) {
        const message = body.errors?.[0]?.message ?? `HTTP ${response.status}`;
        // Authorisation and validation failures do not improve on retry.
        const retryable = !/not authorized|not found|invalid/i.test(message);
        throw new BackupError(operation, message, retryable);
      }
      if (!body.data) throw new BackupError(operation, "Railway boş yanıt döndürdü.", true);
      return body.data;
    } catch (error) {
      if (error instanceof BackupError) throw error;
      throw new BackupError(operation, error instanceof Error ? error.message : "Bilinmeyen hata", true);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The volume attached to one game service, found by the naming convention. */
  async function findVolumeInstanceId(serverId: string): Promise<string | null> {
    const data = await graphql<{
      project: { volumes: { edges: { node: { name: string; volumeInstances: { edges: { node: { id: string; environmentId: string } }[] } } }[] } };
    }>(
      "find_volume",
      `query($id: String!) {
         project(id: $id) {
           volumes { edges { node {
             name
             volumeInstances { edges { node { id environmentId } } }
           } } }
         }
       }`,
      { id: options.projectId },
    );

    const prefix = `game-${serverId}-`;
    for (const edge of data.project.volumes.edges) {
      if (!edge.node.name.startsWith(prefix)) continue;
      const instance = edge.node.volumeInstances.edges
        .map((entry) => entry.node)
        .find((node) => node.environmentId === options.environmentId);
      if (instance) return instance.id;
    }
    return null;
  }

  function toRecord(node: {
    id: string; name: string | null; createdAt: string; expiresAt: string | null; usedMB: number | null;
  }): BackupRecord {
    return {
      id: node.id,
      name: node.name ?? "Adsız yedek",
      createdAt: new Date(node.createdAt).toISOString(),
      expiresAt: node.expiresAt ? new Date(node.expiresAt).toISOString() : null,
      sizeMb: node.usedMB ?? 0,
    };
  }

  /**
   * Waits for one provider workflow to settle.
   *
   * Every volume mutation returns a workflow id rather than a result: the
   * snapshot happens after the call returns. Polling until it completes is what
   * lets the caller keep the world frozen for exactly as long as the snapshot
   * actually needs, and no longer.
   */
  async function waitForWorkflow(operation: string, workflowId: string): Promise<void> {
    const deadline = Date.now() + WORKFLOW_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const data = await graphql<{ workflowStatus: { status: string; error: string | null } }>(
        operation,
        `query($workflowId: String!) { workflowStatus(workflowId: $workflowId) { status error } }`,
        { workflowId },
      );
      const status = data.workflowStatus?.status;
      if (status === "Complete") return;
      if (status === "Error") {
        throw new BackupError(operation, data.workflowStatus.error ?? "Sağlayıcı işi başarısız oldu.", true);
      }
      // NotFound right after starting means the workflow has not registered
      // yet, so it is treated the same as Running.
      await new Promise((resolve) => setTimeout(resolve, WORKFLOW_POLL_MS));
    }

    throw new BackupError(operation, "Sağlayıcı işi zamanında tamamlanmadı.", true);
  }

  return {
    async list(serverId) {
      const volumeInstanceId = await findVolumeInstanceId(serverId);
      if (!volumeInstanceId) return [];

      const data = await graphql<{
        volumeInstanceBackupList: { id: string; name: string | null; createdAt: string; expiresAt: string | null; usedMB: number | null }[];
      }>(
        "list_backups",
        `query($volumeInstanceId: String!) {
           volumeInstanceBackupList(volumeInstanceId: $volumeInstanceId) {
             id name createdAt expiresAt usedMB
           }
         }`,
        { volumeInstanceId },
      );

      return (data.volumeInstanceBackupList ?? [])
        .map(toRecord)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    },

    async create(input) {
      const volumeInstanceId = await findVolumeInstanceId(input.serverId);
      if (!volumeInstanceId) {
        throw new BackupError("create_backup", "Sunucunun diski bulunamadı.", false);
      }

      const before = new Set((await this.list(input.serverId)).map((backup) => backup.id));

      const data = await graphql<{ volumeInstanceBackupCreate: { workflowId: string } | null }>(
        "create_backup",
        `mutation($volumeInstanceId: String!, $name: String!) {
           volumeInstanceBackupCreate(volumeInstanceId: $volumeInstanceId, name: $name) { workflowId }
         }`,
        { volumeInstanceId, name: input.name },
      );
      const workflowId = data.volumeInstanceBackupCreate?.workflowId;
      if (!workflowId) throw new BackupError("create_backup", "Sağlayıcı yedek işini başlatmadı.", true);

      // The caller is holding the world still for us, so the wait is part of
      // the operation rather than something to hand back half-finished.
      await waitForWorkflow("create_backup", workflowId);

      // The mutation returns a workflow, not the backup, so the new snapshot is
      // whichever one was not there before.
      const after = await this.list(input.serverId);
      return after.find((backup) => !before.has(backup.id)) ?? after[0] ?? null;
    },

    async remove(input) {
      const volumeInstanceId = await findVolumeInstanceId(input.serverId);
      if (!volumeInstanceId) return false;

      const data = await graphql<{ volumeInstanceBackupDelete: { workflowId: string } | null }>(
        "delete_backup",
        `mutation($volumeInstanceId: String!, $volumeInstanceBackupId: String!) {
           volumeInstanceBackupDelete(volumeInstanceId: $volumeInstanceId, volumeInstanceBackupId: $volumeInstanceBackupId) {
             workflowId
           }
         }`,
        { volumeInstanceId, volumeInstanceBackupId: input.backupId },
      );
      const workflowId = data.volumeInstanceBackupDelete?.workflowId;
      // Waiting here means the panel's refreshed list is already correct rather
      // than still showing a backup that is on its way out.
      if (workflowId) await waitForWorkflow("delete_backup", workflowId);
      return true;
    },
  };
}

/** Absent configuration means no backups offered, not a broken panel. */
export function createBackupStore(environment: AuthEnvironment): BackupStore | null {
  const apiToken = environment.RAILWAY_API_TOKEN?.trim() ?? "";
  const projectId = environment.RAILWAY_GAME_PROJECT_ID?.trim() ?? "";
  const environmentId = environment.RAILWAY_GAME_ENVIRONMENT_ID?.trim() ?? "";
  if (!apiToken || !projectId || !environmentId) return null;

  return createRailwayBackupStore({ apiToken, projectId, environmentId });
}
