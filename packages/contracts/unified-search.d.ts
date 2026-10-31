export type SearchKind = 'EVENT' | 'TEAM' | 'PLAYER';
export interface PublicSearchItem {
  kind: SearchKind;
  publicKey: string;
  displayName: string;
  city: string | null;
  startsOn: string | null;
  endsOn: string | null;
}
export interface PublicSearchData {
  query: string;
  items: PublicSearchItem[];
  nextCursor: string | null;
  asOf: string;
  notice: string;
}
