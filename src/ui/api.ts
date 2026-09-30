import type { CloakApi } from "../shared/types.ts";
const methods: (keyof CloakApi)[] = [
  "snapshot",
  "inspect",
  "create",
  "sync",
  "checkUpdates",
  "connectRepository",
  "saveSettings",
  "saveProtection",
  "protectionAction",
  "repairLink",
  "forget",
  "openProject",
  "openRepository",
  "chooseFolder",
];
export const api: CloakApi =
  window.cloak ??
  (Object.fromEntries(
    methods.map((method) => [
      method,
      async (...args: unknown[]) => {
        const response = await fetch("/api/rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method, args }),
        });
        const result = await response.json();
        if (!response.ok || result.error)
          throw new Error(result.error || "Could not connect to Cloak.");
        return result.value;
      },
    ]),
  ) as CloakApi);
export const message = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method 'cloak': Error: /,
        "",
      )
    : String(error);
