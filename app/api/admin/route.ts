import {
  AuthHttpError,
  assertMutationRequest,
  errorResponse,
  jsonNoStore,
  readJsonRecord,
} from "../../../lib/auth-http.ts";
import type { AuthEnvironment } from "../../../lib/auth-runtime.ts";
import { readSessionToken } from "../../../lib/auth-session.ts";
import { AdminFlowError } from "../../../lib/admin-service.ts";
import {
  resolveAdminService,
  type AdminCompositionOverrides,
} from "../../../lib/admin-composition.ts";

export const dynamic = "force-dynamic";

function adminErrorResponse(error: unknown) {
  if (error instanceof AdminFlowError) {
    return jsonNoStore({ code: error.code, message: error.message }, error.status);
  }
  return errorResponse(error);
}

function requireAdminService(environment: AuthEnvironment, overrides: AdminCompositionOverrides) {
  const resolution = resolveAdminService(environment, overrides);
  if (resolution.status === "not_configured") {
    throw new AuthHttpError(503, "ADMIN_NOT_CONFIGURED", "Yönetim paneli henüz etkin değil.");
  }
  if (resolution.status === "adapter_not_bound") {
    throw new AuthHttpError(503, "ADMIN_ADAPTER_NOT_BOUND", "Yönetim veritabanı bağlantısı henüz etkin değil.");
  }
  return resolution.service;
}

function requireSessionToken(request: Request) {
  const token = readSessionToken(request);
  if (!token) throw new AdminFlowError(401, "SESSION_REQUIRED", "Bu işlem için giriş yapılmalıdır.");
  return token;
}

export async function handleAdminDashboard(
  request: Request,
  environment: AuthEnvironment,
  overrides: AdminCompositionOverrides = {},
) {
  try {
    const service = requireAdminService(environment, overrides);
    const token = requireSessionToken(request);
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return jsonNoStore(await service.dashboard(token, query));
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function handleAdminAction(
  request: Request,
  environment: AuthEnvironment,
  overrides: AdminCompositionOverrides = {},
) {
  try {
    assertMutationRequest(request, environment.APP_ORIGIN);
    const service = requireAdminService(environment, overrides);
    const token = requireSessionToken(request);

    const body = await readJsonRecord(request);

    if (body.action === "retry_job") {
      if (typeof body.jobId !== "string") {
        throw new AdminFlowError(400, "INVALID_JOB_ID", "İş kimliği geçersiz.");
      }
      return jsonNoStore(await service.retryJob(token, body.jobId), 202);
    }

    if (body.action === "command_server") {
      return jsonNoStore(
        await service.commandServer(token, { serverId: body.serverId, command: body.command }),
        202,
      );
    }

    if (body.action === "change_plan") {
      return jsonNoStore(
        await service.changePlan(token, { serverId: body.serverId, planId: body.planId }),
        202,
      );
    }

    if (body.action === "adjust_balance") {
      return jsonNoStore(await service.adjustBalance(token, {
        userId: body.userId,
        amount: body.amount,
        note: body.note,
        requestId: body.requestId,
      }));
    }

    if (body.action === "grant_membership") {
      return jsonNoStore(await service.grantMembership(token, { email: body.email, role: body.role }));
    }

    if (body.action === "revoke_membership") {
      return jsonNoStore(await service.revokeMembership(token, { userId: body.userId }));
    }

    if (body.action === "provision_server") {
      const result = await service.provisionServer(token, {
        requestId: body.requestId,
        customerEmail: body.customerEmail,
        serverName: body.serverName,
        gameId: body.gameId,
        softwareId: body.softwareId,
        planId: body.planId,
        regionId: body.regionId,
        confirmCost: body.confirmCost,
      });
      return jsonNoStore(result, result.created ? 202 : 200);
    }

    throw new AdminFlowError(400, "UNKNOWN_ADMIN_ACTION", "Bilinmeyen yönetim işlemi.");
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export function GET(request: Request) {
  return handleAdminDashboard(request, process.env);
}

export function POST(request: Request) {
  return handleAdminAction(request, process.env);
}
