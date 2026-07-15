import { RuntimeError } from "../util/errors.js";
import { PosixPlatformServices } from "./posix-platform-services.js";
import type { PlatformServices } from "./platform-services.js";
import { WindowsPlatformServices } from "./windows-platform-services.js";

export class UnsupportedPlatformError extends RuntimeError {
  readonly code = "unsupported-platform" as const;
  constructor() { super("runtime operations are unsupported on win32"); this.name = "UnsupportedPlatformError"; }
}

let services: PlatformServices | undefined;
export function getPlatformServices(): PlatformServices {
  if (!services) services = process.platform === "win32"
    ? new WindowsPlatformServices()
    : new PosixPlatformServices();
  return services;
}
