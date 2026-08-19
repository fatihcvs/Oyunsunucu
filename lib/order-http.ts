import { errorResponse, jsonNoStore } from "./auth-http.ts";
import { OrderFlowError } from "./order-service.ts";

/**
 * Maps order failures to their public answer.
 *
 * Only errors this layer raises deliberately carry their own status and code;
 * everything else falls through to the generic handler, so an unexpected
 * failure cannot leak an internal message.
 */
export function orderErrorResponse(error: unknown) {
  if (error instanceof OrderFlowError) {
    return jsonNoStore({ code: error.code, message: error.message }, error.status);
  }
  return errorResponse(error);
}
