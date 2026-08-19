import {
  AuthHttpError,
  assertMutationRequest,
  errorResponse,
  jsonNoStore,
  parseDraftImportRequest,
  requireLiveAuthService,
} from "../../../../../lib/auth-http.ts";
import {
  resolveAuthService,
  type AuthCompositionOverrides,
} from "../../../../../lib/auth-composition.ts";
import type { AuthEnvironment } from "../../../../../lib/auth-runtime.ts";
import { readSessionToken } from "../../../../../lib/auth-session.ts";
import { DraftImportConflictError } from "../../../../../infra/postgres/auth-repository.ts";

export const dynamic = "force-dynamic";

/**
 * Moves the browser's local server draft into the signed-in account exactly
 * once. Ownership comes from the session cookie, never from the request body.
 */
export async function handleDraftImport(
  request: Request,
  environment: AuthEnvironment,
  overrides: AuthCompositionOverrides = {},
) {
  try {
    assertMutationRequest(request, environment.APP_ORIGIN);
    const service = requireLiveAuthService(resolveAuthService(environment, overrides));

    const rawToken = readSessionToken(request);
    if (!rawToken) {
      throw new AuthHttpError(401, "SESSION_REQUIRED", "Bu işlem için giriş yapılmalıdır.");
    }

    const payload = await parseDraftImportRequest(request);
    const result = await service.importDeviceDraft({
      rawToken,
      importKey: payload.importKey,
      draft: payload.draft,
    });

    return jsonNoStore(result, result.code === "DRAFT_IMPORTED" ? 201 : 200);
  } catch (error) {
    if (error instanceof DraftImportConflictError) {
      return jsonNoStore({ code: error.code, message: error.message }, error.status);
    }
    return errorResponse(error);
  }
}

export function POST(request: Request) {
  return handleDraftImport(request, process.env);
}
