import { create } from "zustand";
import { NO_LINK, type LinkInfo } from "../model/link";
import type { ChatMessage, Pointer } from "../lib/link";

/** What the link reports to the interface: its state, the chat and the other computer's pointer. */
interface LinkStore {
  info: LinkInfo;
  chat: ChatMessage[];
  /** The other computer's pointer on the script (null = hidden). */
  pointer: Pointer;
  setInfo: (info: LinkInfo) => void;
  addChat: (m: ChatMessage) => void;
  setPointer: (p: Pointer) => void;
}

const MAX_CHAT = 100;

export const useLink = create<LinkStore>((set) => ({
  info: NO_LINK,
  chat: [],
  pointer: null,
  setInfo: (info) => set({ info }),
  addChat: (m) => set((s) => (s.chat.some((x) => x.id === m.id) ? s : { chat: [...s.chat, m].slice(-MAX_CHAT) })),
  setPointer: (pointer) => set({ pointer }),
}));

export const linkInfo = (): LinkInfo => useLink.getState().info;
