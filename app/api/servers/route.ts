import {
  AuthHttpError,
  assertMutationRequest,
  errorResponse,
  jsonNoStore,
} from "../../../lib/auth-http.ts";
import type { AuthEnvironment } from "../../../lib/auth-runtime.ts";
import { readSessionToken } from "../../../lib/auth-session.ts";
import { isServerCommand } from "../../../lib/provisioning-contracts.ts";
import { ServerFlowError } from "../../../lib/server-service.ts";
import {
  resolveServerService,
  type ServerCompositionOverrides,
} from "../../../lib/server-composition.ts";

export const dynamic = "force-dynamic";

function serverErrorResponse(error: unknown) {
  if (error instanceof ServerFlowError) {
    return jsonNoStore({ code: error.code, message: error.message }, error.status);
  }
  return errorResponse(error);
}

function requireServerService(environment: AuthEnvironment, overrides: ServerCompositionOverrides) {
  const resolution = resolveServerService(environment, overrides);
  if (resolution.status === "not_configured") {
    throw new AuthHttpError(503, "PANEL_NOT_CONFIGURED", "Sunucu paneli henüz etkin değil.");
  }
  if (resolution.status === "adapter_not_bound") {
    throw new AuthHttpError(503, "AUTH_ADAPTER_NOT_BOUND", "Kimlik deposu bağlantısı henüz etkin değil.");
  }
  return resolution.service;
}

function requireSessionToken(request: Request) {
  const rawToken = readSessionToken(request);
  if (!rawToken) {
    throw new AuthHttpError(401, "SESSION_REQUIRED", "Bu işlem için giriş yapılmalıdır.");
  }
  return rawToken;
}

/**
 * The signed-in customer's servers, or one server with its history.
 *
 * The single-server view is a query parameter rather than a path segment so the
 * whole panel needs one route, and the ownership check is identical on both
 * paths.
 */
export async function handleListServers(
  request: Request,
  environment: AuthEnvironment,
  overrides: ServerCompositionOverrides = {},
) {
  try {
    const service = requireServerService(environment, overrides);
    const rawToken = requireSessionToken(request);

    const serverId = new URL(request.url).searchParams.get("serverId");
    if (serverId) {
      return jsonNoStore(await service.readServer(rawToken, serverId));
    }
    return jsonNoStore(await service.listServers(rawToken));
  } catch (error) {
    return serverErrorResponse(error);
  }
}

/**
 * Queues one lifecycle command.
 *
 * A command changes a running server, so it goes through the same origin check
 * as every other mutation: a cross-site page must not be able to stop somebody's
 * server with a hidden form post.
 */
export async function handleServerCommand(
  request: Request,
  environment: AuthEnvironment,
  overrides: ServerCompositionOverrides = {},
) {
  try {
    assertMutationRequest(request, environment.APP_ORIGIN);
    const service = requireServerService(environment, overrides);
    const rawToken = requireSessionToken(request);

    const text = await request.text();
    let body: Record<string, unknown>;
    try {
      body = text.trim() ? JSON.parse(text) : {};
    } catch {
      throw new AuthHttpError(400, "INVALID_JSON", "Geçerli bir JSON gövdesi gönderin.");
    }

    if (typeof body.serverId !== "string" || !body.serverId) {
      throw new ServerFlowError(400, "SERVER_ID_REQUIRED", "Sunucu kimliği gerekli.");
    }

    // Saving settings is a mutation of the same server, so it shares this
    // route's origin check and ownership path rather than getting its own.
    if (body.action === "save_settings") {
      return jsonNoStore(
        await service.saveSettings({
          rawToken,
          serverId: body.serverId,
          settings: body.settings,
        }),
        202,
      );
    }

    if (!isServerCommand(body.command)) {
      throw new ServerFlowError(400, "UNKNOWN_COMMAND", "Bilinmeyen işlem.");
    }

    const result = await service.commandServer({
      rawToken,
      serverId: body.serverId,
      command: body.command,
    });
    return jsonNoStore(result, 202);
  } catch (error) {
    return serverErrorResponse(error);
  }
}

export function GET(request: Request) {
  return handleListServers(request, process.env);
}

export function POST(request: Request) {
  return handleServerCommand(request, process.env);
}
