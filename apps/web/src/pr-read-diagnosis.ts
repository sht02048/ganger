import { useTranslations } from "use-intl";
import type { PrReadDiagnosis } from "@ganger/app/pr-read-diagnosis";

export type PrReadDiagnosisPlace = "run" | "runner";

export function usePrReadDiagnosisText(): (
  diagnosis: PrReadDiagnosis,
  place: PrReadDiagnosisPlace,
) => string {
  const t = useTranslations("domain.prReadDiagnosis");
  return (diagnosis, place) => {
    const server = diagnosis.server.kind;
    const serverLogins = diagnosis.server.kind === "gh" ? diagnosis.server.logins.join(", ") : "";
    if (diagnosis.kind === "runner-unknown") {
      return t("runnerUnknown", { runner: diagnosis.runner, server, serverLogins });
    }
    return t("different", {
      runner: diagnosis.runner,
      runnerLogin: diagnosis.runnerLogin,
      server,
      serverLogins,
      where: place,
    });
  };
}
