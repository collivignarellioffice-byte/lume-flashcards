declare module "cloudflare:workers" {
  export const env: { DB?: D1Database };
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

declare const d1DatabaseBrand: unique symbol;

interface D1Database {
  readonly [d1DatabaseBrand]: "D1Database";
}
