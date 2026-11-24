import * as stylex from "@stylexjs/stylex";
import {
  Button,
  CodeBlock,
  DefinitionItem,
  DefinitionList,
  Dialog,
  DialogClose,
  Field,
  InfoTip,
  Input,
  ProblemCallout,
  RadioGroup,
  RadioOption,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  SettingsStep,
  SettingsSteps,
  Text,
  VisuallyHidden,
  buttonStyles,
  focusStyles,
  showToast,
  type SettingsStepState,
} from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { createContext, use, useEffect, useId, useRef, useState, type RefObject } from "react";
import { useTranslations } from "use-intl";
import type {
  FunnelPortChoice,
  FunnelSetupView,
  TrackerConnectionView,
  WebhookSetupView,
  WebhookStateView,
} from "@ganger/app/settings/model";
import { useTime } from "../format/time";
import {
  CLOUDFLARE_TUNNEL_GUIDE_URL,
  LINEAR_WEBHOOK_SETTINGS_URL,
  TAILSCALE_FUNNEL_GUIDE_URL,
} from "../onboarding/model";
import { browserClipboard, copyText } from "./clipboard";
import { CredentialFormFrame, ExternalLink, SecretField } from "./credential-forms";
import { useInlineEdit } from "./row-state";
import {
  ChangeButton,
  FocusFirst,
  WEBHOOK_ADDRESS_ROW_ID,
  type RenderSettingsLink,
} from "./settings-page";
import { SubmitError, useReportUnsaved, useSubmit, type SettingsActions } from "./settings-screen";

export const WEBHOOK_SECTION_ID = "webhook";

export interface WebhookSectionProps {
  connection: TrackerConnectionView;
  webhookAddress: string | null;
  webhookAddressChecked: boolean;
  now: string;
  actions: SettingsActions;
  renderLink: RenderSettingsLink;
}

const FocusRequestContext = createContext<(id: string) => void>(() => {});

function useFocusAfterRender(rendered: unknown): (id: string) => void {
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    if (pending === null) return;
    const target = document.getElementById(pending);
    if (target === null) return;
    target.focus();
    setPending(null);
  }, [pending, rendered]);
  return setPending;
}

export function webhookUrl(address: string | null, path: string): string | null {
  return address === null ? null : `${address}${path}`;
}

export function WebhookSection({
  connection,
  webhookAddress,
  webhookAddressChecked,
  now,
  actions,
  renderLink,
}: WebhookSectionProps) {
  const t = useTranslations("settings.webhook");
  const ts = useTranslations("settings");
  const state = connection.webhook;
  const requestFocus = useFocusAfterRender(state);
  return (
    <FocusRequestContext value={requestFocus}>
      <SettingsSection
        id={WEBHOOK_SECTION_ID}
        title={t("title")}
        info={<InfoTip label={ts("infoLabel", { label: t("infoLabel") })} content={t("info")} />}
        detail={
          <Text
            variant="meta"
            role="status"
            {...(state.kind === "rejected" ? { tone: "problem" as const } : {})}
          >
            {t(`status.${state.kind}`)}
          </Text>
        }
        detailTone={state.kind === "rejected" ? "problem" : "default"}
      >
        {state.kind === "off" ? (
          <WebhookSteps
            connection={connection}
            webhookAddress={webhookAddress}
            webhookAddressChecked={webhookAddressChecked}
            actions={actions}
            renderLink={renderLink}
          />
        ) : (
          <WebhookOn
            connection={connection}
            state={state}
            webhookAddress={webhookAddress}
            webhookAddressChecked={webhookAddressChecked}
            now={now}
            actions={actions}
            renderLink={renderLink}
          />
        )}
      </SettingsSection>
    </FocusRequestContext>
  );
}

const STEP_IDS = { address: "webhook-step-address", create: "webhook-step-create" } as const;

