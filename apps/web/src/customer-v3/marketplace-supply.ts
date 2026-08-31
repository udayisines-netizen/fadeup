/**
 * The customer supply model, at the frontend's half of it.
 *
 * ELIGIBILITY is enforced server-side: every V3 discovery query asks the RPC
 * for shop-shaped rows only (`p_entity_type: 'shop'`), so a staff barber can
 * never surface as separate supply and `total_count` counts genuinely
 * eligible rows. The LABEL is the RPC-derived `marketplace_supply_type`
 * ('independent' | 'barbershop' | NULL) consumed verbatim; NULL renders no
 * label and never falls back to the commoner guess.
 *
 * What this module (with `marketplace-supply.test.ts`) still guards is the
 * architectural boundary: the internal `organizations.business_type` enum
 * must never reach customer client code. The test scans this directory and
 * fails if any file names an internal enum value in code.
 */
export {}
