export function backupDatabase(options: {
  databaseUrl: string;
  archivePath: string;
}): Promise<{ status: 'backed_up'; archiveSha256: string; tables: 63 }>;
