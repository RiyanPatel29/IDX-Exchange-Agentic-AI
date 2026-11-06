// Week 3: run the searches against MySQL.
import { query } from "./pool.ts";
import {
  buildListingQuery, buildCompsQuery, buildCompsSummaryQuery, buildListingByIdQuery,
  buildCandidateIdsQuery, buildListingsByIdsQuery, buildRemarksPageQuery,
  type SearchOptions, type CompsOptions,
} from "./queries.ts";
import type { PropertyFilters } from "../search/parsePropertyQuery.ts";

export interface ListingRow {
  L_ListingID: string; L_DisplayId: string | null; L_Address: string | null;
  L_City: string | null; L_Zip: string | null;
  price: number | null; beds: number | null; baths: number | null; sqft: number | null;
  type: string | null; status: string | null; lat: number | null; lng: number | null;
  YearBuilt: number | null; AssociationFee: number | null; DaysOnMarket: number | null;
  PoolPrivateYN: string | null; ViewYN: string | null; FireplaceYN: string | null;
  PhotoCount: number | null;
  LA1_UserFirstName: string | null; LA1_UserLastName: string | null; LO1_OrganizationName: string | null;
}

export interface SoldRow {
  ListingKey: number; UnparsedAddress: string | null; City: string | null; PostalCode: string | null;
  closeDate: Date | string | null; ClosePrice: number; OriginalListPrice: number | null;
  ListPrice: number | null; DaysOnMarket: number | null;
  BedroomsTotal: number | null; BathroomsTotalInteger: number | null; LivingArea: number | null;
  PropertySubType: string | null; YearBuilt: number | null;
  ListAgentFullName: string | null; ListOfficeName: string | null; BuyerOfficeName: string | null;
}

export interface CompsSummary {
  soldCount: number; avgClosePrice: number | null; avgPricePerSqft: number | null;
  avgDom: number | null; listToClosePct: number | null; months: number;
}

export interface SearchResult {
  listings: ListingRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function searchActiveListings(
  filters: Partial<PropertyFilters>, opts: SearchOptions = {},
): Promise<SearchResult> {
  const q = buildListingQuery(filters, opts);
  const [listings, countRows] = await Promise.all([
    query<ListingRow>(q.sql, q.params),
    query<{ total: number }>(q.countSql, q.countParams),
  ]);
  const total = Number(countRows[0]?.total ?? 0);
  return { listings, total, page: q.page, limit: q.limit, totalPages: Math.max(1, Math.ceil(total / q.limit)) };
}

export async function getSoldComps(city: string, opts: CompsOptions = {}): Promise<SoldRow[]> {
  const q = buildCompsQuery(city, opts);
  return query<SoldRow>(q.sql, q.params);
}

export async function getCompsSummary(city: string, opts: CompsOptions = {}): Promise<CompsSummary> {
  const q = buildCompsSummaryQuery(city, opts);
  const [row] = await query<Omit<CompsSummary, "months">>(q.sql, q.params);
  return { ...row, soldCount: Number(row?.soldCount ?? 0), months: q.months };
}

// Week 4: full details for one listing (used by "tell me about #2")
export interface ListingDetail extends ListingRow { remarks: string | null }

export async function getListingById(listingId: string): Promise<ListingDetail | null> {
  const q = buildListingByIdQuery(listingId);
  const [row] = await query<ListingDetail>(q.sql, q.params);
  return row ?? null;
}

// Week 6: ids that pass the hard filters (internal, for semantic ranking)
export async function getCandidateIds(filters: Partial<PropertyFilters>): Promise<string[]> {
  const q = buildCandidateIdsQuery(filters);
  const rows = await query<{ L_ListingID: string }>(q.sql, q.params);
  return rows.map((r) => String(r.L_ListingID));
}

// Week 6: listings by id with their descriptions (max 50)
export async function getListingsByIds(ids: string[]): Promise<ListingDetail[]> {
  const q = buildListingsByIdsQuery(ids);
  return q ? query<ListingDetail>(q.sql, q.params) : [];
}

export interface RemarksRow {
  L_ListingID: string; L_City: string | null; type: string | null;
  beds: number | null; baths: number | null; sqft: number | null; remarks: string | null;
}
export async function getRemarksPage(opts: { city?: string | null; afterId?: string; batch?: number }): Promise<RemarksRow[]> {
  const q = buildRemarksPageQuery(opts);
  return query<RemarksRow>(q.sql, q.params);
}
