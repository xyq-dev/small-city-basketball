/** C22 public reference data; these IDs never grant access to private business resources. */
export type RegionLevel = 'PROVINCE' | 'PREFECTURE' | 'COUNTY';
export interface RegionSelection {
  catalogVersion: string;
  regionId: string;
}
export interface PublicRegionNode {
  id: string;
  parentId: string | null;
  name: string;
  level: RegionLevel;
}
export interface PublicRegionCatalogData {
  catalogVersion: string;
  dataDate: string;
  /** Roots for which lower levels are not included in this fixed catalog. */
  partialRootIds: string[];
  regions: PublicRegionNode[];
}
