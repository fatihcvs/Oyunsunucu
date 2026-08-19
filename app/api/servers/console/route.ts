import {
  AuthHttpError,
  assertMutationRequest,
  errorResponse,
  jsonNoStore,
  readJsonRecord,
} from "../../../../lib/auth-http.ts";
import type { AuthEnvironment } from "../../../../lib/auth-runtime.ts";
import { readSessionToken } from "../../../../lib/auth-session.ts";
import { ConsoleFlowError } from "../../../../lib/console-service.ts";
import {
  resolveConsoleService,
  type ConsoleCompositionOverrides,
} from "../../../../lib/console-composition.ts";

export const dynamic = "force-dynamic";

function consoleErrorResponse(error: unknown) {
  if (error instanceof ConsoleFlowError) {
    return jsonNoStore({ code: error.code, message: error.message }, error.status);
  }
  return errorResponse(error);
}

/**
 * Runs one console command against a server the caller owns.
 *
 * A mutation, so it carries the origin check: a cross-site page must not be
 * able to ban somebody's players with a hidden form post.
 */
export async function handleConsoleCommand(
  request: Request,
  environment: AuthEnvironment,
  overrides: ConsoleCompositionOverrides = {},
) {
  try {
    assertMutationRequest(request, environment.APP_ORIGIN);

    const resolution = resolveConsoleService(environment, overrides);
    if (resolution.status === "not_configured") {
      throw new AuthHttpError(503, "PANEL_NOT_CONFIGURED", "Sunucu paneli henüz etkin değil.");
    }
    if (resolution.status === "adapter_not_bound") {
      throw new AuthHttpError(503, "CONSOLE_NOT_BOUND", "Konsol bu ortamda kullanılamıyor.");
    }

    const rawToken = readSessionToken(request);
    if (!rawToken) {
      throw new ConsoleFlowError(401, "SESSION_REQUIRED", "Bu işlem için giriş yapılmalıdır.");
    }

    const body = await readJsonRecord(request);
    const result = body.action
      ? await resolution.service.runPlayerAction({
        rawToken,
        serverId: body.serverId,
        action: body.action,
        player: body.player,
      })
      : await resolution.service.runCommand({
        rawToken,
        serverId: body.serverId,
        command: body.command,
      });

    return jsonNoStore(result);
  } catch (error) {
    return consoleErrorResponse(error);
  }
}

export function POST(request: Request) {
  return handleConsoleCommand(request, process.env);
}
