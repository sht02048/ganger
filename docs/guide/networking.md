# Networking and webhooks

## Open it from other devices

The web app has no login. Anyone who can reach its address can change settings and send commands to your runners. Keep it on `127.0.0.1` or inside a private network such as a Tailscale tailnet, and never expose the whole app to the public internet; open only the webhook path (`/api/webhooks/...`) publicly. If you share your tailnet with other people, use Tailscale ACLs to limit which users and devices can reach the orchestrator's machine.

The server accepts a request only when its host name is one it knows, which blocks DNS rebinding and requests that other sites make from your browser. `127.0.0.1`, `localhost`, and `[::1]` always work, and so does the bind address (`WEB_HOST`) when it is a specific address rather than `0.0.0.0`. When `WEB_HOST` is a wildcard (`0.0.0.0` or `::`), the server also allows this machine's own tailnet IPs and MagicDNS name on the port it listens on (for example, `<device>.<tailnet>.ts.net:3000`), read from Tailscale on this machine, and lists them in Settings > **이 서버** (this server). The same names on Funnel ports (443, 8443, 10000), without a port, or on a request Tailscale marks as coming through Funnel reach only the webhook path. To open the app through Tailscale Serve on 443, set that address as the web address. Any request Tailscale marks as coming through Funnel reaches only the webhook path, whatever host name it sends. A raw TCP Funnel carries no such mark, so never point `tailscale funnel --tcp` or `--tls-terminated-tcp` at the app's port: that makes the whole app public. To use any other name, set it in Settings > **이 서버** (this server) (open Settings at `http://127.0.0.1:<port>` on the server machine the first time):

- **다른 기기에서 열 주소** (web address): where you open the app from other devices, for example the Tailscale Serve address `https://server.example.ts.net`. Requests to this host name reach the whole app.
- **Linear가 이 서버에 닿을 주소** (address Linear reaches this server at): the address your tracker sends webhooks to over the internet. Set it in the tracker connection's Webhook section, not under **이 서버**; see [Turn on the webhook](#turn-on-the-webhook). Browser requests to this host name reach only the webhook path, unless you also set it as the web address.

Requests that change data (including server functions) must also come from a page on an allowed host (the `Origin` header), except the webhook path, which checks the tracker's signature instead. Rejected requests get `403` and a line in the web server log. A browser opening a host name that is not allowed sees a page naming that host and where to add it, and the desktop app shows the same guidance with **다시 시도** (retry) and **다른 서버 고르기** (choose another server). If you upgrade an installation that you already open by another name, that name is blocked until you add it as the web address, unless it is this machine's own tailnet address on the server's port with a wildcard bind. The host check protects you from web pages in your browser; it is not access control, because any other client can send whatever host name it likes. So still publish only the webhook path through your tunnel (for example, a Tailscale Funnel or Cloudflare Tunnel route for `/api/webhooks/` only). `GET /api/identity` answers on any host name with the product name, version, and installation ID, so a client can tell this server apart from other machines. `GET /api/webhooks/ping/<installation ID>` also answers on any host name, but only says whether the ID you send is this installation's; the webhook check uses it.

## Turn on the webhook

A webhook is optional. Without one, the worker checks the tracker for tickets with the Auto-assign Label about once a minute and assigns the ones that have never had a run. With one, Linear tells the server the moment a ticket changes, so a labeled ticket is assigned within seconds, and removing and adding the label again retries a ticket that already had a run. Without it, assign such tickets again from Tickets. The once-a-minute check only looks back 24 hours after the worker starts, so tickets labeled while the worker was stopped for longer are not picked up; assign them from Tickets. Onboarding does not ask for a webhook.

Open Settings > **연결** (connections), select the tracker connection, and follow the three steps in its **Webhook** section:

