/**
 * 2026-11-23 — THE ROAD ROUTES, AS DISPATCH READS THEM (the Netherlands–Bulgaria plan, step 3c), by a token, looked up when first
 * needed. Border routes reach back into dispatch (through the directory), so dispatch may not have them at construction: importing
 * the class closed a circle of imports through which other services saw DispatchService as undefined, and injecting this alias made
 * the application wait on itself at boot. Dispatch imports only the type; the module provides the service under this token.
 */
export const ROAD_ROUTES = Symbol('ROAD_ROUTES');
