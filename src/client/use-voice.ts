"use client";

import { useEffect, useState } from "react";
import { VoiceController, type VoiceCallbacks, type VoiceSnapshot } from "./voice/controller";

export function useVoice(callbacks: VoiceCallbacks) {
  const [snapshot, setSnapshot] = useState<VoiceSnapshot>({ state: "ready", level: 0, partial: "", muted: false });
  const [controller] = useState(() => new VoiceController(callbacks, setSnapshot));
  useEffect(() => { controller.setCallbacks(callbacks); }, [controller, callbacks]);
  useEffect(() => () => controller.cancel(), [controller]);
  return { ...snapshot, start: controller.start, stop: controller.stop, speak: controller.speak, cancel: controller.cancel, toggleMute: controller.toggleMute };
}
