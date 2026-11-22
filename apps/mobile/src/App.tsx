import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import medium from "pretendard/dist/public/static/Pretendard-Medium.otf";
import regular from "pretendard/dist/public/static/Pretendard-Regular.otf";
import semibold from "pretendard/dist/public/static/Pretendard-SemiBold.otf";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native";

import { AppScreens } from "./app-screens";
import { fontFamily, colors } from "./design/tokens";

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
        <AppScreens />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgCanvas },
});
