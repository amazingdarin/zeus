import type { MessageItem } from "../api/message-center";

type MessageCenterListener = (item: MessageItem) => void;

const listeners = new Set<MessageCenterListener>();

export const subscribeMessageCenter = (listener: MessageCenterListener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const publishMessageCenter = (item: MessageItem) => {
  for (const listener of listeners) {
    try {
      listener(item);
    } catch (err) {
      console.warn("[message-center] callback error", err);
    }
  }
};
