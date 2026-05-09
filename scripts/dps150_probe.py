#!/usr/bin/env python3
"""Small FNIRSI DPS-150 serial probe for debugging Linux/browser read issues."""

from __future__ import annotations

import argparse
import errno
import fcntl
import os
import select
import struct
import sys
import time
import termios
from typing import Iterable

try:
    import serial
except ImportError:
    print("pyserial is missing. Install it with: python -m pip install pyserial", file=sys.stderr)
    raise


HEADER_INPUT = 0xF0
HEADER_OUTPUT = 0xF1

CMD_GET = 0xA1
CMD_BAUD = 0xB0
CMD_SET = 0xB1
CMD_SESSION = 0xC1

VOLTAGE_SET = 193
CURRENT_SET = 194
INPUT_VOLTAGE = 192
METERING = 195
TEMPERATURE = 196
OUTPUT_ENABLE = 219
MODEL_NAME = 222
HARDWARE_VERSION = 223
FIRMWARE_VERSION = 224
UPPER_LIMIT_VOLTAGE = 226
UPPER_LIMIT_CURRENT = 227
ALL = 255

BAUD_PROFILES = {
    9600: 1,
    19200: 2,
    38400: 3,
    57600: 4,
    115200: 5,
}

BAUD_FLAGS = {
    9600: termios.B9600,
    19200: termios.B19200,
    38400: termios.B38400,
    57600: termios.B57600,
    115200: termios.B115200,
}


def hexdump(data: bytes | bytearray | Iterable[int]) -> str:
    return " ".join(f"{byte:02x}" for byte in data)


def packet(cmd: int, addr: int, payload: bytes | bytearray | Iterable[int]) -> bytes:
    body = bytes(payload)
    checksum = (addr + len(body) + sum(body)) & 0xFF
    return bytes([HEADER_OUTPUT, cmd, addr, len(body), *body, checksum])


def float_payload(value: float) -> bytes:
    return struct.pack("<f", value)


def parse_frames(buffer: bytearray) -> list[tuple[int, bytes]]:
    frames: list[tuple[int, bytes]] = []
    i = 0
    while i <= len(buffer) - 5:
        if buffer[i] != HEADER_INPUT or buffer[i + 1] != CMD_GET:
            i += 1
            continue

        addr = buffer[i + 2]
        length = buffer[i + 3]
        end = i + 4 + length
        if end >= len(buffer):
            break

        payload = bytes(buffer[i + 4 : end])
        checksum = buffer[end]
        expected = (addr + length + sum(payload)) & 0xFF
        if checksum == expected:
            frames.append((addr, payload))
        else:
            print(
                f"RX bad checksum addr=0x{addr:02x} expected=0x{expected:02x} got=0x{checksum:02x}"
            )

        i = end + 1

    del buffer[:i]
    return frames


def describe_frame(addr: int, payload: bytes) -> str:
    base = f"RX frame addr=0x{addr:02x} len={len(payload)} data={hexdump(payload)}"

    if addr in (MODEL_NAME, HARDWARE_VERSION, FIRMWARE_VERSION):
        return f"{base} ascii={payload.decode(errors='replace').strip()!r}"

    if addr == OUTPUT_ENABLE and payload:
        return f"{base} output={'on' if payload[0] == 1 else 'off'}"

    if addr == INPUT_VOLTAGE and len(payload) >= 4:
        value = struct.unpack_from("<f", payload, 0)[0]
        return f"{base} inputVoltage={value:.3f}V"

    if addr == TEMPERATURE and len(payload) >= 4:
        value = struct.unpack_from("<f", payload, 0)[0]
        return f"{base} temperature={value:.1f}C"

    if addr == UPPER_LIMIT_VOLTAGE and len(payload) >= 4:
        value = struct.unpack_from("<f", payload, 0)[0]
        return f"{base} upperLimitVoltage={value:.3f}V"

    if addr == UPPER_LIMIT_CURRENT and len(payload) >= 4:
        value = struct.unpack_from("<f", payload, 0)[0]
        return f"{base} upperLimitCurrent={value:.4f}A"

    if addr == METERING and len(payload) >= 12:
        out_v = struct.unpack_from("<f", payload, 0)[0]
        out_a = struct.unpack_from("<f", payload, 4)[0]
        out_w = struct.unpack_from("<f", payload, 8)[0]
        return f"{base} output={out_v:.3f}V/{out_a:.4f}A {out_w:.3f}W"

    if addr == ALL and len(payload) >= 119:
        input_v = struct.unpack_from("<f", payload, 0)[0]
        set_v = struct.unpack_from("<f", payload, 4)[0]
        set_a = struct.unpack_from("<f", payload, 8)[0]
        out_v = struct.unpack_from("<f", payload, 12)[0]
        out_a = struct.unpack_from("<f", payload, 16)[0]
        output = "on" if payload[107] == 1 else "off"
        return (
            f"{base}\n"
            f"  parsed: vin={input_v:.3f}V set={set_v:.3f}V/{set_a:.4f}A "
            f"out={out_v:.3f}V/{out_a:.4f}A output={output}"
        )

    return base


