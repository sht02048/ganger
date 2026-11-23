import { DesktopRegistrations } from "@ganger/app/devices/connection";

let registrations: DesktopRegistrations | undefined;

export function getDesktopRegistrations(): DesktopRegistrations {
  registrations ??= new DesktopRegistrations();
  return registrations;
}
