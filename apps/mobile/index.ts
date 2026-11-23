import { registerRootComponent } from "expo";

import App from "./src/App";
import { setUpPushHandling } from "./src/notifications/push-device";

setUpPushHandling();

registerRootComponent(App);
