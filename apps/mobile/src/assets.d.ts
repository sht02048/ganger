declare module "*.otf" {
  const asset: number;
  export default asset;
}

declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_GANGER_DEV_SERVER?: string;
    EXPO_PUBLIC_GANGER_DEV_TOKEN?: string;
    GANGER_MOBILE_BUILD?: string;
  }
}