function WebhookSteps({
  connection,
  webhookAddress,
  webhookAddressChecked,
  actions,
  renderLink,
}: {
  connection: TrackerConnectionView;
  webhookAddress: string | null;
  webhookAddressChecked: boolean;
  actions: SettingsActions;
  renderLink: RenderSettingsLink;
}) {
  const t = useTranslations("settings.webhook");
  const requestFocus = use(FocusRequestContext);
  const addressDone = webhookAddressChecked;
  const url = webhookUrl(webhookAddress, connection.webhookPath);
  const stateLabel = (state: SettingsStepState) => t(`stepState.${state}`);
  const addressState: SettingsStepState = addressDone ? "done" : "current";
  const laterState: SettingsStepState = addressDone ? "open" : "locked";
  const createState: SettingsStepState = addressDone ? "current" : "locked";
  return (
    <SettingsSteps label={t("steps")}>
      <SettingsStep
        id={STEP_IDS.address}
        number={1}
        state={addressState}
        stateLabel={stateLabel(addressState)}
        label={t("address.label")}
        info={<AddressInfo />}
        detail={addressDone ? <VerifiedAddress address={webhookAddress} /> : undefined}
        control={<AddressLink renderLink={renderLink} set={webhookAddress !== null} />}
      >
        {addressDone ? null : (
          <Text variant="meta" as="p">
            {t("address.shared")}
          </Text>
        )}
      </SettingsStep>
      <SettingsStep
        id={STEP_IDS.create}
        number={2}
        state={createState}
        stateLabel={stateLabel(createState)}
        label={t("create.label")}
      >
        {url === null ? null : (
          <>
            <CopyValue label={t("create.urlLabel")} value={url} copied={t("copiedUrl")} />
            <LinearWebhookForm />
            <span>
              <ExternalLink href={connection.webhookSettingsUrl ?? LINEAR_WEBHOOK_SETTINGS_URL}>
                {t("create.open")}
              </ExternalLink>
            </span>
          </>
        )}
      </SettingsStep>
      <SettingsStep
        number={3}
        state={laterState}
        stateLabel={stateLabel(laterState)}
        label={t("secret.label")}
      >
        <SecretForm
          connection={connection}
          actions={actions}
          success={t("secret.turnedOn")}
          primaryLabel={t("secret.turnOn")}
          onDone={() => requestFocus(WAITING_ID)}
        />
      </SettingsStep>
    </SettingsSteps>
  );
}

function AddressLink({ renderLink, set }: { renderLink: RenderSettingsLink; set: boolean }) {
  const t = useTranslations("settings.webhook.address");
  return renderLink(
    { kind: "page", page: "connections", rowId: WEBHOOK_ADDRESS_ROW_ID },
    {
      ...stylex.props(...buttonStyles("secondary")),
      "aria-label": set ? t("changeOnConnections") : t("setOnConnections"),
      children: set ? t("change") : t("set"),
    },
  );
}

function LinearWebhookForm() {
  const t = useTranslations("settings.webhook.create");
  const ts = useTranslations("settings");
  return (
    <div {...stylex.props(styles.form)}>
      <span>
        <Text variant="meta">{t("formTitle")}</Text>
        <InfoTip label={ts("infoLabel", { label: t("formInfoLabel") })} content={t("formInfo")} />
      </span>
      <DefinitionList>
        <DefinitionItem label={t("formLabel")}>{t("formLabelValue")}</DefinitionItem>
        <DefinitionItem label={t("formUrl")}>{t("formUrlValue")}</DefinitionItem>
        <DefinitionItem label={t("formEvents")}>{t("formEventsValue")}</DefinitionItem>
        <DefinitionItem label={t("formTeams")}>{t("formTeamsValue")}</DefinitionItem>
      </DefinitionList>
    </div>
  );
}

function AddressInfo() {
  const t = useTranslations("settings.webhook");
  const ts = useTranslations("settings");
  return (
    <InfoTip label={ts("infoLabel", { label: t("address.label") })} content={t("address.info")} />
  );
}

function VerifiedAddress({ address }: { address: string | null }) {
  const t = useTranslations("settings.webhook");
  return (
    <>
      <Text variant="meta" mono wrap="anywhere">
        {address}
      </Text>
      {" · "}
      {t("address.verified")}
    </>
  );
}

function CopyValue({
  label,
  value,
  copied,
  ref,
}: {
  label: string;
  value: string;
  copied: string;
  ref?: RefObject<HTMLButtonElement | null>;
}) {
  const t = useTranslations("settings.webhook");
  const copy = () => {
    void copyText(value, browserClipboard()).then((done) =>
      showToast(done ? copied : t("copyFailed")),
    );
  };
  return (
    <div {...stylex.props(styles.copy)}>
      <Text variant="meta">{label}</Text>
      <CodeBlock tone="command" label={label}>
        {value}
      </CodeBlock>
      <span>
        <Button
          {...(ref === undefined ? {} : { ref })}
          aria-label={t("copyLabel", { label })}
          onClick={copy}
        >
          {t("copy")}
        </Button>
      </span>
    </div>
  );
}

