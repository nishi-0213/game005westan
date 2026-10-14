import { invalidatePaths } from './pathfinding.ts';
import type { MapItem } from './items';
import { ITEM_TYPES, returnItems } from './items.ts';
import type { Tile } from './movement';
import { BUILD_RECIPES } from './walls.ts';
import type { Wall, Walls } from './walls';

export function demolishStructure(walls: Walls, items: MapItem[], tile: Tile): Wall | null {
  const target = walls.at(tile);
  if (!target || target.state !== 'completed' || !target.demolition || (target.kind !== 'wall' && target.kind !== 'storage')) return null;
  returnItems(items, tile, target.material, Math.floor(BUILD_RECIPES[target.kind]!.materialCount / 2));
  for (const type of ITEM_TYPES.filter(type=>type!=='humanCorpse'&&type!=='deerCorpse')) returnItems(items, tile, type, target.stored?.[type] ?? 0);
  target.stored = { wood: 0, stone: 0, strawberry: 0, rifle: 0, meat: 0, humanCorpse: 0, deerCorpse: 0 };
  target.state = 'cancelled';
  walls.erase(target);
  invalidatePaths(walls.isBlocked);
  return target;
}
