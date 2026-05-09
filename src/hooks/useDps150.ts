import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaultSerialConnectionOptions,
  DPS150,
  DeviceState,
  DpsLogLevel,
  initialState,
  SerialConnectionOptions,
} from "@/lib/dps150";

export interface SerialLogEntry {
  id: number;
  time: string;
  level: DpsLogLevel;
  message: string;
}

const MAX_LOG_ENTRIES = 160;

function getErrorHint(error: Error) {
  if (error.name === "NetworkError" || error.message.includes("Failed to open serial port")) {
    return "Port open failed. Close Arduino IDE, serial monitors, vendor tools, and other browser tabs using the device, then unplug/replug the USB cable.";
  }

  if (error.name === "NotFoundError") {
    return "No serial port was selected.";
  }

  if (error.name === "SecurityError") {
    return "The browser blocked Web Serial. Use HTTPS and a Web Serial capable browser.";
  }

  return "Serial operation failed. Check cable, permissions, and whether another app already owns the port.";
}

function formatPortInfo(port: SerialPort) {
  const info = port.getInfo();
  const vendor = info.usbVendorId == null ? "unknown" : `0x${info.usbVendorId.toString(16)}`;
  const product = info.usbProductId == null ? "unknown" : `0x${info.usbProductId.toString(16)}`;

  return `USB vendor ${vendor}, product ${product}`;
}

export function useDps150() {
  const [state, setState] = useState<DeviceState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const [logEntries, setLogEntries] = useState<SerialLogEntry[]>([]);
  const deviceRef = useRef<DPS150 | null>(null);
  const pollRef = useRef<number | null>(null);
  const logIdRef = useRef(0);

  const apply = useCallback((patch: Partial<DeviceState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const addLog = useCallback((level: DpsLogLevel, message: string) => {
    const now = new Date();
    const entry: SerialLogEntry = {
      id: ++logIdRef.current,
      time: now.toLocaleTimeString([], {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      level,
      message,
    };

    setLogEntries((prev) => [...prev.slice(-(MAX_LOG_ENTRIES - 1)), entry]);
  }, []);

  const clearLog = useCallback(() => {
    setLogEntries([]);
  }, []);

  const connect = useCallback(
    async (options = defaultSerialConnectionOptions) => {
      setError(null);
      addLog("info", "Connect requested");
      addLog(
        "info",
        `Connect settings: baud=${options.baudRate}, flow=${options.flowControl}, signals=${options.manageSignals ? "managed" : "unchanged"}, DTR=${options.dataTerminalReady ? "on" : "off"}, RTS=${options.requestToSend ? "on" : "off"}, delay=${options.startupDelayMs}ms`,
      );
      if (!("serial" in navigator)) {
        const message = "Web Serial not supported. Use Chrome, Edge, or Opera over HTTPS.";
        setError(message);
        addLog("error", message);
        return;
      }
      try {
        addLog("info", "Opening browser serial port picker");
        const port = await navigator.serial.requestPort();
        addLog("info", `Selected port: ${formatPortInfo(port)}`);
        const dev = new DPS150(
          port,
          apply,
          addLog,
          (error) => {
            addLog("error", `Serial transport stopped: ${error.message}`);
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
              addLog("info", "Stopped refresh loop after serial reader failure");
            }
            deviceRef.current = null;
            setState((prev) => ({ ...prev, connected: false }));
            setError(`Serial reader stopped: ${error.message}`);
          },
          options,
        );
        deviceRef.current = dev;
        await dev.start();
        pollRef.current = window.setInterval(() => {
          dev.refresh().catch((e: unknown) => {
            const error = e instanceof Error ? e : new Error(String(e));
            addLog("warn", `Refresh failed: ${error.message}`);
          });
        }, 500);
        addLog("info", "Started 500 ms refresh loop");
      } catch (e: unknown) {
        const error = e instanceof Error ? e : new Error(String(e));
        addLog("error", `${error.name}: ${error.message}`);
        addLog("warn", getErrorHint(error));
        deviceRef.current = null;
        if (error.name !== "NotFoundError") setError(`${error.message} ${getErrorHint(error)}`);
      }
    },
    [addLog, apply],
  );

  const disconnect = useCallback(async () => {
    addLog("info", "Disconnect requested");
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      addLog("info", "Stopped refresh loop");
    }
    await deviceRef.current?.stop();
    deviceRef.current = null;
    setState(initialState);
  }, [addLog]);

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
    logEntries,
    log: addLog,
    connect,
    disconnect,
    clearLog,
    device: deviceRef,
  };
}

export type { SerialConnectionOptions };
