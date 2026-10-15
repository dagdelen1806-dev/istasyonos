export {};
declare global {
  interface Window {
    __MANUS_CONFIG__?: {
      authProvider: "local" | "manus";
      projectId: string; oauthPortalUrl: string; apiUrl: string; apiBrowserKey: string;
    };
  }
}