def read_for(ser: serial.Serial, seconds: float, buffer: bytearray) -> None:
    deadline = time.monotonic() + seconds
    saw_bytes = False
    while time.monotonic() < deadline:
        try:
            waiting = ser.in_waiting
            data = ser.read(waiting or 1)
        except serial.SerialException as error:
            print(f"RX serial exception: {error}")
            return

        if not data:
            continue

        saw_bytes = True
        print(f"RX raw {len(data)} bytes: {hexdump(data)}")
        buffer.extend(data)
        for addr, payload in parse_frames(buffer):
            print(describe_frame(addr, payload))

    if not saw_bytes:
        print(f"RX no bytes for {seconds:.1f}s")


def send_and_read(ser: serial.Serial, label: str, cmd: int, addr: int, payload: bytes) -> None:
    data = packet(cmd, addr, payload)
    print(f"TX {label}: {hexdump(data)}")
    ser.write(data)
    ser.flush()


def configure_raw_fd(fd: int, baud: int, rtscts: bool) -> None:
    attrs = termios.tcgetattr(fd)
    attrs[0] = 0
    attrs[1] = 0
    attrs[2] = BAUD_FLAGS[baud] | termios.CS8 | termios.CLOCAL | termios.CREAD
    if rtscts and hasattr(termios, "CRTSCTS"):
        attrs[2] |= termios.CRTSCTS
    attrs[3] = 0
    attrs[6][termios.VMIN] = 0
    attrs[6][termios.VTIME] = 0
    termios.tcsetattr(fd, termios.TCSANOW, attrs)
    termios.tcflush(fd, termios.TCIOFLUSH)


def set_raw_signal(fd: int, name: str, enabled: bool) -> None:
    bits = {"dtr": termios.TIOCM_DTR, "rts": termios.TIOCM_RTS}
    request = termios.TIOCMBIS if enabled else termios.TIOCMBIC
    fcntl.ioctl(fd, request, struct.pack("I", bits[name]))


def read_raw_for(fd: int, seconds: float, buffer: bytearray) -> None:
    deadline = time.monotonic() + seconds
    saw_bytes = False
    empty_reads = 0

    while time.monotonic() < deadline:
        timeout = max(0, deadline - time.monotonic())
        readable, _, _ = select.select([fd], [], [], timeout)
        if not readable:
            break

        try:
            data = os.read(fd, 4096)
        except BlockingIOError:
            continue
        except OSError as error:
            if error.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                continue
            print(f"RX os.read error: {error}")
            return

        if not data:
            empty_reads += 1
            print("RX empty os.read after select readiness")
            continue

        saw_bytes = True
        print(f"RX raw {len(data)} bytes: {hexdump(data)}")
        buffer.extend(data)
        for addr, payload in parse_frames(buffer):
            print(describe_frame(addr, payload))

    if empty_reads:
        print(f"RX empty-read count: {empty_reads}")
    if not saw_bytes:
        print(f"RX no bytes for {seconds:.1f}s")


def send_raw_and_read(fd: int, label: str, cmd: int, addr: int, payload: bytes) -> None:
    data = packet(cmd, addr, payload)
    print(f"TX {label}: {hexdump(data)}")
    os.write(fd, data)
    termios.tcdrain(fd)


