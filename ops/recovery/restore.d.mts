export function restoreDatabase(options: {
  adminUrl: string;
  migratorUrl: string;
  archivePath: string;
  databaseName: string;
  receiptPath: string;
}): Promise<{ status: 'restored'; databaseName: string; tables: 83 }>;
