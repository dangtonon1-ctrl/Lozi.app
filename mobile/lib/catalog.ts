import { supabase } from './supabase';

// ── Catalog data layer ──────────────────────────────────────────────────────
// Wraps the browse_products RPC and the store/variety metadata the catalog needs,
// porting the frozen web app's rowToProduct + withDiscount mapping (app.main.js).
// The client renders rows in the order the DB returns them; it never sorts/filters
// the whole catalog itself. Product images are stored as FULL public URLs in the
// product `data` JSON, so no storage-URL construction is needed.

export type Bilingual = { ar: string; en: string };

// Yemen currency unit (LOZI_T_UNIT.YER on the web). Prices are integers with
// en-US thousands separators; the unit renders in small type in the Money component.
export const CURRENCY_YER = 'ر.ي';

export function fmtMoney(n: number | null | undefined): string {
  return Math.round(Number(n) || 0).toLocaleString('en-US');
}

export type Sort = 'best' | 'price_asc' | 'price_desc' | 'rating' | 'newest';

export type BrowseOpts = {
  section?: string | null; // products.category ('almond'|'raisin'|'retail'|'wholesale'); null = all
  sort?: Sort;
  varieties?: string[];
  priceMin?: number | null;
  priceMax?: number | null;
  shahti?: boolean;
  freeDelivery?: boolean;
  bundle?: boolean;
  discount?: boolean;
  limit?: number;
  offset?: number;
};

// A store's retail offer JSON: { discount:{percent,scope,productId}, bundle, freeDelivery }.
export type StoreOffer = {
  discount?: { percent?: number; scope?: string; productId?: string } | null;
  bundle?: unknown;
  freeDelivery?: boolean;
};
export type StoreOffers = Record<string, StoreOffer | null>; // vendorId → offers

export type StoreInfo = {
  name: string;
  image?: string; // stores.image_path (full URL or path; rendered as-is)
  trustedBadge: boolean;
  badgeSource?: string;
  rating: number | null;
  ratingsCount: number;
  shahtiFree: boolean;
  freeDelivery: boolean;
  offers: StoreOffer | null;
};
export type StoresMap = Record<string, StoreInfo>; // vendorId → store

export type SectionVariety = {
  section: string;
  variety_id: string;
  label_ar: string;
  label_en: string | null;
  sort: number;
};

// Mapped product, ready for the card/detail. Display fields come from the `data`
// JSON; stock/price fall back from the top-level column to `data`.
export type Product = {
  id: string;
  name: Bilingual;
  weight: Bilingual;
  desc?: Bilingual;
  img?: string;
  thumb?: string;
  images: string[];
  thumbs: string[];
  variety?: string;
  price: number | null;
  old?: number; // pre-discount price → strikethrough
  stock: number | null; // null = unlimited / in stock (only stock<=0 is "نفد")
  shahtiStatus: string | null;
  cat: string | null;
  vendorId: string | null;
  vendorRole: string | null;
  bundle?: boolean;
  pinned: boolean;
  limitedOfferEndsAt: string | null;
  createdAt: string | null;
  allowByAmount: boolean; // "بالمبلغ" mode — a detail/cart concern, not shown on the card
  isPackage: boolean;
};

// browse_products returns whole `products` rows (setof products).
type ProductRow = {
  id: string;
  category: string | null;
  market_segment: string | null;
  price: number | string | null;
  stock: number | string | null;
  shahti_status: string | null;
  vendor_role: string | null;
  vendor_id: string | null;
  pinned: boolean | null;
  pinned_at: string | null;
  limited_offer_enabled: boolean | null;
  limited_offer_ends_at: string | null;
  weight_grams: number | null;
  allow_byamount: boolean | null;
  is_package: boolean | null;
  created_at: string | null;
  data: Record<string, unknown> | null;
};

export type ErrKind = 'network' | 'server';
export type BrowseResult = { ok: true; products: Product[] } | { ok: false; kind: ErrKind };
export type StoresResult =
  | { ok: true; storesMap: StoresMap; storeOffers: StoreOffers }
  | { ok: false; kind: ErrKind };

// Distinguish "no connection" from "the server errored" (the web returned a bare
// null for both — a real bug). Network failures throw a fetch TypeError or come
// back with a network-ish message; everything else is treated as a server error.
function classifyError(e: unknown): ErrKind {
  const msg = String((e as { message?: unknown } | null)?.message ?? e ?? '').toLowerCase();
  if (/network|fetch|timeout|timed out|connection|offline|unreachable|econn|enotfound/.test(msg)) {
    return 'network';
  }
  return 'server';
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normBilingual(v: unknown): Bilingual {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const ar = o.ar != null ? String(o.ar) : o.en != null ? String(o.en) : '';
    const en = o.en != null ? String(o.en) : o.ar != null ? String(o.ar) : '';
    return { ar, en };
  }
  const s = v != null ? String(v) : '';
  return { ar: s, en: s };
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter(Boolean).map(String) : [];
}

