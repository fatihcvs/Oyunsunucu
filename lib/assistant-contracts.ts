import { evaluatePlanChange, resolveRelativePlan } from "./plan-change.ts";
import { SERVER_COMMANDS, canCommandServer, isServerCommand, type ServerCommand } from "./provisioning-contracts.ts";
import { getPlan } from "./catalog.ts";
import { settingFields, validateSettings, type ServerSettings, type SettingField } from "./server-settings.ts";

/**
 * What the assistant is allowed to propose.
 *
 * A closed set on purpose. The model never returns SQL, a shell command, a
 * provider call or a free-form action: it picks one of these shapes, and every
 * one of them maps onto a service method the panel already exposes. The worst a
 * misunderstanding can produce is a proposal the customer declines.
 */
export type AssistantProposal =
  | {
    kind: "change_settings";
    serverId: string;
    serverName: string;
    settings: ServerSettings;
    changedKeys: string[];
    restarts: true;
    summary: string;
  }
  | {
    kind: "change_plan";
    serverId: string;
    serverName: string;
    planId: string;
    planLabel: string;
    monthlyDifference: number;
    monthlyAfter: number;
    restarts: true;
    summary: string;
  }
  | {
    kind: "command";
    serverId: string;
    serverName: string;
    command: ServerCommand;
    restarts: boolean;
    summary: string;
  };

/** What the assistant is told about one of the caller's servers. */
export type AssistantServerContext = {
  serverId: string;
  name: string;
  gameId: string;
  softwareId: string;
  planId: string;
  regionId: string;
  status: string;
  settings: ServerSettings;
  availableCommands: readonly ServerCommand[];
  canEditSettings: boolean;
  busyWith: string | null;
};

export type ProposalResult =
  | { ok: true; proposal: AssistantProposal }
  | { ok: false; code: string; message: string };

function findServer(servers: readonly AssistantServerContext[], reference: unknown) {
  if (typeof reference !== "string" || !reference.trim()) {
    return servers.length === 1 ? servers[0] : null;
  }
  const wanted = reference.trim().toLocaleLowerCase("tr");
  return servers.find((server) =>
    server.serverId === reference ||
    server.name.toLocaleLowerCase("tr") === wanted) ?? null;
}


/**
 * Turns a settings proposal into something the panel can execute, or refuses it.
 *
 * The model's output is treated as a suggestion that still has to pass the same
 * catalogue rules a hand-typed form would: unknown keys, out-of-range numbers
 * and a server the caller does not own are all rejected here rather than at the
 * provider.
 */
export function buildSettingsProposal(
  servers: readonly AssistantServerContext[],
  input: { server?: unknown; settings?: unknown },
): ProposalResult {
  const server = findServer(servers, input.server);
  if (!server) return { ok: false, code: "SERVER_NOT_FOUND", message: "Hangi sunucuyu kastettiğini bulamadım." };
  if (!server.canEditSettings) {
    return {
      ok: false,
      code: "SETTINGS_NOT_ALLOWED",
      message: server.busyWith
        ? `${server.name} üzerinde bekleyen bir işlem var; bitince ayarları değiştirebilirim.`
        : `${server.name} bu durumdayken ayar değiştirilemiyor.`,
    };
  }

  const requested = typeof input.settings === "object" && input.settings !== null && !Array.isArray(input.settings)
    ? input.settings as Record<string, unknown>
    : null;
  if (!requested) return { ok: false, code: "INVALID_SETTINGS", message: "Hangi ayarı değiştireceğimi anlayamadım." };

  const memoryMb = getPlan(server.planId).ram * 1_024;
  // The model only names the fields it wants to change; the rest keep their value.
  const merged = { ...server.settings, ...requested };
  const validation = validateSettings(server.gameId, memoryMb, merged);
  if (!validation.ok) return { ok: false, code: validation.code, message: validation.message };

  const changedKeys = Object.keys(validation.settings).filter(
    (key) => validation.settings[key] !== server.settings[key],
  );
  if (changedKeys.length === 0) {
    return { ok: false, code: "NOTHING_TO_CHANGE", message: "Bu ayarlar zaten böyle." };
  }

  // Wording comes from the catalogue itself rather than a second list beside
  // it, so a field added to the panel is never summarised by its raw key.
  const fields = settingFields(server.gameId, memoryMb);
  const described = changedKeys
    .map((key) => {
      const field = fields.find((candidate) => candidate.key === key);
      return `${field?.label ?? key}: ${formatValue(field, validation.settings[key])}`;
    })
    .join(", ");

  return {
    ok: true,
    proposal: {
      kind: "change_settings",
      serverId: server.serverId,
      serverName: server.name,
      settings: validation.settings,
      changedKeys,
      restarts: true,
      summary: `${server.name} ayarları — ${described}`,
    },
  };
}

