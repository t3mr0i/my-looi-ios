"""Use the existing Netcup SSH/TLS route without disabling TLS or SSH verification."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import select
import shlex
import socket
import ssl
import subprocess
import sys


def proxy(host: str, server_name: str) -> None:
    context = ssl.create_default_context()
    with socket.create_connection((host, 443), timeout=15) as transport:
        with context.wrap_socket(transport, server_hostname=server_name) as connection:
            connection.settimeout(None)
            while True:
                if connection.pending():
                    ready = [connection, *select.select([0], [], [], 0)[0]]
                else:
                    ready = select.select([0, connection], [], [], 30)[0]
                for source in ready:
                    data = os.read(0, 65536) if source == 0 else connection.recv(65536)
                    if not data:
                        return
                    if source == 0:
                        connection.sendall(data)
                    else:
                        remaining = memoryview(data)
                        while remaining:
                            remaining = remaining[os.write(1, remaining):]


def ssh_arguments(host: str, server_name: str, user: str, command: list[str]) -> list[str]:
    bridge = shlex.join([sys.executable, str(Path(__file__).resolve()), "--host", host,
                         "--tls-name", server_name, "--proxy"])
    return ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
            "-o", f"HostKeyAlias={host}", "-o", "ConnectTimeout=15",
            "-o", "ConnectionAttempts=1", "-o", f"ProxyCommand={bridge}",
            f"{user}@{host}", *command]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="159.195.212.54")
    parser.add_argument("--tls-name", default="admin-ssh.159-195-212-54.sslip.io")
    parser.add_argument("--user", default="root")
    parser.add_argument("--proxy", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.proxy:
        proxy(args.host, args.tls_name)
    else:
        command = args.command[1:] if args.command[:1] == ["--"] else args.command
        raise SystemExit(subprocess.call(ssh_arguments(args.host, args.tls_name, args.user, command)))


if __name__ == "__main__":
    main()
