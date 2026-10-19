declare namespace NodeJS {
  interface ProcessEnv {
    TURSO_DATABASE_URL?: string;
    TURSO_AUTH_TOKEN?: string;
    DASHBOARD_PASSWORD?: string;
    DASHBOARD_SESSION_SECRET?: string;
  }
}
