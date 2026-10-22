// Conversation entry point for the mls-integration skill. The agent runs this once per
// WhatsApp message, always with the same --user for the same person.
//
// Examples:
//   node --experimental-strip-types chat.ts --user "+15551234567" --message "Find homes in Irvine"
//   node --experimental-strip-types chat.ts --user "+15551234567" --message "Under $1.2M"
//   node --experimental-strip-types chat.ts --user "+15551234567" --show-session
import { parseArgs } from "node:util";
import { closePool } from "./db.ts";
import { handleMessage } from "./conversation.ts";
import { getSession, safeUserId } from "./session.ts";

// Used when the agent doesn't pass --user, matching search.ts.
const DEFAULT_USER = "whatsapp-default";

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function friendlyError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  switch (e.code) {
    case "ECONNREFUSED":
      return "Couldn't connect to MySQL. Make sure it's running (brew services start mysql).";
    case "ER_ACCESS_DENIED_ERROR":
      return "MySQL rejected the login. Check mls-integration/.env.";
    case "ER_BAD_FIELD_ERROR":
      return `A column name doesn't match your table: ${e.message}`;
    default:
      return e.message ?? String(err);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      user: { type: "string" },
      message: { type: "string" },
      "show-session": { type: "boolean" },
    },
  });

  const user = values.user?.trim() || DEFAULT_USER;

  if (values["show-session"]) {
    const { lastResults, ...rest } = getSession(user);
    print({ ok: true, user: safeUserId(user), session: { ...rest, lastResults: lastResults?.length ?? 0 } });
    return;
  }

  const message = values.message?.trim();
  if (!message) {
    print({ ok: false, error: 'Pass --message "<what the user said>".' });
    process.exit(1);
  }

  try {
    const result = await handleMessage(user, message);
    print({ ok: true, user: safeUserId(user), ...result });
  } catch (err) {
    print({ ok: false, error: friendlyError(err) });
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

await main();