function formatValue(field: SettingField | undefined, value: unknown) {
  if (typeof value === "boolean") return value ? "açık" : "kapalı";
  if (typeof value === "string" && !value) return "boş";
  // A choice is stored as the value the runtime wants, which is rarely the
  // wording the customer chose it by.
  if (field?.kind === "choice") {
    const choice = field.choices.find((candidate) => candidate.value === value);
    if (choice) return choice.label;
  }
  return String(value);
}

/**
 * Resolves a plan proposal, including relative phrasing such as "2x".
 *
 * A multiplier is turned into a real catalogue entry by the same function the
 * panel uses, so the assistant cannot invent a plan or a price.
 */
export function buildPlanProposal(
  servers: readonly AssistantServerContext[],
  input: { server?: unknown; planId?: unknown; multiplier?: unknown },
): ProposalResult {
  const server = findServer(servers, input.server);
  if (!server) return { ok: false, code: "SERVER_NOT_FOUND", message: "Hangi sunucuyu kastettiğini bulamadım." };

  let planId = typeof input.planId === "string" ? input.planId : "";
  if (!planId && typeof input.multiplier === "number") {
    const resolved = resolveRelativePlan(server.planId, input.multiplier);
    if (!resolved) {
      return {
        ok: false,
        code: "NO_LARGER_PLAN",
        message: "Katalogda bu kadar büyük bir paket yok.",
      };
    }
    planId = resolved.id;
  }
  if (!planId) return { ok: false, code: "PLAN_REQUIRED", message: "Hangi pakete geçmek istediğini anlayamadım." };

  const check = evaluatePlanChange({
    fromPlanId: server.planId,
    toPlanId: planId,
    regionId: server.regionId,
    gameId: server.gameId,
    softwareId: server.softwareId,
  });
  if (!check.ok) return { ok: false, code: check.code, message: check.message };

  return {
    ok: true,
    proposal: {
      kind: "change_plan",
      serverId: server.serverId,
      serverName: server.name,
      planId: check.change.to.id,
      planLabel: check.change.to.label,
      monthlyDifference: check.change.monthlyDifference,
      monthlyAfter: check.change.monthlyAfter,
      restarts: true,
      summary: `${server.name} → ${check.change.to.label} paketi (${check.change.to.ram} GB), aylık +${check.change.monthlyDifference} TL`,
    },
  };
}

const COMMAND_LABELS: Record<ServerCommand, string> = {
  baslat: "başlat",
  durdur: "durdur",
  "yeniden-baslat": "yeniden başlat",
};

export function buildCommandProposal(
  servers: readonly AssistantServerContext[],
  input: { server?: unknown; command?: unknown },
): ProposalResult {
  const server = findServer(servers, input.server);
  if (!server) return { ok: false, code: "SERVER_NOT_FOUND", message: "Hangi sunucuyu kastettiğini bulamadım." };
  if (!isServerCommand(input.command)) {
    return { ok: false, code: "UNKNOWN_COMMAND", message: "Bu işlemi yapamıyorum." };
  }
  if (server.busyWith) {
    return { ok: false, code: "SERVER_BUSY", message: `${server.name} üzerinde bekleyen bir işlem var.` };
  }
  if (!canCommandServer(server.status as never, input.command)) {
    return {
      ok: false,
      code: "COMMAND_NOT_ALLOWED",
      message: `${server.name} bu durumdayken ${COMMAND_LABELS[input.command]} yapılamıyor.`,
    };
  }

  return {
    ok: true,
    proposal: {
      kind: "command",
      serverId: server.serverId,
      serverName: server.name,
      command: input.command,
      restarts: SERVER_COMMANDS[input.command] === "restart_server",
      summary: `${server.name} sunucusunu ${COMMAND_LABELS[input.command]}`,
    },
  };
}
