import { loadAsync } from "expo-font";
import medium from "pretendard/dist/public/static/Pretendard-Medium.otf";
import regular from "pretendard/dist/public/static/Pretendard-Regular.otf";
import semibold from "pretendard/dist/public/static/Pretendard-SemiBold.otf";

import { fontFamily } from "../design/tokens";

export function loadRuntimeFonts(): Promise<void> {
  return loadAsync({
    [fontFamily.regular]: regular,
    [fontFamily.medium]: medium,
    [fontFamily.semibold]: semibold,
  });
}
