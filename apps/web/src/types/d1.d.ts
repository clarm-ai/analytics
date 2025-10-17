// Minimal ambient declarations for Cloudflare D1 to satisfy TypeScript during build.
// If @cloudflare/workers-types is added, these can be removed.

declare interface D1Result<T = unknown> {
  results?: T[];
}

declare interface D1PreparedStatement<T = unknown> {
  bind(...values: any[]): D1PreparedStatement<T>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<void>;
}

declare interface D1Database {
  prepare(query: string): D1PreparedStatement<any>;
}



