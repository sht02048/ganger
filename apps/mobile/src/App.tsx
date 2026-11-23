import Constants from "expo-constants";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import medium from "pretendard/dist/public/static/Pretendard-Medium.otf";
import regular from "pretendard/dist/public/static/Pretendard-Regular.otf";
import semibold from "pretendard/dist/public/static/Pretendard-SemiBold.otf";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native";

import { AppRoot } from "./connection/app-root";
import { connectionStore } from "./connection/connection-store";
import { bundledDevConnection } from "./connection/dev-connection";
import { platformFetch } from "./connection/platform-fetch";
import { pushDevice } from "./notifications/push-device";
import { pushMemory } from "./notifications/push-memory";
import { fontFamily, colors } from "./design/tokens";
import { t } from "./i18n";

const DEV_CONNECTION = bundledDevConnection();

export default function App() {
  const [loaded, error] = useFonts({
    [fontFamily.regular]: regular,
    [fontFamily.medium]: medium,
    [fontFamily.semibold]: semibold,
  });
  if (!loaded && error === null) return null;
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="light" />
        <AppRoot
          store={connectionStore}
          fetcher={platformFetch}
          devConnection={DEV_CONNECTION}
          pushDevice={pushDevice}
          pushMemory={pushMemory}
          deviceName={Constants.deviceName ?? t("connection.defaultDeviceName")}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgCanvas },
});
