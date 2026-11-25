export const DEVICE_KINDS = ["phone", "desktop"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];
