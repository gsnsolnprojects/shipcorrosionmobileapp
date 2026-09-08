/**
 * Common ship/vessel areas offered as quick-pick options for the "Ship
 * part" field, so the corrosion dashboard can reliably group findings by
 * area instead of relying purely on freeform typed text. A crew member can
 * always type a custom name instead — this list is a shortcut, not a
 * restriction.
 *
 * Keep in sync with visionm-authflow/src/lib/constants/shipAreas.ts (no
 * shared package between the two repos — this is a small, rarely-changing
 * list, so a synced copy is simpler than cross-repo tooling).
 */
export const COMMON_SHIP_AREAS: string[] = [
  "Engine room",
  "Bridge",
  "Main deck",
  "Bow",
  "Stern",
  "Cargo hold",
  "Ballast tank",
  "Hull (below waterline)",
  "Hull (above waterline)",
  "Superstructure",
  "Deckhouse",
  "Anchor / chain locker",
  "Rudder / steering gear",
  "Propeller / stern tube",
  "Freeboard deck",
];
