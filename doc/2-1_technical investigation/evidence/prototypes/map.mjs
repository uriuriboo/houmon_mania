// Prototype: Foursquare v2 /users/self/checkins item -> checkins row (requirements section 5 + proposed extras)
// Pure function, no I/O. Defaults are chosen so that a missing key never throws.

const asStr = (v) => (typeof v === 'string' && v.length > 0 ? v : null);
const asNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const asInt = (v) => (Number.isInteger(v) ? v : null);

/** categories: primary first, then API order; names only */
export function categoryNames(venue) {
  const cats = Array.isArray(venue?.categories) ? venue.categories : [];
  const sorted = [...cats].sort((a, b) => (b?.primary === true) - (a?.primary === true));
  return sorted.map((c) => asStr(c?.name)).filter(Boolean);
}

export function primaryCategory(venue) {
  const cats = Array.isArray(venue?.categories) ? venue.categories : [];
  return cats.find((c) => c?.primary === true) ?? cats[0] ?? null;
}

/** icon URL: prefix + size + suffix (size: 32|44|64|88|120, or 'bg_64' etc.) */
export function categoryIconUrl(cat, size = 64) {
  const p = asStr(cat?.icon?.prefix);
  const s = asStr(cat?.icon?.suffix);
  return p && s ? `${p}${size}${s}` : null;
}

/** photo URL: prefix + size + suffix (size: 'original' | 'WxH' | 'capN' | 'widthN' | 'heightN') */
export function photoUrl(photo, size = 'original') {
  const p = asStr(photo?.prefix);
  const s = asStr(photo?.suffix);
  return p && s ? `${p}${size}${s}` : null;
}

/** formattedAddress shape differs by API version: string[] (older v) or {text:"a\nb", entities:[]} (seen in 2023 docs example) */
export function formattedAddressText(loc) {
  const fa = loc?.formattedAddress;
  if (Array.isArray(fa)) {
    const parts = fa.filter((x) => typeof x === 'string' && x.length > 0);
    return parts.length ? parts.join(', ') : null;
  }
  if (fa && typeof fa === 'object' && typeof fa.text === 'string' && fa.text.length > 0) {
    return fa.text.split('\n').map((s) => s.trim()).filter(Boolean).join(', ');
  }
  return null;
}

export function toRow(item, userId) {
  if (!item || typeof item !== 'object') throw new Error('item is not an object');
  const id = asStr(item.id);
  const createdAt = asInt(item.createdAt);
  if (!id || createdAt === null) throw new Error(`required field missing: id=${item.id} createdAt=${item.createdAt}`);

  const venue = item.venue && typeof item.venue === 'object' ? item.venue : null;
  const loc = venue?.location ?? null;
  // venueless/shout check-ins (old Foursquare) may carry a top-level `location` {name, lat, lng}
  const looseLoc = !venue && item.location && typeof item.location === 'object' ? item.location : null;
  const pcat = primaryCategory(venue);
  const owner = asStr(item.user?.id);
  const creator = asStr(item.createdBy?.id);

  return {
    id,
    user_id: userId,
    created_at: new Date(createdAt * 1000).toISOString(), // timestamptz (UTC)
    tz_offset: asInt(item.timeZoneOffset), // minutes; NULL if absent
    type: asStr(item.type) ?? 'checkin', // checkin | shout | venueless
    shout: asStr(item.shout), // key is absent when no shout
    venue_id: asStr(venue?.id),
    venue_name: asStr(venue?.name) ?? asStr(looseLoc?.name),
    categories: categoryNames(venue), // text[] default '{}'
    primary_category_id: asStr(pcat?.id),
    primary_category_icon: categoryIconUrl(pcat, 64),
    address: asStr(loc?.address),
    formatted_address: formattedAddressText(loc),
    neighborhood: asStr(loc?.neighborhood),
    city: asStr(loc?.city),
    state: asStr(loc?.state),
    country: asStr(loc?.country),
    cc: asStr(loc?.cc),
    lat: asNum(loc?.lat) ?? asNum(looseLoc?.lat),
    lng: asNum(loc?.lng) ?? asNum(looseLoc?.lng),
    is_fuzzed: loc?.isFuzzed === true,
    venue_closed: venue?.closed === true,
    venue_private: venue?.private === true,
    photo_count: asInt(item.photos?.count) ?? 0,
    comment_count: asInt(item.comments?.count) ?? 0,
    like_count: asInt(item.likes?.count) ?? 0,
    is_private: item.private === true,
    visibility: asStr(item.visibility), // public | closeFriends | private | (absent on old data)
    source_name: asStr(item.source?.name),
    event_name: asStr(item.event?.name),
    created_by_other: creator !== null && owner !== null ? creator !== owner : creator !== null && item.createdBy?.relationship !== 'self',
    raw: item,
  };
}

/** client-side equivalent of the DB search_text (NFKC + lowercase) for test comparison */
export function searchText(row) {
  const parts = [row.venue_name, row.shout, row.address, row.formatted_address, row.city, row.state, row.country, ...(row.categories ?? [])];
  return parts.filter(Boolean).join(' ').normalize('NFKC').toLowerCase();
}
