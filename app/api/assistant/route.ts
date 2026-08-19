import {
  AuthHttpError,
  assertMutationRequest,
  errorResponse,
  jsonNoStore,
  readJsonRecord,
} from "../../../lib/auth-http.ts";
import type { AuthEnvironment } from "../../../lib/auth-runtime.ts";
import { readSessionToken } from "../../../lib/auth-session.ts";
import { AssistantFlowError } from "../../../lib/assistant-service.ts";
import {
  resolveAssistantService,
  type AssistantCompositionOverrides,
} from "../../../lib/assistant-composition.ts";

export const dynamic = "force-dynamic";

function assistantErrorResponse(error: unknown) {
  if (error instanceof AssistantFlowError) {
    return jsonNoStore({ code: error.code, message: error.message }, error.status);
  }
  return errorResponse(error);
}

/**
 * Asks the assistant one question.
 *
 * A POST rather than a GET because it costs a model call, and it carries the
 * same origin check as every other mutation — but it applies nothing: the
 * answer may contain a proposal, and the panel sends that through the ordinary
 * server endpoints only after the customer confirms it.
 */
export async function handleAssistantAsk(
  request: Request,
  environment: AuthEnvironment,
  overrides: AssistantCompositionOverrides = {},
) {
  try {
    assertMutationRequest(request, environment.APP_ORIGIN);

    const resolution = resolveAssistantService(environment, overrides);
    if (resolution.status === "not_configured") {
      throw new AuthHttpError(
        503,
        "ASSISTANT_NOT_CONFIGURED",
        "Asistan henüz etkin değil.",
      );
    }
    if (resolution.status === "adapter_not_bound") {
      throw new AuthHttpError(503, "AUTH_ADAPTER_NOT_BOUND", "Kimlik deposu bağlantısı henüz etkin değil.");
    }

    const rawToken = readSessionToken(request);
    if (!rawToken) {
      throw new AssistantFlowError(401, "SESSION_REQUIRED", "Bu işlem için giriş yapılmalıdır.");
    }

    const body = await readJsonRecord(request);
    return jsonNoStore(await resolution.service.ask(rawToken, body.message));
  } catch (error) {
    return assistantErrorResponse(error);
  }
}

export function POST(request: Request) {
  return handleAssistantAsk(request, process.env);
}