function FunnelGuide({
  funnel,
  onPickAddress,
}: {
  funnel: FunnelSetupView;
  onPickAddress: (address: string) => void;
}) {
  const t = useTranslations("settings.webhook.address");
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} {...stylex.props(styles.funnel)}>
      <span {...stylex.props(styles.funnelHead)}>
        <Text variant="ui" tone="strong" id={titleId}>
          {t("funnelTitle")}
        </Text>
        <Text variant="meta">{t("funnelFound")}</Text>
      </span>
      {funnel.kind === "bind-tailnet" ? (
        <Text variant="meta" as="p">
          {t("funnelBindTailnet", { host: funnel.bindHost })}
        </Text>
      ) : (
        <>
          <Text variant="meta" as="p">
            {t("funnelFirst")}{" "}
            <ExternalLink href={TAILSCALE_FUNNEL_GUIDE_URL}>{t("funnelFirstLink")}</ExternalLink>
          </Text>
          {funnel.kind === "ready" ? (
            <>
              <Text variant="meta" as="p">
                {t(`funnelPort.${funnel.portState}`, { port: funnel.port })}
              </Text>
              <FunnelCommand command={funnel.command} sharedPort={funnel.portState === "unknown"} />
            </>
          ) : (
            <FunnelPortPicker ports={funnel.ports} onPickAddress={onPickAddress} />
          )}
        </>
      )}
    </section>
  );
}

function FunnelCommand({ command, sharedPort = false }: { command: string; sharedPort?: boolean }) {
  const t = useTranslations("settings.webhook.address");
  const tw = useTranslations("settings.webhook");
  return (
    <>
      <Text variant="meta" as="p">
        {sharedPort ? t("funnelRunShared") : t("funnelRun")}
      </Text>
      <CopyValue label={t("commandLabel")} value={command} copied={tw("copiedCommand")} />
      <Text variant="meta" as="p">
        {t("funnelThen")}
      </Text>
    </>
  );
}

function FunnelPortPicker({
  ports,
  onPickAddress,
}: {
  ports: ReadonlyArray<FunnelPortChoice>;
  onPickAddress: (address: string) => void;
}) {
  const t = useTranslations("settings.webhook.address");
  const labelId = useId();
  const name = useId();
  const [picked, setPicked] = useState<number | null>(null);
  const pickedPort = ports.find((port) => port.port === picked);
  const choice = pickedPort?.unavailable === null ? pickedPort : undefined;
  const anySelectable = ports.some((port) => port.unavailable === null);
  return (
    <>
      <Text variant="meta" as="p" id={labelId}>
        {anySelectable ? t("funnelFull") : t("funnelFullNone")}
      </Text>
      <RadioGroup labelledBy={labelId}>
        {ports.map((port) => (
          <RadioOption
            key={port.port}
            name={name}
            value={String(port.port)}
            checked={picked === port.port}
            disabled={port.unavailable !== null}
            onCheck={() => {
              if (port.unavailable !== null) return;
              setPicked(port.port);
              onPickAddress(port.address);
            }}
          >
            <span {...stylex.props(styles.funnelChoice)}>
              <Text variant="ui">
                {port.isPublic
                  ? t("funnelPortPublic", { port: port.port })
                  : t("funnelPortName", { port: port.port })}
              </Text>
              <Text variant="meta" mono wrap="anywhere">
                {port.uses.length === 0 ? t("funnelPortInUse") : port.uses.join(", ")}
              </Text>
              {port.unavailable === null ? null : (
                <Text variant="meta">{t(`funnelPortUnavailable.${port.unavailable}`)}</Text>
              )}
            </span>
          </RadioOption>
        ))}
      </RadioGroup>
      {choice === undefined ? null : (
        <>
          <Text variant="meta" tone="strong" as="p" role="status">
            {t("funnelPortWarning", { port: choice.port })}
          </Text>
          <FunnelCommand command={choice.command} sharedPort />
        </>
      )}
    </>
  );
}

const ADDRESS_ERRORS = [
  "invalid-address",
  "name-not-found",
  "unreachable",
  "other-server",
  "check-failed",
] as const;

