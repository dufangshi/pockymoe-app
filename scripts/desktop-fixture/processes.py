"""Fixture-owned process identity and cleanup on Unix and Windows."""
import ctypes
import os
import signal
import subprocess
import sys
import time


def identity(pid):
    if sys.platform == "win32":
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        kernel.GetProcessTimes.argtypes = [wintypes.HANDLE, *([ctypes.POINTER(wintypes.FILETIME)] * 4)]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return ""
        try:
            created, exited, system, user = (wintypes.FILETIME() for _ in range(4))
            code = wintypes.DWORD()
            if not kernel.GetExitCodeProcess(handle, ctypes.byref(code)) or code.value != 259:
                return ""
            if not kernel.GetProcessTimes(handle, ctypes.byref(created), ctypes.byref(exited), ctypes.byref(system), ctypes.byref(user)):
                return ""
            return str((created.dwHighDateTime << 32) | created.dwLowDateTime)
        finally:
            kernel.CloseHandle(handle)
    result = subprocess.run(["ps", "-p", str(pid), "-o", "lstart=", "-o", "stat="],
                            text=True, capture_output=True, check=False)
    parts = result.stdout.strip().rsplit(None, 1)
    return parts[0].strip() if result.returncode == 0 and len(parts) == 2 and not parts[1].startswith("Z") else ""


def alive(process):
    return bool(process and process.get("identity") and identity(process["pid"]) == process["identity"])


def stop_process(process):
    if not alive(process):
        return
    if sys.platform == "win32":
        # Only a recorded PID with its matching creation time may own this tree.
        subprocess.run([os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "taskkill.exe"),
                        "/PID", str(process["pid"]), "/T", "/F"], capture_output=True, check=False)
        return
    def send(signum):
        if os.getpgid(process["pid"]) == process["pid"]:
            os.killpg(process["pid"], signum)
        else:
            os.kill(process["pid"], signum)
    send(signal.SIGTERM)
    deadline = time.monotonic() + 3
    while alive(process) and time.monotonic() < deadline:
        time.sleep(0.04)
    if alive(process):
        send(signal.SIGKILL)


def lock_file(lock):
    if sys.platform == "win32":
        import msvcrt
        lock.seek(0)
        if not lock.read(1):
            lock.write("0"); lock.flush()
        lock.seek(0)
        while True:
            try:
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                break
            except OSError:
                time.sleep(0.1)
    else:
        import fcntl
        fcntl.flock(lock, fcntl.LOCK_EX)
