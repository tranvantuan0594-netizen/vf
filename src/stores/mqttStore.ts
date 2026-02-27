import { map } from "nanostores";

export interface MqttState {
  status: "disconnected" | "connecting" | "connected" | "error";
  lastMessageTime: number | null;
  messageCount: number;
  error: string | null;
}

export const mqttStore = map<MqttState>({
  status: "disconnected",
  lastMessageTime: null,
  messageCount: 0,
  error: null,
});

export function setMqttStatus(status: MqttState["status"], error?: string) {
  mqttStore.set({
    ...mqttStore.get(),
    status,
    error: error || null,
  });
}

export function recordMqttMessage() {
  const state = mqttStore.get();
  mqttStore.set({
    ...state,
    lastMessageTime: Date.now(),
    messageCount: state.messageCount + 1,
  });
}

export function resetMqttStore() {
  mqttStore.set({
    status: "disconnected",
    lastMessageTime: null,
    messageCount: 0,
    error: null,
  });
}