function rowToProduct(r: ProductRow): Product {
  const d = r.data ?? {};
  return {
    id: r.id,
    name: normBilingual(d.name),
    weight: normBilingual(d.weight),
    desc: d.desc != null ? normBilingual(d.desc) : undefined,
    img: typeof d.img === 'string' ? d.img : undefined,
    thumb: typeof d.thumb === 'string' ? d.thumb : undefined,
    images: strArray(d.images),
    thumbs: strArray(d.thumbs),
    variety: typeof d.variety === 'string' ? d.variety : undefined,
    price: r.price != null ? toNum(r.price) : toNum(d.price),
    stock: r.stock != null ? toNum(r.stock) : toNum(d.stock),
    shahtiStatus: r.shahti_status ?? (typeof d.shahtiStatus === 'string' ? d.shahtiStatus : null),
    cat: r.category ?? (typeof d.cat === 'string' ? d.cat : null),
    vendorId: r.vendor_id ?? null,
    vendorRole: r.vendor_role ?? null,
    bundle: d.bundle === true ? true : undefined,
    pinned: r.pinned === true,
    limitedOfferEndsAt: (r.limited_offer_enabled && r.limited_offer_ends_at) || null,
    createdAt: r.created_at ?? null,
    allowByAmount: r.allow_byamount === true,
    isPackage: r.is_package === true,
  };
}

// Apply a store's discount to a product (port of the web withDiscount). Scope
// 'all' discounts every product; 'product' only the matching id. Sets `old` for
// the strikethrough. No-op when the store has no applicable discount.
export function withDiscount(p: Product, offers: StoreOffers): Product {
  const off = p.vendorId ? offers[p.vendorId] : null;
  const d = off?.discount;
  if (!d || !d.percent || !p.price) return p;
  const applies = d.scope === 'all' || (d.scope === 'product' && d.productId === p.id);
  if (!applies) return p;
  return { ...p, price: Math.round(p.price * (1 - d.percent / 100)), old: p.price };
}

// Prefer the thumbnail in the grid card (smaller download on weak networks);
// full images are for the detail carousel.
export function cardImage(p: Product): string | undefined {
  return p.thumbs[0] ?? p.thumb ?? p.images[0] ?? p.img;
}
export function detailImages(p: Product): string[] {
  if (p.images.length) return p.images;
  return p.img ? [p.img] : [];
}

export async function browseProducts(o: BrowseOpts, offers: StoreOffers = {}): Promise<BrowseResult> {
  try {
    const { data, error } = await supabase.rpc('browse_products', {
      p_section: o.section ?? null,
      p_sort: o.sort ?? 'best',
      p_varieties: o.varieties && o.varieties.length ? o.varieties : null,
      p_price_min: o.priceMin != null ? o.priceMin : null,
      p_price_max: o.priceMax != null ? o.priceMax : null,
      p_shahti_only: !!o.shahti,
      p_free_delivery_only: !!o.freeDelivery,
      p_bundle_only: !!o.bundle,
      p_discount_only: !!o.discount,
      p_limit: o.limit ?? 24,
      p_offset: o.offset ?? 0,
    });
    if (error) return { ok: false, kind: classifyError(error) };
    const rows = (data ?? []) as ProductRow[];
    const products = rows.map(rowToProduct).map((p) => withDiscount(p, offers));
    return { ok: true, products };
  } catch (e) {
    return { ok: false, kind: classifyError(e) };
  }
}

type StoreRow = {
  vendor_id: string;
  name: string | null;
  image_path: string | null;
  offers: StoreOffer | null;
  trusted_badge: boolean | null;
  badge_source: string | null;
  average_rating: number | string | null;
  ratings_count: number | null;
  shahti_free: boolean | null;
  free_delivery: boolean | null;
};

const STORE_COLUMNS =
  'vendor_id,name,image_path,offers,trusted_badge,badge_source,average_rating,ratings_count,shahti_free,free_delivery';

function mapStoreRow(r: StoreRow): StoreInfo {
  return {
    name: r.name ?? '',
    image: r.image_path ?? undefined,
    trustedBadge: r.trusted_badge === true,
    badgeSource: r.badge_source ?? undefined,
    rating: toNum(r.average_rating),
    ratingsCount: r.ratings_count ?? 0,
    shahtiFree: r.shahti_free === true,
    freeDelivery: r.free_delivery === true,
    offers: r.offers ?? null,
  };
}

