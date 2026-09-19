/** Shop pricing (systems-spec §4.2): charisma is the haggle lever. */
import type { ObjPrototype, ShopDef } from "../world/model.ts";
import type { World } from "../world/world.ts";
import type { LiveWorld } from "./liveWorld.ts";
import type { MobInstance } from "./mobInstance.ts";

/** Does `kw` match this object (a keyword prefix, or a substring of its short description)? */
export function objMatches(proto: ObjPrototype, kw: string): boolean {
  const k = kw.toLowerCase();
  return (
    proto.keywords.toLowerCase().split(/\s+/).some((w) => w.startsWith(k)) ||
    proto.shortDesc.toLowerCase().includes(k)
  );
}

/** profitmod = 13 - buyer_CHA: higher charisma lowers the markup. */
export function profitMod(cha: number): number {
  return 13 - cha;
}

/** BUY = cost * max(profit_sell+1, profit_buy+profitmod) / 100. */
export function buyPrice(proto: ObjPrototype, shop: ShopDef, cha: number): number {
  const pct = Math.max(shop.profitSell + 1, shop.profitBuy + profitMod(cha));
  return Math.max(1, Math.floor((proto.cost * pct) / 100));
}

/** SELL = cost * min(profit_sell+1, profit_buy+profitmod) / 100 — 0 unless the shop trades the type. */
export function sellPrice(proto: ObjPrototype, shop: ShopDef, cha: number): number {
  if (!shop.tradeTypes.includes(proto.itemType)) return 0;
  const pct = Math.min(shop.profitSell + 1, shop.profitBuy + profitMod(cha));
  return Math.max(0, Math.floor((proto.cost * pct) / 100));
}

/** The shopkeeper mob present in a room (if any), with its shop record. */
export function shopkeeperIn(
  world: World,
  live: LiveWorld,
  roomVnum: number,
): { mob: MobInstance; shop: ShopDef } | null {
  for (const mob of live.roomMobs(roomVnum)) {
    const shop = world.shops.get(mob.proto.vnum);
    if (shop) return { mob, shop };
  }
  return null;
}
