import { useEffect, useState } from "react";
import { getLooiRobotDebugState, subscribeLooiRobotDebugState } from "../device-tools/looi-robot-autoconnect";

export function useRobotDebugState() {
  const [state, setState] = useState(() => getLooiRobotDebugState());
  useEffect(() => {
    const sync = () => setState(getLooiRobotDebugState());
    const unsubscribe = subscribeLooiRobotDebugState(sync);
    sync();
    return unsubscribe;
  }, []);
  return state;
}
