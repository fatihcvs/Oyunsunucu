import { jsonNoStore } from "../../../../lib/auth-http.ts";
import {
  publicAuthRuntimeStatus,
  type AuthEnvironment,
} from "../../../../lib/auth-runtime.ts";

export const dynamic = "force-dynamic";

export function createAuthStatusResponse(environment: AuthEnvironment) {
  return jsonNoStore(publicAuthRuntimeStatus(environment));
}

export function GET() {
  return createAuthStatusResponse(process.env);
}