def run_raw_probe(args: argparse.Namespace) -> int:
    print(
        f"Opening {args.port} at {args.baud} baud, 8-N-1, raw fd, "
        f"rtscts={'on' if args.rtscts else 'off'}"
    )
    fd = os.open(args.port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    try:
        try:
            fcntl.ioctl(fd, termios.TIOCEXCL)
            print("Exclusive tty lock enabled")
        except OSError as error:
            print(f"Exclusive tty lock failed: {error}")

        configure_raw_fd(fd, args.baud, args.rtscts)
        if args.dtr:
            set_raw_signal(fd, "dtr", args.dtr == "on")
            print(f"DTR set {'on' if args.dtr == 'on' else 'off'}")
        if args.rts:
            set_raw_signal(fd, "rts", args.rts == "on")
            print(f"RTS set {'on' if args.rts == 'on' else 'off'}")

        rx_buffer = bytearray()
        run_probe_sequence(
            args,
            lambda label, cmd, addr, payload: send_raw_and_read(fd, label, cmd, addr, payload),
            lambda seconds: read_raw_for(fd, seconds, rx_buffer),
        )
        return 0
    finally:
        print("Closing raw fd")
        os.close(fd)


def run_probe_sequence(args: argparse.Namespace, send, read) -> None:
    send("enter session", CMD_SESSION, 0, bytes([1]))
    read(args.read_seconds)

    send(f"baud profile {args.baud}", CMD_BAUD, 0, bytes([BAUD_PROFILES[args.baud]]))
    read(0.3)

    for label, addr in (
        ("model", MODEL_NAME),
        ("hardware", HARDWARE_VERSION),
        ("firmware", FIRMWARE_VERSION),
        ("all state", ALL),
    ):
        send(f"get {label}", CMD_GET, addr, bytes([0]))
        read(args.read_seconds)

    if args.voltage is not None:
        send(f"set voltage {args.voltage}", CMD_SET, VOLTAGE_SET, float_payload(args.voltage))
        read(0.5)
    if args.current is not None:
        send(f"set current {args.current}", CMD_SET, CURRENT_SET, float_payload(args.current))
        read(0.5)
    if args.enable:
        send("output enable", CMD_SET, OUTPUT_ENABLE, bytes([1]))
        read(0.5)
    if args.disable:
        send("output disable", CMD_SET, OUTPUT_ENABLE, bytes([0]))
        read(0.5)


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe a FNIRSI DPS-150 serial connection.")
    parser.add_argument(
        "-p",
        "--port",
        default="/dev/serial/by-id/usb-Artery_AT32_Virtual_Com_Port_13E989AE2565-if00",
    )
    parser.add_argument("-b", "--baud", type=int, default=9600)
    parser.add_argument(
        "--backend",
        choices=("pyserial", "raw"),
        default="pyserial",
        help="pyserial matches common tools; raw uses os.read/termios directly.",
    )
    parser.add_argument("--rtscts", action="store_true", help="Enable hardware flow control.")
    parser.add_argument("--dtr", choices=("on", "off"), help="Set DTR before opening.")
    parser.add_argument("--rts", choices=("on", "off"), help="Set RTS before opening.")
    parser.add_argument("--enable", action="store_true", help="Send output enable.")
    parser.add_argument("--disable", action="store_true", help="Send output disable.")
    parser.add_argument("--voltage", type=float, help="Set voltage after read probe.")
    parser.add_argument("--current", type=float, help="Set current after read probe.")
    parser.add_argument("--read-seconds", type=float, default=1.0)
    args = parser.parse_args()

    if args.baud not in BAUD_PROFILES:
        print(f"Unsupported baud profile {args.baud}; choose one of {sorted(BAUD_PROFILES)}")
        return 2

    if args.backend == "raw":
        return run_raw_probe(args)

    print(
        f"Opening {args.port} at {args.baud} baud, 8-N-1, "
        f"rtscts={'on' if args.rtscts else 'off'}"
    )
    ser = serial.Serial()
    ser.port = args.port
    ser.baudrate = args.baud
    ser.bytesize = serial.EIGHTBITS
    ser.parity = serial.PARITY_NONE
    ser.stopbits = serial.STOPBITS_ONE
    ser.timeout = 0.2
    ser.write_timeout = 1
    ser.rtscts = args.rtscts
    ser.exclusive = True
    if args.dtr:
        ser.dtr = args.dtr == "on"
        print(f"DTR pre-open {'on' if ser.dtr else 'off'}")
    if args.rts:
        ser.rts = args.rts == "on"
        print(f"RTS pre-open {'on' if ser.rts else 'off'}")
    ser.open()

    try:
        print(f"Open signals: DTR={'on' if ser.dtr else 'off'} RTS={'on' if ser.rts else 'off'}")

        ser.reset_input_buffer()
        ser.reset_output_buffer()
        rx_buffer = bytearray()

        run_probe_sequence(
            args,
            lambda label, cmd, addr, payload: send_and_read(ser, label, cmd, addr, payload),
            lambda seconds: read_for(ser, seconds, rx_buffer),
        )

        return 0
    finally:
        print("Closing serial port")
        ser.close()


if __name__ == "__main__":
    raise SystemExit(main())