export function AddressEditor({
  initial,
  setup,
  actions,
  onClose,
  onSaved,
}: {
  initial: string;
  setup: WebhookSetupView;
  actions: SettingsActions;
  onClose: (() => void) | undefined;
  onSaved: () => void;
}) {
  const t = useTranslations("settings.webhook.address");
  const ts = useTranslations("settings");
  const [value, setValue] = useState(initial);
  const [failed, setFailed] = useState<(typeof ADDRESS_ERRORS)[number] | null>(null);
  const [tried, setTried] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickedAddress = useRef<string | null>(null);
  const submit = useSubmit();
  useReportUnsaved(onClose !== undefined && value !== initial);
  const reason = submit.state.kind === "failed" ? submit.state.reason : null;
  const failedState = submit.state.kind === "failed" ? submit.state : null;
  useEffect(() => {
    if (failedState === null) return;
    const knownReason = ADDRESS_ERRORS.find((known) => known === failedState.reason) ?? null;
    setFailed(knownReason);
    if (knownReason !== null) inputRef.current?.focus();
  }, [failedState]);
  const known = reason !== null && failed !== null;
  const errorKey =
    failed === "unreachable" && (setup.funnel === null || setup.funnel.kind === "bind-tailnet")
      ? "unreachableNoFunnel"
      : failed;
  return (
    <div {...stylex.props(styles.editor)}>
      <Text variant="meta" as="p">
        {t("description")}
      </Text>
      {setup.funnel === null ? null : (
        <FunnelGuide
          funnel={setup.funnel}
          onPickAddress={(address) => {
            const untouched = value === initial || value === pickedAddress.current;
            if (value === "" || untouched) setValue(address);
            pickedAddress.current = address;
          }}
        />
      )}
      <CredentialFormFrame
        onClose={onClose}
        onSubmit={() => {
          setTried(true);
          submit.run(
            () => actions.checkWebhookAddress({ address: value.trim() }),
            t("saved"),
            onSaved,
          );
        }}
        footer={
          <>
            <ExternalLink href={CLOUDFLARE_TUNNEL_GUIDE_URL}>{t("otherWays")}</ExternalLink>
            <InfoTip
              label={ts("infoLabel", { label: t("reverseProxy") })}
              content={t("reverseProxyInfo")}
            />
          </>
        }
        submit={
          <Button variant="primary" type="submit" disabled={submit.sending}>
            {submit.sending ? t("checking") : tried ? t("recheck") : t("check")}
          </Button>
        }
      >
        <Field
          label={t("field")}
          error={errorKey !== null && known && !submit.sending ? t(`error.${errorKey}`) : undefined}
        >
          <Input
            ref={inputRef}
            name="webhookAddress"
            type="url"
            value={value}
            onValueChange={setValue}
            placeholder={t("placeholder")}
            autoComplete="off"
            mono
          />
        </Field>
        {known ? null : <SubmitError state={submit.state} />}
      </CredentialFormFrame>
    </div>
  );
}

