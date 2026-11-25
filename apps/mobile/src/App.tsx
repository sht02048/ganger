import Constants from "expo-constants";
import { isLoaded } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native";

import { AppRoot } from "./connection/app-root";
import { connectionStore } from "./connection/connection-store";
import { bundledDevConnection } from "./connection/dev-connection";
import { cacheFiles } from "./connection/offline-cache-files";
import { platformFetch } from "./connection/platform-fetch";
import { pushDevice } from "./notifications/push-device";
import { pushMemory } from "./notifications/push-memory";
import { colors } from "./design/tokens";
import { t } from "./i18n";
import { FirstPaintReady } from "./startup/first-paint";
import { FontGate, fontsBuiltIn } from "./startup/font-gate";
import { holdNativeSplash, nativeSplash } from "./startup/native-splash";
import { loadRuntimeFonts } from "./startup/runtime-fonts";
import { createSplashGate } from "./startup/splash-gate";

holdNativeSplash();
const SPLASH = createSplashGate(nativeSplash);
const DEV_CONNECTION = bundledDevConnection();
const FONTS_BUILT_IN = fontsBuiltIn(isLoaded);

export default function App() {
  return (
    <FirstPaintReady.Provider value={SPLASH.ready}>
      <FontGate builtIn={FONTS_BUILT_IN} loadFonts={loadRuntimeFonts}>
        <SafeAreaProvider>
          <SafeAreaView style={styles.root}>
            <StatusBar style="light" />
            <AppRoot
              store={connectionStore}
              fetcher={platformFetch}
              devConnection={DEV_CONNECTION}
              pushDevice={pushDevice}
              pushMemory={pushMemory}
              cacheFiles={cacheFiles}
              deviceName={Constants.deviceName ?? t("connection.defaultDeviceName")}
            />
          </SafeAreaView>
        </SafeAreaProvider>
      </FontGate>
    </FirstPaintReady.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgCanvas },
});
