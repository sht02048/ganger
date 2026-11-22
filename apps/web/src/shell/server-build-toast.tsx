import { Button, PinnedToast } from "@ganger/ui";
import { useTranslations } from "use-intl";
import { reloadPage } from "./server-build";

export function ServerBuildToast() {
  const t = useTranslations("shell.serverBuild");
  const title = t("title");
  return (
    <PinnedToast
      title={title}
      announcement={title}
      actions={
        <Button variant="primary" onClick={reloadPage}>
          {t("reload")}
        </Button>
      }
    >
      {t("body")}
    </PinnedToast>
  );
}
