/**
 * Cross-feature read models.
 *
 * Every view here depends on several feature packages and is depended on by nothing but
 * the app, per `docs/adr/0001-cross-feature-read-models.md`. None of them writes SQL of
 * its own, and none of them writes to the database at all.
 *
 * This package was called `agenda` when it held one view. The second — search — made the
 * name wrong, and the ADR's unit is the composition *layer*, not one package per view.
 * Renamed at two instances, while it was still cheap.
 */
export * from './agenda.ts';
export * from './full-search.ts';
export * from './search.ts';
