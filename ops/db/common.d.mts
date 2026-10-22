import type { Pool, PoolClient } from 'pg';
export interface RestoreOwnership {
  version: 1;
  databaseName: string;
  databaseOid: number;
  nonce: string;
}
export const repositoryRoot: string;
export function restoreName(value: unknown): boolean;
export function quoteIdentifier(value: string): string;
export function isMain(url: string): boolean;
export function readSecretEnv(name: string, env?: NodeJS.ProcessEnv): Promise<string>;
export function parseDatabaseUrl(value: string, expectedUser?: string): URL;
export function sameServer(left: URL, right: URL, sameDatabase?: boolean): void;
export function targetUrl(url: URL | string, databaseName: string): URL;
export function assertPrivatePath(path: string, existing?: boolean): Promise<void>;
export function assertOwnedRestoreTarget(
  pool: Pick<Pool | PoolClient, 'query'>,
  ownership: RestoreOwnership,
): Promise<void>;
export function loadRestoreTarget(
  env?: NodeJS.ProcessEnv,
): Promise<{ pool: Pool; ownership: RestoreOwnership; close(): Promise<void> }>;
export function runAsCli(operation: string, action: () => Promise<unknown>): Promise<void>;
export function openPrivateOutput(path: string): Promise<import('node:fs/promises').FileHandle>;
export function readPrivateJson(path: string): Promise<unknown>;
export function writePrivateJson(path: string, value: unknown): Promise<void>;
export function hashPrivateFile(path: string): Promise<string>;
export function runPgTool(
  program: 'pg_dump' | 'pg_restore',
  args: string[],
  url: URL,
  outputFd?: number,
): Promise<string>;
