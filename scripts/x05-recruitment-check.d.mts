import type { Buffer } from 'node:buffer';
export function assertPosterPng(
  bytes: Buffer,
  width?: number,
  height?: number,
): { width: number; height: number };
