export type RouteHandler = (ctx: any) => boolean | Promise<boolean>;

export interface RouteRegistry {
  add(name: string, handler: RouteHandler): void;
  handle(ctx: any): Promise<boolean>;
  list(): string[];
}

export function createRouteRegistry(): RouteRegistry {
  const routes: Array<{ name: string; handler: RouteHandler }> = [];
  return {
    add(name: string, handler: RouteHandler) {
      routes.push({ name, handler });
    },
    async handle(ctx: any) {
      for (const route of routes) {
        if (await route.handler(ctx)) return true;
      }
      return false;
    },
    list() {
      return routes.map((r) => r.name);
    },
  };
}
