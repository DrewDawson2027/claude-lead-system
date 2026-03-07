import { createRouteRegistry } from "../router.js";
import { registerSystemRoutes } from "./system.js";
import { registerTeamRoutes } from "./teams.js";
import { registerNativeRoutes } from "./native.js";
import { registerActionRoutes } from "./actions.js";
import { registerUiRoutes } from "./ui.js";
import { registerMaintenanceRoutes } from "./maintenance.js";

export function buildServerRouter() {
  const registry = createRouteRegistry();
  registerSystemRoutes(registry);
  registerTeamRoutes(registry);
  registerActionRoutes(registry);
  registerNativeRoutes(registry);
  registerUiRoutes(registry);
  registerMaintenanceRoutes(registry);
  return registry;
}
