import type { PoolConnection } from "mysql2/promise";
import type { Row, Scope } from "./market-pos";
import type { StationActor, StationRole } from "./types";
export type MarketHandler = (
  c: PoolConnection,
  actor: StationActor,
  body: Record<string, unknown>,
  scope: Scope,
  station: string,
  book: Row | null
) => Promise<unknown>;
export type MarketPost = (
  path: string,
  roles: StationRole[],
  handler: MarketHandler,
  needsBook?: boolean,
  allowClosed?: boolean
) => void;
