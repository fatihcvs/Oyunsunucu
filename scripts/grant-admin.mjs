import { isValidEmail, normalizeEmail } from "../lib/auth-contracts.ts";
import { databaseTlsMode } from "../infra/postgres/driver-binding.ts";
import { createNodePostgresDatabase } from "../infra/postgres/node-pg-executor.ts";

const ROLE = new Set(["owner", "operator", "support"]);

function argument(name) {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const email = normalizeEmail(argument("--email") ?? "");
const role = argument("--role") ?? "operator";
const create = process.argv.includes("--create");
const displayName = (argument("--display-name") ?? "Riftory Admin").trim();
const connectionString = process.env.DATABASE_URL?.trim();

if (!isValidEmail(email)) {
  throw new Error("Kullanım: npm run admin:grant -- --email kullanici@example.com [--role owner|operator|support] [--create] [--display-name ad]");
}
if (!ROLE.has(role)) throw new Error("Admin rolü owner, operator veya support olmalıdır.");
if (displayName.length < 2 || displayName.length > 60 || /[\u0000-\u001f\u007f]/.test(displayName)) {
  throw new Error("Admin görünen adı 2-60 karakter olmalıdır.");
}
if (!connectionString) throw new Error("DATABASE_URL gerekli.");

const tlsMode = databaseTlsMode(process.env);
const database = createNodePostgresDatabase({
  connectionString,
  ssl: tlsMode === "disable" ? undefined : { rejectUnauthorized: tlsMode === "verify" },
});

try {
  const result = await database.transaction(async (transaction) => {
    await transaction.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`identity:${email}`]);
    const user = await transaction.query(
      `SELECT id::text AS id
         FROM users
        WHERE email = $1 AND status = 'active' AND deleted_at IS NULL
        LIMIT 1`,
      [email],
    );
    let userId = typeof user.rows[0]?.id === "string" ? user.rows[0].id : null;
    let created = false;
    if (!userId && create) {
      const inserted = await transaction.query(
        `INSERT INTO users (email, display_name, email_verified_at)
         VALUES ($1, $2, now())
         RETURNING id::text AS id`,
        [email, displayName],
      );
      userId = typeof inserted.rows[0]?.id === "string" ? inserted.rows[0].id : null;
      created = true;
    }
    if (!userId) throw new Error("Bu e-posta için aktif ve doğrulanmış bir Riftory hesabı bulunamadı. Bilinçli bootstrap için --create kullanın.");

    await transaction.query(
      `INSERT INTO auth_accounts (user_id, provider, provider_account_id, provider_email)
       VALUES ($1::uuid, 'email', $2, $2)
       ON CONFLICT (provider, provider_account_id) DO UPDATE SET
         provider_email = EXCLUDED.provider_email, updated_at = now()`,
      [userId, email],
    );

    await transaction.query(
      `INSERT INTO admin_memberships (user_id, role, granted_by_user_id)
       VALUES ($1::uuid, $2, $1::uuid)
       ON CONFLICT (user_id) DO UPDATE
         SET role = EXCLUDED.role, updated_at = now()`,
      [userId, role],
    );
    await transaction.query(
      `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata)
       VALUES ($1::uuid, 'admin.membership.bootstrap', 'user', $1, $2::jsonb)`,
      [userId, JSON.stringify({ role, source: "grant-admin-script", created })],
    );
    return { userId, created };
  });

  console.log(`Admin üyeliği hazır: user=${result.userId} role=${role} created=${result.created}`);
} finally {
  await database.close();
}
