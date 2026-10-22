import { createContext, useContext } from "react";
import type { useNativeDisplay } from "./native-layout";
import type { NativeLayout } from "./native-display-helpers";
import type { FieldValue } from "./service";

export type Registration = (id: string) => () => void;
export type NativeContextData = {
  issueIds: string[];
  display: ReturnType<typeof useNativeDisplay>;
  layout: NativeLayout;
  register: Registration;
  values: Record<string, Record<string, FieldValue>>;
  projects: Record<string, string>;
  refresh: () => Promise<unknown>;
};
export const NativeFieldsContext = createContext<NativeContextData | null>(null);
export const useNativeFieldsContext = () => useContext(NativeFieldsContext);