// Loads every store's public info + offers in one query, building the vendorId→store
// and vendorId→offers maps (mirrors the web loader). See 10-web-parity-gaps.md:
// this "load all" is logged tech debt — fine at the current store count, doesn't scale.
export async function loadStores(): Promise<StoresResult> {
  try {
    const { data, error } = await supabase.from('stores').select(STORE_COLUMNS);
    if (error) return { ok: false, kind: classifyError(error) };
    const storesMap: StoresMap = {};
    const storeOffers: StoreOffers = {};
    for (const r of (data ?? []) as StoreRow[]) {
      if (r.offers) storeOffers[r.vendor_id] = r.offers;
      storesMap[r.vendor_id] = mapStoreRow(r);
    }
    return { ok: true, storesMap, storeOffers };
  } catch (e) {
    return { ok: false, kind: classifyError(e) };
  }
}

export type ProductDetail = { product: Product; store: StoreInfo | null };
export type ProductResult = { ok: true; detail: ProductDetail } | { ok: false; kind: ErrKind | 'not_found' };

// Loads one available product by id (RLS still gates wholesale visibility on a
// direct table read) plus its store, for the detail screen. Applies the store
// discount so the price/old match the catalog.
export async function loadProduct(id: string): Promise<ProductResult> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .eq('status', 'available')
      .maybeSingle();
    if (error) return { ok: false, kind: classifyError(error) };
    if (!data) return { ok: false, kind: 'not_found' };
    const row = data as ProductRow;

    let store: StoreInfo | null = null;
    const offers: StoreOffers = {};
    if (row.vendor_id) {
      const { data: s } = await supabase.from('stores').select(STORE_COLUMNS).eq('vendor_id', row.vendor_id).maybeSingle();
      if (s) {
        const sr = s as StoreRow;
        if (sr.offers) offers[sr.vendor_id] = sr.offers;
        store = mapStoreRow(sr);
      }
    }
    const product = withDiscount(rowToProduct(row), offers);
    return { ok: true, detail: { product, store } };
  } catch (e) {
    return { ok: false, kind: classifyError(e) };
  }
}

// A store as returned by browse_stores (aggregated, wholesale-gated server-side).
export type StoreCard = {
  vendorId: string;
  name: string;
  image?: string;
  description?: string;
  trustedBadge: boolean;
  rating: number | null;
  ratingsCount: number;
  productCount: number;
  inStockCount: number;
  minPrice: number | null;
  offers: StoreOffer | null;
};

type StoreCardRow = {
  vendor_id: string;
  name: string | null;
  image_path: string | null;
  description: string | null;
  offers: StoreOffer | null;
  trusted_badge: boolean | null;
  average_rating: number | string | null;
  ratings_count: number | null;
  product_count: number | null;
  in_stock_count: number | null;
  min_price: number | string | null;
};

function mapStoreCard(r: StoreCardRow): StoreCard {
  return {
    vendorId: r.vendor_id,
    name: r.name ?? '',
    image: r.image_path ?? undefined,
    description: r.description ?? undefined,
    trustedBadge: r.trusted_badge === true,
    rating: toNum(r.average_rating),
    ratingsCount: r.ratings_count ?? 0,
    productCount: r.product_count ?? 0,
    inStockCount: r.in_stock_count ?? 0,
    minPrice: toNum(r.min_price),
    offers: r.offers ?? null,
  };
}

// Build a vendorId→offers map from already-fetched store cards, so the home can
// apply discounts to the rail without a separate load-all-stores query.
export function offersFromStores(stores: StoreCard[]): StoreOffers {
  const m: StoreOffers = {};
  for (const s of stores) if (s.offers) m[s.vendorId] = s.offers;
  return m;
}

// Capped featured-stores fetch (browse_stores RPC). The home uses this instead of
// loading the whole store table (per the lazy-load decision, see 10-web-parity-gaps).
export async function browseStores(o: {
  section?: string | null;
  sort?: Sort;
  limit?: number;
}): Promise<{ ok: true; stores: StoreCard[] } | { ok: false; kind: ErrKind }> {
  try {
    const { data, error } = await supabase.rpc('browse_stores', {
      p_section: o.section ?? null,
      p_sort: o.sort ?? 'best',
      p_varieties: null,
      p_shahti_only: false,
      p_free_delivery_only: false,
      p_limit: o.limit ?? 6,
      p_offset: 0,
    });
    if (error) return { ok: false, kind: classifyError(error) };
    const rows = (data ?? []) as StoreCardRow[];
    return { ok: true, stores: rows.map(mapStoreCard) };
  } catch (e) {
    return { ok: false, kind: classifyError(e) };
  }
}

export async function loadSectionVarieties(): Promise<SectionVariety[]> {
  try {
    const { data, error } = await supabase
      .from('section_varieties')
      .select('section,variety_id,label_ar,label_en,sort')
      .order('sort');
    if (error || !data) return [];
    return data as SectionVariety[];
  } catch {
    return [];
  }
}
