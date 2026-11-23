import { Button, PinnedToast } from "@ganger/ui";
import { t } from "../i18n";
import { reloadPage } from "./server-build";

export function ServerBuildToast() {
  const title = t("shell.serverBuild.title");
  return (
    <PinnedToast
      title={title}
      announcement={title}
      actions={
        <Button variant="primary" onClick={reloadPage}>
          {t("shell.serverBuild.reload")}
        </Button>
      }
    >
      {t("shell.serverBuild.body")}
    </PinnedToast>
  );
}
