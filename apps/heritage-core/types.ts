export type TenantId = "first-federal" | "riverside";

export interface TenantLabels {
  memberId: string;
  memberName: string;
  balance: string;
  openProduct: string;
  confirm: string;
  productType: string;
  receiptId: string;
  inquiry: string;
  home: string;
}

export interface TenantTheme {
  primary: string;
  accent: string;
  bg: string;
}

export interface TenantConfig {
  id: TenantId;
  name: string;
  shortName: string;
  labels: TenantLabels;
  theme: TenantTheme;
}

export interface MemberRecord {
  id: string;
  name: string;
  savingsBalance: number;
  canOpenProduct: boolean;
  slowInquiryMs?: number;
}