1. **Linear가 이 서버에 닿을 주소** (address Linear reaches this server at). Linear sends webhooks from the internet, but the server usually listens only on this machine or inside your tailnet. Open only the webhook path (`/api/webhooks/`) to the internet, enter the address, and select **확인하기** (check). The server requests `<address>/api/webhooks/ping/<installation ID>` itself and saves the address only when this installation answers. The address is shared by every tracker connection on the server. If the check fails, the screen says whether the name was not found, nothing answered, or another server answered.
2. **Create the webhook in Linear.** Copy the full address the screen shows (the address followed by the connection's webhook path), open Linear's webhook settings from the link, paste it, and select only **Issues** under Data change events.
3. **Enter the signing secret and turn it on.** Paste the signing secret Linear shows for the new webhook. The section then waits for the first webhook; change any ticket in Linear and it switches to on. If webhooks keep arriving with a signature that does not match (for example, you recreated the webhook in Linear), the section and the connection's line in Settings show how many were rejected and since when; enter the new secret. **끄기** (turn off) deletes the secret and goes back to checking once a minute; delete the webhook in Linear as well.

Only the webhook path should be public. Never publish the whole app: it has no login.

### Tailscale Funnel

If Tailscale is installed on the server Mac, the Webhook section fills in this Mac's Tailscale name and shows the command with this server's address and port. It reads `tailscale serve status --json` and picks a free Funnel port, trying 8443, then 10000, then 443. Run the command once on the server Mac:

```sh
tailscale funnel --bg --https=8443 --set-path /api/webhooks/ http://127.0.0.1:3000/api/webhooks/
```

The address is then `https://<device>.<tailnet>.ts.net:8443` (with the port the screen picked).

- If all three ports are in use, the screen lists what uses each one and lets you pick. Running Funnel on a port makes everything on that port public, so the screen does not offer a port that serves this app or forwards TCP. Pick one that serves nothing private.
- If `WEB_HOST` is this Mac's own tailnet address, the screen shows no command, because Tailscale on macOS hangs when it proxies to its own tailnet address. Make the server listen on `127.0.0.1` too (for example, `WEB_HOST=0.0.0.0`).

- Funnel makes a whole port public: "If the most recent command to configure the port was `funnel`, then the port will be completely public" ([Tailscale Funnel](https://tailscale.com/kb/1223/funnel)). So keep the webhook on its own port. If you serve the app to your tailnet with Tailscale Serve on 443, do not run `funnel` on 443, or the whole app becomes public. On 8443, only `/api/webhooks/` is mapped, so nothing else is reachable.
- Funnel can listen only on ports 443, 8443, and 10000.
- The first time, Funnel needs MagicDNS, HTTPS certificates, and the `funnel` node attribute in your tailnet policy. Running the command prompts you to approve Funnel in the Tailscale admin console ([Tailscale Funnel](https://tailscale.com/kb/1223/funnel)).
- Public DNS for a new Funnel name can take up to 10 minutes. If the check says the name was not found, wait a few minutes and check again.
- `--bg` keeps Funnel running after reboots until you turn it off. To turn it off, run the same command with `off` added at the end ([`tailscale funnel`](https://tailscale.com/kb/1311/tailscale-funnel)).
- The check runs from the server itself, so it reaches the address over your tailnet. It proves the port serves this installation, but not that the internet can reach it: `tailscale serve --https=8443` (Serve, not Funnel) also passes. Run `tailscale funnel status` to confirm the port is on Funnel.

### Cloudflare Tunnel

Create a tunnel with `cloudflared` and add a public hostname whose service is `http://127.0.0.1:<port>` and whose path is `api/webhooks/*`, so Cloudflare forwards only the webhook path. Enter `https://<public hostname>` as the address.

### Reverse proxy

If the server is behind a reverse proxy that already has a public HTTPS name (nginx, Caddy), forward only `/api/webhooks/` to `http://127.0.0.1:<port>/api/webhooks/` and keep the host name. For Caddy:

```text
hooks.example.com {
  handle /api/webhooks/* {
    reverse_proxy 127.0.0.1:3000
  }
  respond 404
}
```

Enter `https://hooks.example.com` as the address. The address must use HTTPS and a DNS name; the check refuses IP addresses, `localhost`, and addresses with a path, and it does not follow redirects.
