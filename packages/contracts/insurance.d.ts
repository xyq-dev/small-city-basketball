export type InsurancePaymentStatus =
  'UNPAID' | 'PENDING' | 'PAID' | 'REFUND_PENDING' | 'REFUNDED' | 'FAILED';
export type InsurancePolicyStatus =
  'PENDING' | 'ISSUED' | 'FAILED' | 'CANCEL_PENDING' | 'CANCELLED';
export interface InsuranceProductData {
  id: string;
  insurer: string;
  name: string;
  termsVersion: string;
  termsUrl: string;
  basketballCovered: boolean;
}
export interface InsuranceOrderData {
  id: string;
  entryId: string;
  memberId: string;
  version: number;
  premiumFen: number;
  currency: 'CNY';
  coverageStartDate: string;
  coverageEndDate: string;
  paymentStatus: InsurancePaymentStatus;
  policyStatus: InsurancePolicyStatus;
  verifiedAt: string | null;
  maskedPolicyNumber: string | null;
  canDownloadDocument: boolean;
  pendingOperation: string | null;
  canRefresh: boolean;
  canRequestCancellation: boolean;
  currentMaterial: boolean;
}
export interface InsuranceWorkspaceData {
  enabled: boolean;
  reason: string | null;
  products: InsuranceProductData[];
  orders: InsuranceOrderData[];
  notice: string;
}
