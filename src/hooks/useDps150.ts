import { useCallback, useEffect, useRef, useState } from "react";
import { DPS150, DeviceState, initialState } from "@/lib/dps150";

export function useDps150() {
  const [state, setState] = useState<DeviceState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const deviceRef = useRef<DPS150 | null>(null);
  const pollRef = useRef<number | null>(null);

  const apply = useCallback((patch: Partial<DeviceState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    if (!("serial" in navigator)) {
      setError("Web Serial not supported. Use Chrome, Edge, or Opera over HTTPS.");
      return;
    }
    try {
      const port = await navigator.serial.requestPort();
      const dev = new DPS150(port, apply);
      deviceRef.current = dev;
      await dev.start();
      pollRef.current = window.setInterval(() => {
        dev.refresh().catch(() => {});
      }, 500);
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      if (error.name !== "NotFoundError") setError(error.message);
    }
  }, [apply]);

  const disconnect = useCallback(async () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    await deviceRef.current?.stop();
    deviceRef.current = null;
    setState(initialState);
  }, []);

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
      deviceRef.current?.stop();
    },
    [],
  );

  return {
    state,
    error,
    connect,
    disconnect,
    device: deviceRef,
  };
}