function SecretForm({
  connection,
  actions,
  success,
  primaryLabel,
  onClose,
  onDone,
}: {
  connection: TrackerConnectionView;
  actions: SettingsActions;
  success: string;
  primaryLabel: string;
  onClose?: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("settings.webhook.secret");
  const fieldsRef = useRef<HTMLDivElement>(null);
  const [secret, setSecret] = useState("");
  const [missing, setMissing] = useState(false);
  useReportUnsaved(secret !== "");
  const submit = useSubmit();
  return (
    <CredentialFormFrame
      onClose={onClose}
      footer={null}
      onSubmit={() => {
        const ready = secret.trim() !== "";
        setMissing(!ready);
        if (!ready) {
          fieldsRef.current?.querySelector("input")?.focus();
          return;
        }
        submit.run(
          () =>
            actions.saveConnection({
              id: connection.id,
              apiKey: "",
              webhookSecret: secret.trim(),
            }),
          success,
          () => {
            setSecret("");
            onDone();
          },
        );
      }}
      submit={
        <Button variant="primary" type="submit" disabled={submit.sending}>
          {submit.sending ? t("turningOn") : primaryLabel}
        </Button>
      }
    >
      <div ref={fieldsRef} {...stylex.props(styles.fields)}>
        <Text variant="meta" as="p">
          {t("description")}
        </Text>
        <SecretField
          name="webhookSecret"
          label={t("field")}
          hint={t("info")}
          hints="info"
          error={missing ? t("required") : undefined}
          placeholder={t("placeholder")}
          value={secret}
          onValueChange={(value) => {
            setSecret(value);
            if (missing) setMissing(value.trim() === "");
          }}
        />
      </div>
      <SubmitError state={submit.state} />
    </CredentialFormFrame>
  );
}

const WAITING_ID = "webhook-waiting";

function WebhookOn({
  connection,
  state,
  webhookAddress,
  webhookAddressChecked,
  now,
  actions,
  renderLink,
}: {
  connection: TrackerConnectionView;
  state: Exclude<WebhookStateView, { kind: "off" }>;
  webhookAddress: string | null;
  webhookAddressChecked: boolean;
  now: string;
  actions: SettingsActions;
  renderLink: RenderSettingsLink;
}) {
  const t = useTranslations("settings.webhook");
  const requestFocus = use(FocusRequestContext);
  const time = useTime();
  const secretEdit = useInlineEdit("webhook-secret");
  const url = webhookUrl(webhookAddress, connection.webhookPath);
  const last =
    state.kind === "receiving"
      ? time.ago(state.lastReceivedAt, state.lastReceivedAgoMs)
      : state.kind === "rejected" &&
          state.lastReceivedAt !== null &&
          state.lastReceivedAgoMs !== null
        ? time.ago(state.lastReceivedAt, state.lastReceivedAgoMs)
        : null;
  return (
    <div {...stylex.props(styles.on)}>
      {state.kind === "rejected" ? (
        <ProblemCallout
          title={t("rejected.title", { count: state.rejectedCount })}
          actions={
            secretEdit.open ? undefined : (
              <Button onClick={secretEdit.show}>{t("rejected.reenter")}</Button>
            )
          }
        >
          {t("rejected.body", { since: time.stamp(state.firstRejectedAt, now) })}
        </ProblemCallout>
      ) : null}
      <SettingsGroup>
        {state.kind === "waiting" ? (
          <div id={WAITING_ID} tabIndex={-1} {...stylex.props(focusStyles.target)}>
            <SettingsRow label={t("waiting.title")} detail={t("waiting.detail")} />
          </div>
        ) : (
          <SettingsRow label={t("lastReceived")} value={last ?? t("lastReceivedNone")} />
        )}
        {webhookAddressChecked ? null : (
          <SettingsRow
            label={t("address.label")}
            info={<AddressInfo />}
            detail={
              webhookAddress === null
                ? t("address.notSet")
                : t("address.notChecked", { address: webhookAddress })
            }
            detailTone="problem"
            control={<AddressLink renderLink={renderLink} set={webhookAddress !== null} />}
          />
        )}
        <SettingsRow
          label={t("url")}
          detail={url ?? t("urlMissing")}
          detailMono={url !== null}
          control={
            url === null ? undefined : (
              <CopyButton label={t("url")} value={url} copied={t("copiedUrl")} />
            )
          }
        />
        <SettingsRow
          label={t("secretRow")}
          detail={secretEdit.open ? undefined : t("secretSet")}
          control={
            secretEdit.open ? undefined : (
              <ChangeButton edit={secretEdit} label={t("secretRow")} action={t("secret.reenter")} />
            )
          }
          expanded={
            secretEdit.open ? (
              <FocusFirst>
                <SecretForm
                  connection={connection}
                  actions={actions}
                  success={t("secretSaved")}
                  primaryLabel={t("secret.save")}
                  onClose={secretEdit.close}
                  onDone={() => requestFocus(WAITING_ID)}
                />
              </FocusFirst>
            ) : null
          }
        />
        <TurnOffRow connection={connection} actions={actions} />
      </SettingsGroup>
    </div>
  );
}

function CopyButton({ label, value, copied }: { label: string; value: string; copied: string }) {
  const t = useTranslations("settings.webhook");
  return (
    <Button
      aria-label={t("copyLabel", { label })}
      onClick={() => {
        void copyText(value, browserClipboard()).then((done) =>
          showToast(done ? copied : t("copyFailed")),
        );
      }}
    >
      {t("copy")}
    </Button>
  );
}

function TurnOffRow({
  connection,
  actions,
}: {
  connection: TrackerConnectionView;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings.webhook.off");
  const requestFocus = use(FocusRequestContext);
  const submit = useSubmit();
  return (
    <SettingsRow
      label={t("label")}
      detail={t("detail")}
      message={<SubmitError state={submit.state} />}
      control={
        <Dialog
          trigger={
            <>
              <VisuallyHidden>{t("trigger")}</VisuallyHidden>
              <span aria-hidden="true">{t("button")}</span>
            </>
          }
          triggerVariant="danger"
          title={t("confirmTitle")}
          description={t("confirmBody")}
          actions={
            <>
              <DialogClose>{t("cancel")}</DialogClose>
              <DialogClose
                variant="danger"
                onClick={() =>
                  submit.run(
                    () => actions.turnOffWebhook({ id: connection.id }),
                    t("done"),
                    () => requestFocus(`${WEBHOOK_SECTION_ID}-heading`),
                  )
                }
              >
                {t("confirm")}
              </DialogClose>
            </>
          }
        />
      }
    />
  );
}

const styles = stylex.create({
  form: { display: "flex", flexDirection: "column", gap: space.s2 },
  copy: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  funnel: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  funnelChoice: { display: "flex", flexDirection: "column", gap: space.px2, minWidth: 0 },
  funnelHead: { display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: space.s2 },
  on: { display: "flex", flexDirection: "column", gap: space.s3 },
  editor: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0 },
  fields: { display: "flex", flexDirection: "column", gap: space.s4 },
});
