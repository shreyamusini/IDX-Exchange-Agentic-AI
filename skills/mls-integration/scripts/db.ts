// MySQL connection module
// One shared connection pool; every query goes through query(), which uses 
// prepared statements so user values are always sent separately from the SQL

import mysql from "mysql2/promise";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env");

if (existsSync(envPath)) process.loadEnvFile(envPath);

const REQUIRED_ENV = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"] as const;

let pool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
    if (pool) return pool;

const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missing.length > 0) {
    throw new Error(
        `Missing database settings: ${missing.join(", ")}. Add them to mls-integration/.env.`
    );
}

pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    decimalNumbers: true,
    dateStrings: true,
});
return pool;
}

export async function query<T>(sql: string, params: (string | number)[] = []): Promise<T[]> {
    const [rows] = await getPool().execute(sql, params);
    return rows as T[];
}

export async function closePool(): Promise<void> {
    if (pool) {
        await pool.end();
        pool = null;
    }
}

